import { describe, expect, it } from "vitest"

import { AgentContextUsageTracker } from "../context-usage"

describe("AgentContextUsageTracker", () => {
  it("updates main-thread input and streaming output usage", () => {
    const tracker = new AgentContextUsageTracker()

    expect(tracker.update({
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_start",
        message: {
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 20,
            cache_creation_input_tokens: 10,
            output_tokens: 0,
          },
        },
      },
    })).toEqual({ usedTokens: 130, model: "claude-sonnet-4-5" })

    expect(tracker.update({
      type: "stream_event",
      parent_tool_use_id: null,
      event: {
        type: "message_delta",
        usage: {
          input_tokens: null,
          cache_read_input_tokens: null,
          cache_creation_input_tokens: null,
          output_tokens: 25,
        },
      },
    })).toEqual({ usedTokens: 155, model: "claude-sonnet-4-5" })
  })

  it("prefers the last iterations entry over aggregate usage fields", () => {
    const tracker = new AgentContextUsageTracker()

    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        model: "claude-opus-4-1",
        usage: {
          input_tokens: 900,
          output_tokens: 100,
          iterations: [
            { input_tokens: 400, output_tokens: 30 },
            {
              input_tokens: 80,
              cache_read_input_tokens: 15,
              cache_creation_input_tokens: 5,
              output_tokens: 10,
            },
          ],
        },
      },
    })).toEqual({ usedTokens: 110, model: "claude-opus-4-1" })
  })

  it("sums cache tokens when iterations are unavailable", () => {
    const tracker = new AgentContextUsageTracker()

    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        usage: {
          input_tokens: 40,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 20,
          output_tokens: 10,
        },
      },
    })).toEqual({ usedTokens: 100 })
  })

  it("replaces compact summary tokens with the SDK context total", () => {
    const tracker = new AgentContextUsageTracker()
    tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: { usage: { input_tokens: 1_000, output_tokens: 200 } },
    })

    expect(tracker.update({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: { pre_tokens: 1_200, post_tokens: 416 },
    })).toBeUndefined()

    expect(tracker.replaceFromContextUsage({
      totalTokens: 87_400,
      maxTokens: 200_000,
      model: "qwen3.7-plus",
    })).toEqual({
      usedTokens: 87_400,
      contextWindowTokens: 200_000,
      model: "qwen3.7-plus",
    })
  })

  it("preserves catalog reference metadata while keeping the SDK window authoritative", () => {
    const tracker = new AgentContextUsageTracker({
      contextWindowConfigurationSource: "catalog",
      modelContext: {
        providerScopeId: "bailian-cn",
        modelId: "qwen3.7-plus",
        contextWindowTokens: 1_000_000,
        maxInputTokens: 991_808,
        sourceLabel: "Alibaba Cloud Model Studio",
        sourceUrl: "https://help.aliyun.com/zh/model-studio/qwen3-7-plus",
        verifiedAt: "2026-08-25T00:00:00.000Z",
      },
    })

    tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        model: "qwen3.7-plus",
        usage: { input_tokens: 35_000, output_tokens: 333 },
      },
    })
    const refreshed = tracker.replaceFromContextUsage({
      totalTokens: 35_333,
      maxTokens: 200_000,
      model: "qwen3.7-plus",
    })

    expect(refreshed).toMatchObject({
      usedTokens: 35_333,
      contextWindowTokens: 200_000,
      contextWindowConfigurationSource: "catalog",
      modelContext: {
        contextWindowTokens: 1_000_000,
        maxInputTokens: 991_808,
      },
    })
  })

  it("ignores subagent usage without changing the main-thread snapshot", () => {
    const tracker = new AgentContextUsageTracker()
    tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        model: "main-model",
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    })

    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: "tool-use-1",
      message: {
        model: "subagent-model",
        usage: { input_tokens: 9_000, output_tokens: 1_000 },
      },
    })).toBeUndefined()
    expect(tracker.update({
      type: "result",
      parent_tool_use_id: "tool-use-1",
      modelUsage: { "subagent-model": { contextWindow: 1_000_000 } },
    })).toBeUndefined()
    expect(tracker.update({
      type: "result",
      parent_tool_use_id: null,
      modelUsage: { "main-model": { contextWindow: 200_000 } },
    })).toEqual({
      usedTokens: 100,
      contextWindowTokens: 200_000,
      model: "main-model",
    })
  })

  it("matches the main model context window and only falls back to one candidate", () => {
    const tracker = new AgentContextUsageTracker()
    tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: {
        model: "main-model",
        usage: { input_tokens: 50, output_tokens: 10 },
      },
    })

    expect(tracker.update({
      type: "result",
      modelUsage: {
        "helper-model": { contextWindow: 100_000 },
        "main-model": { contextWindow: 200_000 },
      },
    })).toMatchObject({ contextWindowTokens: 200_000 })

    tracker.update({ type: "system", subtype: "init", model: "new-model" })
    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: { model: "new-model", usage: { input_tokens: 70, output_tokens: 10 } },
    })).toEqual({ usedTokens: 80, model: "new-model" })
    expect(tracker.update({
      type: "result",
      modelUsage: {
        "candidate-a": { contextWindow: 100_000 },
        "candidate-b": { contextWindow: 300_000 },
      },
    })).toEqual({ usedTokens: 80, model: "new-model" })
  })

  it("uses a single valid window candidate and rejects invalid token numbers", () => {
    const tracker = new AgentContextUsageTracker()
    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: { usage: { input_tokens: -1, output_tokens: Number.NaN } },
    })).toBeUndefined()
    expect(tracker.update({
      type: "assistant",
      parent_tool_use_id: null,
      message: { usage: { input_tokens: 30, output_tokens: 5 } },
    })).toEqual({ usedTokens: 35 })
    expect(tracker.update({
      type: "result",
      modelUsage: {
        invalid: { contextWindow: Number.POSITIVE_INFINITY },
        only: { contextWindow: 128_000 },
      },
    })).toEqual({ usedTokens: 35, contextWindowTokens: 128_000, model: "only" })
  })
})
