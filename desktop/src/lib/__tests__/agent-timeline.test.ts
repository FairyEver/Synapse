import { describe, expect, it } from "vitest"

import {
  agentEventToTimelineItem,
  appendAgentTimelineEvent,
  historyRecordToTimelineItem,
} from "../agent-timeline"

describe("agent timeline conversion", () => {
  it("preserves turn outcome metadata on cancelled result events", () => {
    const item = agentEventToTimelineItem({
      type: "result",
      content: "",
      done: true,
      metadata: {
        cancelled: true,
        turnOutcome: {
          status: "cancelled",
          mode: "graceful",
          reason: "user_cancelled",
          message: "已停止本次执行。",
          diagnostics: [{
            source: "claude-sdk",
            kind: "aborted",
            message: "Request was aborted",
          }],
        },
      },
    }, {
      id: "item-1",
      timestamp: "2026-06-11T00:00:00.000Z",
    })

    expect(item).toMatchObject({
      kind: "result",
      metadata: {
        cancelled: true,
        turnOutcome: {
          status: "cancelled",
          message: "已停止本次执行。",
        },
      },
    })
  })

  it("converts live tool events into canonical items", () => {
    expect(agentEventToTimelineItem({
      type: "toolUse",
      toolUseId: "toolu-1",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
      agentSessionId: "thread-1",
      threadId: "thread-1",
    }, {
      id: "live:1",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
    })).toEqual({
      id: "live:1",
      kind: "toolCall",
      timestamp: "2026-04-28T00:00:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolUseId: "toolu-1",
      toolName: "Bash",
      toolInput: "pnpm test",
      toolInputRaw: { cmd: "pnpm test" },
    })
  })

  it("adapts stored tool result metadata into canonical items", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "ok",
      timestamp: "2026-04-28T00:01:00.000Z",
      metadata: {
        agentEventType: "toolResult",
        toolUseId: "toolu-1",
        toolName: "Bash",
        status: "completed",
        exitCode: 0,
        success: true,
        agentSessionId: "thread-1",
        threadId: "thread-1",
      },
    }, 2, "codex")).toEqual({
      id: "session-1:history:2",
      kind: "toolResult",
      timestamp: "2026-04-28T00:01:00.000Z",
      agentType: "codex",
      agentSessionId: "thread-1",
      threadId: "thread-1",
      toolUseId: "toolu-1",
      toolName: "Bash",
      content: "ok",
      status: "completed",
      exitCode: 0,
      success: true,
    })
  })

  it("restores user question ids, keys, and resolution metadata", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "system",
      content: "AskUserQuestion",
      timestamp: "2026-07-14T00:00:00.000Z",
      metadata: {
        agentEventType: "permissionRequest",
        requestId: "request-1",
        toolName: "AskUserQuestion",
        questions: [{
          id: "question-id",
          key: "question-key",
          question: "选择处理范围",
          options: [{ label: "文档, 图片" }, { label: "音频" }],
          multiSelect: true,
        }],
        userQuestionResolution: {
          status: "answered",
          resolvedAt: "2026-07-14T00:01:00.000Z",
          answers: [{ questionIndex: 0, values: ["文档, 图片", "音频"] }],
        },
      },
    }, 2, "claude")).toEqual(expect.objectContaining({
      kind: "permissionRequest",
      requestId: "request-1",
      questions: [expect.objectContaining({ id: "question-id", key: "question-key" })],
      resolution: {
        status: "answered",
        resolvedAt: "2026-07-14T00:01:00.000Z",
        answers: [{ questionIndex: 0, values: ["文档, 图片", "音频"] }],
      },
    }))
  })

  it("restores an unconfirmed user question resolution attempt", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "system",
      content: "AskUserQuestion",
      timestamp: "2026-07-14T00:00:00.000Z",
      metadata: {
        agentEventType: "permissionRequest",
        requestId: "request-1",
        toolName: "AskUserQuestion",
        userQuestionResolutionAttempt: {
          status: "answered",
          resolvedAt: "2026-07-14T00:01:00.000Z",
          answers: [{ questionIndex: 0, values: ["重试"] }],
        },
      },
    }, 2, "claude")).toEqual(expect.objectContaining({
      kind: "permissionRequest",
      resolution: undefined,
      resolutionAttempt: {
        status: "answered",
        resolvedAt: "2026-07-14T00:01:00.000Z",
        answers: [{ questionIndex: 0, values: ["重试"] }],
      },
    }))
  })

  it("restores an empty cancelled result as a terminal timeline item", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "assistant",
      content: "",
      timestamp: "2026-07-18T01:00:00.000Z",
      metadata: {
        agentEventType: "result",
        turnOutcome: {
          status: "cancelled",
          mode: "graceful",
          reason: "user_cancelled",
          message: "已停止本次执行。",
        },
      },
    }, 3, "claude")).toMatchObject({
      kind: "result",
      content: "",
      metadata: {
        turnOutcome: {
          status: "cancelled",
          reason: "user_cancelled",
        },
      },
    })
  })

  it("restores image artifacts from stored tool result metadata", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "Read (1 image)",
      timestamp: "2026-07-03T00:00:00.000Z",
      metadata: {
        agentEventType: "toolResult",
        toolUseId: "toolu-1",
        toolName: "Read",
        imageArtifacts: [{
          id: "artifact-1",
          kind: "image",
          mimeType: "image/png",
          byteSize: 4,
          url: "/tmp/artifact-1.png",
        }],
      },
    }, 3)).toEqual(expect.objectContaining({
      kind: "toolResult",
      toolName: "Read",
      imageArtifacts: [expect.objectContaining({ id: "artifact-1" })],
    }))
  })

  it("restores stored thinking start time for process duration", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "system",
      content: "Inspect carefully.",
      timestamp: "2026-06-29T00:00:08.000Z",
      metadata: {
        agentEventType: "thinking",
        startedAt: "2026-06-29T00:00:00.000Z",
      },
    }, 1, "claude")).toEqual(expect.objectContaining({
      kind: "thinking",
      content: "Inspect carefully.",
      startedAt: "2026-06-29T00:00:00.000Z",
      timestamp: "2026-06-29T00:00:08.000Z",
    }))
  })

  it("rebuilds visible assistant messages around stored tool history", () => {
    const history = [
      {
        role: "assistant" as const,
        content: "正式评估正文",
        timestamp: "2026-06-26T00:30:09.000Z",
        metadata: {
          agentEventType: "assistant",
          sdkSessionId: "sdk-1",
        },
      },
      {
        role: "tool" as const,
        content: "Skill\n{\"skill\":\"sy-worklog\"}",
        timestamp: "2026-06-26T00:30:11.000Z",
        metadata: {
          agentEventType: "toolUse",
          toolUseId: "toolu-1",
          toolName: "Skill",
        },
      },
      {
        role: "tool" as const,
        content: "ok",
        timestamp: "2026-06-26T00:30:27.000Z",
        metadata: {
          agentEventType: "toolResult",
          toolUseId: "toolu-1",
          toolName: "Skill",
          success: true,
        },
      },
      {
        role: "assistant" as const,
        content: "工作记录已写入。",
        timestamp: "2026-06-26T00:30:30.000Z",
        metadata: {
          agentEventType: "assistant",
          sdkSessionId: "sdk-1",
          model: "claude-sonnet-4-5",
        },
      },
    ]

    const items = history.map((entry, index) =>
      historyRecordToTimelineItem("session-1", entry, index, "claude"))

    expect(items.map((item) => item.kind)).toEqual(["message", "toolCall", "toolResult", "message"])
    expect(items.filter((item) => item.kind === "message").map((item) => item.content)).toEqual([
      "正式评估正文",
      "工作记录已写入。",
    ])
    expect(items.at(-1)).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "工作记录已写入。",
      metadata: expect.objectContaining({
        model: "claude-sonnet-4-5",
      }),
    }))
  })

  it("converts native slash passthrough events into visible annotations", () => {
    expect(agentEventToTimelineItem({
      type: "sdkEvent",
      sdkType: "nativeSlashPassthrough",
      sdkSubtype: "/wiki-ingest",
      payload: { command: "/wiki-ingest" },
      sdkSessionId: "sdk-1",
    }, {
      id: "live:native-slash",
      timestamp: "2026-05-31T00:00:00.000Z",
      agentType: "claude",
    })).toEqual({
      id: "live:native-slash",
      kind: "sdkEvent",
      timestamp: "2026-05-31T00:00:00.000Z",
      agentType: "claude",
      sdkSessionId: "sdk-1",
      sdkType: "nativeSlashPassthrough",
      sdkSubtype: "/wiki-ingest",
      label: "Native slash",
      summary: "/wiki-ingest",
    })

    const items = appendAgentTimelineEvent([], {
      type: "sdkEvent",
      sdkType: "nativeSlashPassthrough",
      sdkSubtype: "/wiki-ingest",
      payload: { command: "/wiki-ingest" },
    }, "2026-05-31T00:00:00.000Z", "claude")

    expect(items).toEqual([
      expect.objectContaining({
        kind: "sdkEvent",
        label: "Native slash",
        summary: "/wiki-ingest",
      }),
    ])
  })

  it("adapts stored native slash metadata into annotation items", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "system",
      content: "SDK nativeSlashPassthrough /wiki-ingest",
      timestamp: "2026-05-31T00:01:00.000Z",
      metadata: {
        agentEventType: "sdkEvent",
        sdkType: "nativeSlashPassthrough",
        sdkSubtype: "/wiki-ingest",
        sdkSessionId: "sdk-1",
      },
    }, 4, "claude")).toEqual({
      id: "session-1:history:4",
      kind: "sdkEvent",
      timestamp: "2026-05-31T00:01:00.000Z",
      agentType: "claude",
      sdkSessionId: "sdk-1",
      sdkType: "nativeSlashPassthrough",
      sdkSubtype: "/wiki-ingest",
      label: "Native slash",
      summary: "/wiki-ingest",
    })
  })

  it("falls back to legacy message items when metadata is missing", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
    }, 3, "codex")).toEqual({
      id: "session-1:history:3",
      kind: "message",
      role: "tool",
      content: "Bash\npwd",
      timestamp: "2026-04-28T00:02:00.000Z",
      agentType: "codex",
      legacy: true,
    })
  })

  it("preserves stored assistant usage metadata", () => {
    expect(historyRecordToTimelineItem("session-1", {
      role: "assistant",
      content: "done",
      timestamp: "2026-04-28T00:02:30.000Z",
      metadata: {
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
        },
        turnUsage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 2,
        },
        costUsd: 0.01,
        costCny: 0.07,
        totalCostCny: 0.21,
        estimatedCost: true,
      },
    }, 4, "claude")).toEqual(expect.objectContaining({
      id: "session-1:history:4",
      kind: "message",
      role: "assistant",
      content: "done",
      metadata: {
        usage: {
          input_tokens: 10,
          output_tokens: 2,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 4,
        },
        turnUsage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 2,
        },
        costUsd: 0.01,
        costCny: 0.07,
        totalCostCny: 0.21,
        estimatedCost: true,
      },
    }))
  })

  it("merges assistant text deltas but keeps tool events separate", () => {
    const first = appendAgentTimelineEvent([], {
      type: "text",
      content: "hello",
    }, "2026-04-28T00:03:00.000Z", "codex")
    const second = appendAgentTimelineEvent(first, {
      type: "text",
      content: " world",
    }, "2026-04-28T00:03:01.000Z", "codex")
    const third = appendAgentTimelineEvent(second, {
      type: "toolUse",
      toolName: "Bash",
      toolInput: "pwd",
    }, "2026-04-28T00:03:02.000Z", "codex")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "message",
        role: "assistant",
        content: "hello world",
      }),
    ])
    expect(third).toHaveLength(2)
    expect(third[1]).toEqual(expect.objectContaining({ kind: "toolCall", toolName: "Bash" }))
  })

  it("uses live result usage as turn usage metadata", () => {
    const items = appendAgentTimelineEvent([
      {
        id: "assistant:1",
        kind: "message",
        role: "assistant",
        content: "done",
        timestamp: "2026-04-28T00:03:00.000Z",
      },
    ], {
      type: "result",
      content: "done",
      done: true,
      usage: {
        input_tokens: 3,
        output_tokens: 1,
        cache_read_input_tokens: 8,
        cache_creation_input_tokens: 2,
      },
      costCny: 0.07,
    }, "2026-04-28T00:03:01.000Z", "claude")

    expect(items[0]).toEqual(expect.objectContaining({
      kind: "message",
      metadata: expect.objectContaining({
        usage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 2,
        },
        turnUsage: {
          input_tokens: 3,
          output_tokens: 1,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 2,
        },
        costCny: 0.07,
      }),
    }))
  })

  it("keeps thinking deltas separated across tool boundaries", () => {
    const beforeTool = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Inspect first.",
    }, "2026-05-14T00:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(beforeTool, {
      type: "toolUse",
      toolName: "Read",
      toolInput: "package.json",
    }, "2026-05-14T00:00:01.000Z", "claude")
    const afterTool = appendAgentTimelineEvent(withTool, {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Summarize result.",
    }, "2026-05-14T00:00:02.000Z", "claude")

    expect(afterTool.map((item) => item.kind)).toEqual(["thinking", "toolCall", "thinking"])
    expect(afterTool[0]).toEqual(expect.objectContaining({ content: "Inspect first." }))
    expect(afterTool[2]).toEqual(expect.objectContaining({ content: "Summarize result." }))
  })

  it("keeps the first thinking delta timestamp as the thinking start time", () => {
    const first = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Inspect",
    }, "2026-06-29T00:00:00.000Z", "claude")
    const second = appendAgentTimelineEvent(first, {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: " carefully.",
    }, "2026-06-29T00:00:08.000Z", "claude")

    expect(second).toEqual([
      expect.objectContaining({
        kind: "thinking",
        content: "Inspect carefully.",
        startedAt: "2026-06-29T00:00:00.000Z",
        timestamp: "2026-06-29T00:00:08.000Z",
      }),
    ])
  })

  it("ignores empty stream deltas", () => {
    const afterEmptyText = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "",
    }, "2026-05-14T00:00:03.000Z", "claude")
    const afterEmptyThinking = appendAgentTimelineEvent(afterEmptyText, {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "",
    }, "2026-05-14T00:00:04.000Z", "claude")

    expect(afterEmptyThinking).toEqual([])
  })

  it("shows SDK tool input streaming as a single progress item", () => {
    const started = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-write",
      toolName: "Write",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-write", name: "Write" },
      },
    }, "2026-05-14T00:00:05.000Z", "claude")
    const firstChunk = appendAgentTimelineEvent(started, {
      type: "stream",
      blockIndex: 1,
      deltaType: "input_json_delta",
      inputJsonDeltaLength: 20 * 1024,
      partialJson: "{\"content\":\"...",
    }, "2026-05-14T00:00:06.000Z", "claude")
    const secondChunk = appendAgentTimelineEvent(firstChunk, {
      type: "stream",
      blockIndex: 1,
      deltaType: "input_json_delta",
      inputJsonDeltaLength: 20 * 1024,
      partialJson: "more html...",
    }, "2026-05-14T00:00:07.000Z", "claude")

    expect(secondChunk).toEqual([
      expect.objectContaining({
        kind: "toolProgress",
        toolUseId: "toolu-write",
        toolName: "Write",
        blockIndex: 1,
        inputCharCount: 40 * 1024,
        status: "preparing",
        startedAt: "2026-05-14T00:00:05.000Z",
        timestamp: "2026-05-14T00:00:07.000Z",
      }),
    ])
  })

  it("removes provisional tool progress when SDK closes the tool content block", () => {
    const progress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-write",
      toolName: "Write",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-write", name: "Write" },
      },
    }, "2026-05-14T00:00:05.000Z", "claude")
    const stopped = appendAgentTimelineEvent(progress, {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-write",
      event: {
        type: "content_block_stop",
        index: 1,
      },
    }, "2026-05-14T00:00:08.000Z", "claude")

    expect(stopped).toEqual([])
  })

  it("does not reuse error-stopped tool progress when a later tool reuses the block index", () => {
    const firstProgress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 0,
      toolUseId: "toolu-first",
      toolName: "Bash",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu-first", name: "Bash" },
      },
    }, "2026-05-14T00:00:05.000Z", "claude")
    const stopped = appendAgentTimelineEvent(firstProgress, {
      type: "error",
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
      recoverable: true,
      errorKind: "tool_use_interrupted",
    }, "2026-05-14T00:00:06.000Z", "claude")
    const secondProgress = appendAgentTimelineEvent(stopped, {
      type: "stream",
      blockIndex: 0,
      toolUseId: "toolu-second",
      toolName: "Write",
      event: {
        type: "content_block_start",
        index: 0,
        content_block: { type: "tool_use", id: "toolu-second", name: "Write" },
      },
    }, "2026-05-14T00:00:07.000Z", "claude")

    expect(secondProgress).toEqual([
      expect.objectContaining({
        kind: "toolProgress",
        toolUseId: "toolu-first",
        toolName: "Bash",
        status: "stopped",
      }),
      expect.objectContaining({
        kind: "error",
        errorKind: "tool_use_interrupted",
      }),
      expect.objectContaining({
        kind: "toolProgress",
        toolUseId: "toolu-second",
        toolName: "Write",
        status: "preparing",
      }),
    ])
  })

  it("replaces matching tool progress with the final tool call and preserves the progress start", () => {
    const progress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-write",
      toolName: "Write",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-write", name: "Write" },
      },
    }, "2026-05-14T00:00:05.000Z", "claude")
    const after = appendAgentTimelineEvent(progress, {
      type: "toolUse",
      toolUseId: "toolu-write",
      toolName: "Write",
      toolInput: "{\"file_path\":\"/tmp/a.html\"}",
    }, "2026-05-14T00:00:08.000Z", "claude")

    expect(after.map((item) => item.kind)).toEqual(["toolCall"])
    expect(after[0]).toEqual(expect.objectContaining({
      kind: "toolCall",
      toolUseId: "toolu-write",
      toolName: "Write",
      startedAt: "2026-05-14T00:00:05.000Z",
      timestamp: "2026-05-14T00:00:08.000Z",
    }))
  })

  it("marks in-flight tool progress as stopped when an error arrives before the tool call", () => {
    const progress = appendAgentTimelineEvent([], {
      type: "stream",
      blockIndex: 1,
      toolUseId: "toolu-write",
      toolName: "Write",
      event: {
        type: "content_block_start",
        index: 1,
        content_block: { type: "tool_use", id: "toolu-write", name: "Write" },
      },
    }, "2026-05-14T00:00:05.000Z", "claude")
    const after = appendAgentTimelineEvent(progress, {
      type: "error",
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
      recoverable: true,
      errorKind: "tool_use_interrupted",
    }, "2026-05-14T00:00:08.000Z", "claude")

    expect(after[0]).toEqual(expect.objectContaining({
      kind: "toolProgress",
      status: "stopped",
    }))
    expect(after[1]).toEqual(expect.objectContaining({ kind: "error" }))
  })

  it("keeps interleaved text and thinking stream blocks in event order", () => {
    const textThenThinking = appendAgentTimelineEvent(appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "Visible first.",
    }, "2026-05-14T00:00:05.000Z", "claude"), {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Reason second.",
    }, "2026-05-14T00:00:06.000Z", "claude")
    const textAfterThinking = appendAgentTimelineEvent(textThenThinking, {
      type: "stream",
      deltaType: "text_delta",
      text: " Visible third.",
    }, "2026-05-14T00:00:07.000Z", "claude")

    expect(textAfterThinking.map((item) => item.kind)).toEqual(["message", "thinking", "message"])
    expect(textAfterThinking[0]).toEqual(expect.objectContaining({ content: "Visible first." }))
    expect(textAfterThinking[1]).toEqual(expect.objectContaining({ content: "Reason second." }))
    expect(textAfterThinking[2]).toEqual(expect.objectContaining({ content: " Visible third." }))

    const thinkingThenText = appendAgentTimelineEvent(appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: "Reason first.",
    }, "2026-05-14T00:00:08.000Z", "claude"), {
      type: "stream",
      deltaType: "text_delta",
      text: "Visible second.",
    }, "2026-05-14T00:00:09.000Z", "claude")
    const thinkingAfterText = appendAgentTimelineEvent(thinkingThenText, {
      type: "stream",
      deltaType: "thinking_delta",
      thinking: " Reason third.",
    }, "2026-05-14T00:00:10.000Z", "claude")

    expect(thinkingAfterText.map((item) => item.kind)).toEqual(["thinking", "message", "thinking"])
    expect(thinkingAfterText[0]).toEqual(expect.objectContaining({ content: "Reason first." }))
    expect(thinkingAfterText[1]).toEqual(expect.objectContaining({ content: "Visible second." }))
    expect(thinkingAfterText[2]).toEqual(expect.objectContaining({ content: " Reason third." }))
  })

  it("promotes a standalone result event to a visible message item", () => {
    const userMessage = [{
      id: "user:1",
      kind: "message" as const,
      role: "user" as const,
      content: "hello",
      timestamp: "2026-05-10T00:00:00.000Z",
    }]
    const after = appendAgentTimelineEvent(userMessage, {
      type: "result",
      content: "hermes reply",
      done: true,
    }, "2026-05-10T00:00:01.000Z", "hermes")

    expect(after).toHaveLength(2)
    expect(after[1]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "hermes reply",
      agentType: "hermes",
    }))
  })

  it("keeps result text visible after tool boundaries", () => {
    const assistant = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "I will inspect it.",
    }, "2026-05-14T01:00:00.000Z", "claude")
    const withTool = appendAgentTimelineEvent(assistant, {
      type: "toolResult",
      toolName: "Read",
      content: "package contents",
      success: true,
    }, "2026-05-14T01:00:01.000Z", "claude")
    const after = appendAgentTimelineEvent(withTool, {
      type: "result",
      content: "Final answer.",
      done: true,
      usage: { input_tokens: 1 },
    }, "2026-05-14T01:00:02.000Z", "claude")

    expect(after.map((item) => item.kind)).toEqual(["message", "toolResult", "message"])
    expect(after[0]).toEqual(expect.objectContaining({ content: "I will inspect it." }))
    expect(after[2]).toEqual(expect.objectContaining({
      role: "assistant",
      content: "Final answer.",
      metadata: expect.objectContaining({
        usage: { input_tokens: 1 },
        turnUsage: { input_tokens: 1 },
      }),
    }))
  })

  it("preserves image artifacts on live tool result timeline items", () => {
    const item = agentEventToTimelineItem({
      type: "toolResult",
      toolName: "Read",
      toolUseId: "toolu-1",
      imageArtifacts: [{
        id: "artifact-1",
        kind: "image",
        mimeType: "image/png",
        byteSize: 4,
        url: "/tmp/artifact-1.png",
        sha256: "a".repeat(64),
      }],
      status: "success",
      success: true,
    }, {
      id: "event:1",
      timestamp: "2026-07-03T00:00:00.000Z",
    })

    expect(item).toEqual(expect.objectContaining({
      kind: "toolResult",
      imageArtifacts: [expect.objectContaining({ id: "artifact-1" })],
    }))
  })

  it("uses final result content to complete an existing streamed assistant message", () => {
    const partial = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "Partial",
    }, "2026-05-14T02:00:00.000Z", "claude")
    const after = appendAgentTimelineEvent(partial, {
      type: "result",
      content: "Partial final answer.",
      done: true,
      usage: { output_tokens: 3 },
    }, "2026-05-14T02:00:01.000Z", "claude")

    expect(after).toHaveLength(1)
    expect(after[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "Partial final answer.",
      streaming: false,
      metadata: expect.objectContaining({
        usage: { output_tokens: 3 },
        turnUsage: { output_tokens: 3 },
      }),
    }))
  })

  it("marks stream text as a draft until final assistant content arrives", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "1. **skill",
    }, "2026-05-14T02:01:00.000Z", "claude")
    expect(streamed[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "1. **skill",
      streaming: true,
    }))

    const final = appendAgentTimelineEvent(streamed, {
      type: "assistant",
      content: "1. **skill**",
    }, "2026-05-14T02:01:01.000Z", "claude")

    expect(final[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "1. **skill**",
      streaming: false,
    }))
  })

  it("marks streamed assistant text complete when an empty result closes the turn", () => {
    const streamed = appendAgentTimelineEvent([], {
      type: "stream",
      deltaType: "text_delta",
      text: "Final text",
    }, "2026-05-14T02:02:00.000Z", "claude")
    const closed = appendAgentTimelineEvent(streamed, {
      type: "result",
      content: "",
      done: true,
    }, "2026-05-14T02:02:01.000Z", "claude")

    expect(closed[0]).toEqual(expect.objectContaining({
      kind: "message",
      role: "assistant",
      content: "Final text",
      streaming: false,
    }))
  })
})
