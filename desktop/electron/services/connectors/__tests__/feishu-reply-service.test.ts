import { describe, expect, it } from "vitest"

import type { ReplyTarget } from "../../reply-target"
import type { FeishuReplyContext, FeishuRuntimeClient } from "../feishu/feishu-types"
import { FeishuReplyService } from "../feishu/reply-service"

describe("FeishuReplyService", () => {
  it("routes agent replies, permission cards, and side-channel attachments to Feishu client", async () => {
    const client = new FakeFeishuClient()
    const service = new FeishuReplyService({
      clientForConnector: () => client,
    })
    const target = feishuTarget()

    await service.dispatchAgentEvent(target, { type: "result", content: "done", done: true })
    await service.dispatchAgentEvent(target, {
      type: "permissionRequest",
      requestId: "req-1",
      toolName: "Bash",
    })
    await service.dispatchSideChannelSend(target, {
      message: "plot",
      attachments: [{
        kind: "image",
        fileName: "plot.png",
        mimeType: "image/png",
        bytes: Buffer.from("image"),
        size: 5,
      }, {
        kind: "file",
        fileName: "report.txt",
        mimeType: "text/plain",
        bytes: Buffer.from("file"),
        size: 4,
      }],
    })

    expect(client.calls).toEqual([
      ["replyText", "done"],
      ["sendCard", expect.objectContaining({
        elements: expect.arrayContaining([expect.any(Object)]),
      })],
      ["replyText", "plot"],
      ["sendImage", 5],
      ["sendFile", "report.txt", 4],
    ])
    expect(JSON.stringify(client.calls[1]?.[1])).toContain("req-1")
    expect(JSON.stringify(client.calls[1]?.[1])).toContain("project-1")
  })

  it("sends Codex-origin permission events through the shared card path", async () => {
    const client = new FakeFeishuClient()
    const service = new FeishuReplyService({
      clientForConnector: () => client,
    })

    await service.dispatchAgentEvent(feishuTarget(), {
      type: "permissionRequest",
      requestId: "codex-mcp-1",
      toolName: "MCP Elicitation",
      toolInput: "Authorize MCP",
      toolInputRaw: { serverName: "synapse-mcp" },
    })

    expect(client.calls).toEqual([
      ["sendCard", expect.objectContaining({
        elements: expect.arrayContaining([expect.any(Object)]),
      })],
    ])
    expect(JSON.stringify(client.calls[0]?.[1])).toContain("codex-mcp-1")
    expect(JSON.stringify(client.calls[0]?.[1])).toContain("MCP Elicitation")
  })

  it("buffers streamed text and sends one final reply", async () => {
    const client = new FakeFeishuClient()
    const service = new FeishuReplyService({
      clientForConnector: () => client,
    })
    const target = feishuTarget()

    await service.dispatchAgentEvent(target, { type: "text", content: "hello " })
    await service.dispatchAgentEvent(target, { type: "text", content: "world" })
    await service.dispatchAgentEvent(target, { type: "result", content: "hello world", done: true })

    expect(client.calls).toEqual([
      ["replyText", "hello world"],
    ])
  })

  it("uses CC connect style tool cards without a final reply footer", async () => {
    const client = new FakeFeishuClient()
    const service = new FeishuReplyService({
      clientForConnector: () => client,
    })
    const target = feishuTarget()

    await service.dispatchAgentEvent(target, {
      type: "toolUse",
      toolName: "Bash",
      toolInput: "/bin/zsh -lc \"echo hello\"",
    })
    await service.dispatchAgentEvent(target, {
      type: "toolResult",
      toolName: "Bash",
      content: "hello",
      status: "completed",
      exitCode: 0,
      success: true,
    })
    await service.dispatchAgentEvent(target, {
      type: "result",
      content: "你好。有什么要处理的？",
      done: true,
      metadata: {
        model: "gpt-5.5",
        effort: "xhigh",
        contextRemainingPercent: 95,
      },
    })

    expect(client.calls).toEqual([
      ["sendCard", expect.objectContaining({
        schema: "2.0",
        body: expect.objectContaining({
          elements: [expect.objectContaining({
            tag: "markdown",
            content: expect.stringContaining("🔧 **工具 #1: Bash**\n---\n```bash\n/bin/zsh -lc \"echo hello\"\n```"),
          })],
        }),
      })],
      ["replyText", "你好。有什么要处理的？"],
    ])
  })
})

function feishuTarget(): ReplyTarget {
  return {
    projectId: "project-1",
    sessionKey: "feishu:oc_group:ou_user",
    conversationId: "conv-1",
    messageId: "m1",
    transport: { kind: "feishu", connectorId: "feishu:project-1" },
    replyCtx: {
      kind: "feishu",
      projectId: "project-1",
      connectorId: "feishu:project-1",
      chatId: "oc_group",
      chatType: "group",
      messageId: "m1",
      userId: "ou_user",
      sessionKey: "feishu:oc_group:ou_user",
      replyInThread: true,
    },
  }
}

class FakeFeishuClient implements FeishuRuntimeClient {
  readonly calls: unknown[][] = []

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async fetchBotOpenId(): Promise<string | undefined> {
    return "ou_bot"
  }
  async replyText(_ctx: FeishuReplyContext, content: string): Promise<void> {
    this.calls.push(["replyText", content])
  }
  async createText(_ctx: FeishuReplyContext, content: string): Promise<void> {
    this.calls.push(["createText", content])
  }
  async sendCard(_ctx: FeishuReplyContext, card: Record<string, unknown>): Promise<void> {
    this.calls.push(["sendCard", card])
  }
  async sendImage(_ctx: FeishuReplyContext, image: Buffer): Promise<void> {
    this.calls.push(["sendImage", image.byteLength])
  }
  async sendFile(_ctx: FeishuReplyContext, fileName: string, file: Buffer): Promise<void> {
    this.calls.push(["sendFile", fileName, file.byteLength])
  }
}
