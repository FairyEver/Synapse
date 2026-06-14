import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { describe, expect, it, vi } from "vitest"
import WebSocket from "ws"

import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../runtime/network"
import type { PermissionGuard } from "../../../runtime/security"
import { InMemoryAuditSink } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type {
  AgentMessage,
  AgentPermissionResponseRequest,
  AgentRuntimeTurnResult,
} from "../../agent-runtime"
import type { ReplyTarget } from "../../reply-target"
import type { SideChannelService } from "../../side-channel"
import { BridgeAdapterService } from "../bridge-adapter-service"
import { BRIDGE_MESSAGE_CONTENT_MAX_CHARS } from "../bridge-protocol"
import type { BridgeOutboundDispatcher } from "../types"

describe("BridgeAdapterService", () => {
  it("registers adapters, defaults text capability, and replaces same-platform connections", async () => {
    const { service, port } = await startBridge()
    const first = await openBridge(port, "tok")
    first.send(JSON.stringify({
      type: "register",
      platform: "bridge",
      capabilities: [],
      metadata: { token: "hidden", visible: true },
    }))
    await expect(readJson(first)).resolves.toEqual({ type: "register_ack", ok: true })

    expect(service.listAdapters()).toEqual([
      expect.objectContaining({
        platform: "bridge",
        capabilities: ["text"],
        metadata: { visible: true },
        connected: true,
      }),
    ])

    const second = await openBridge(port, "tok")
    second.send(JSON.stringify({
      type: "register",
      platform: "bridge",
      capabilities: ["card"],
    }))
    await expect(readJson(second)).resolves.toEqual({ type: "register_ack", ok: true })

    expect(service.listAdapters()).toEqual([
      expect.objectContaining({
        platform: "bridge",
        capabilities: ["card", "text"],
        connected: true,
      }),
    ])
    first.close()
    second.close()
    await service.stop()
  })

  it("requires auth for WebSocket registration", async () => {
    const { service, port } = await startBridge()
    await expect(openBridge(port, "")).rejects.toThrow()
    await service.stop()
  })

  it("records denied audit when network listen permission is rejected", async () => {
    const auditSink = new InMemoryAuditSink()
    const service = new BridgeAdapterService({
      projectContainers: fakeProjectContainers(new FakeAgentRuntime()),
      networkRegistry: createNetworkServiceRegistry(),
      sideChannel: new FakeSideChannel() as unknown as SideChannelService,
      listProjects: async () => [{ projectId: "project-1", name: "Project", workspacePath: "/repo" }],
      permissionGuard: denyPermissionGuard(),
      auditSink,
      token: "tok",
      preferredPort: 49998,
    })

    await expect(service.start()).rejects.toThrow("denied by test-policy")

    expect(auditSink.list()).toEqual([
      expect.objectContaining({
        action: "network.listen",
        actor: { kind: "user" },
        resource: "127.0.0.1:49998/bridge/ws",
        outcome: "denied",
        metadata: expect.objectContaining({
          serviceId: "bridge.adapter",
          reason: "denied by test-policy",
          policyId: "test-policy",
        }),
      }),
    ])
  })

  it("routes inbound bridge message to AgentMessage", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text", "typing"])

    ws.send(JSON.stringify({
      type: "message",
      msg_id: "m1",
      session_key: "bridge:room:user",
      user_id: "u1",
      user_name: "User One",
      content: "hello",
      reply_ctx: "ctx-1",
      project: "project-1",
    }))

    await expectEventually(() => agent.messages.length, 1)
    expect(agent.messages[0]).toEqual(expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:room:user",
      platform: "bridge",
      messageId: "m1",
      userId: "u1",
      userName: "User One",
      content: "hello",
      replyCtx: expect.objectContaining({
        kind: "bridge",
        platform: "bridge",
        replyCtx: "ctx-1",
        capabilities: ["text", "typing"],
      }),
    }))
    ws.close()
    await service.stop()
  })

  it("rejects oversized inbound bridge messages before agent dispatch", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text"])

    ws.send(JSON.stringify({
      type: "message",
      session_key: "bridge:room:user",
      user_id: "u1",
      content: "x".repeat(BRIDGE_MESSAGE_CONTENT_MAX_CHARS + 1),
      reply_ctx: "ctx-1",
      project: "project-1",
    }))

    await expect(readJson(ws)).resolves.toMatchObject({
      type: "error",
      error: {
        code: "invalid_message",
      },
    })
    expect(agent.messages).toEqual([])
    ws.close()
    await service.stop()
  })

  it("logs inbound Agent message send failures without exposing raw SDK errors", async () => {
    const logger = createLogger()
    const agent = new FailingAgentRuntime("SDK failed for prompt secret-token at /Users/liyang/private")
    const { service, port } = await startBridge(agent, { logger })
    const ws = await registeredBridge(port, "tok", ["text"])

    ws.send(JSON.stringify({
      type: "message",
      msg_id: "m-fail",
      session_key: "bridge:room:user",
      user_id: "u1",
      content: "hello",
      reply_ctx: "ctx-1",
      project: "project-1",
    }))

    await expect(readJson(ws)).resolves.toEqual(expect.objectContaining({
      type: "error",
      session_key: "bridge:room:user",
      reply_ctx: "ctx-1",
      error: {
        code: "message_failed",
        message: "Agent message failed",
      },
    }))
    expect(logger.warn).toHaveBeenCalledWith("Bridge inbound Agent message failed.", expect.objectContaining({
      projectId: "project-1",
      sessionKey: "bridge:room:user",
      messageId: "m-fail",
      platform: "bridge",
      boundary: "agent.send",
      errorName: "Error",
      errorLength: "SDK failed for prompt secret-token at /Users/liyang/private".length,
    }))
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/liyang/private")
    ws.close()
    await service.stop()
  })

  it("handles card_action permission allow and deny", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text"])

    ws.send(JSON.stringify({
      type: "card_action",
      session_key: "bridge:s1",
      action: "perm:req-1:allow",
      reply_ctx: "ctx",
      project: "project-1",
    }))
    ws.send(JSON.stringify({
      type: "card_action",
      session_key: "bridge:s1",
      action: "perm:req-2:deny",
      reply_ctx: "ctx",
      project: "project-1",
    }))

    await expectEventually(() => agent.permissions.length, 2)
    expect(agent.permissions).toEqual([
      expect.objectContaining({
        requestId: "req-1",
        behavior: "allow",
        actor: { kind: "user", id: "bridge:bridge" },
      }),
      expect.objectContaining({
        requestId: "req-2",
        behavior: "deny",
      }),
    ])
    ws.close()
    await service.stop()
  })

  it("includes project in generated permission cards for multi-project responses", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent, {
      projects: [
        { projectId: "project-1", name: "Project 1", workspacePath: "/repo-1" },
        { projectId: "project-2", name: "Project 2", workspacePath: "/repo-2" },
      ],
    })
    const ws = await registeredBridge(port, "tok", ["text", "card"])
    const cardMessage = readJson(ws) as Promise<{
      readonly type: "card"
      readonly session_key: string
      readonly reply_ctx: unknown
      readonly project?: string
      readonly card: {
        readonly actions: readonly { readonly action: string }[]
      }
    }>

    await service.dispatchAgentEvent(bridgeTarget(), {
      type: "permissionRequest",
      requestId: "req-1",
      toolName: "Bash",
    })

    const card = await cardMessage
    expect(card.project).toBe("project-1")
    const action = card.card.actions[0]?.action
    expect(action).toBe("perm:req-1:allow")
    ws.send(JSON.stringify({
      type: "card_action",
      session_key: card.session_key,
      action,
      reply_ctx: card.reply_ctx,
      project: card.project,
    }))

    await expectEventually(() => agent.permissions.length, 1)
    expect(agent.permissions[0]).toEqual(expect.objectContaining({
      requestId: "req-1",
      behavior: "allow",
    }))
    ws.close()
    await service.stop()
  })

  it("sends AskUserQuestion bridge cards as answer prompts instead of permission cards", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text", "card"])
    const cardMessage = readJson(ws) as Promise<{
      readonly type: "card"
      readonly card: {
        readonly title: string
        readonly body: string
        readonly actions: readonly { readonly label: string; readonly action: string }[]
      }
    }>

    await service.dispatchAgentEvent(bridgeTarget(), {
      type: "permissionRequest",
      requestId: "question-1",
      toolName: "AskUserQuestion",
      questions: [{
        header: "Pick one",
        question: "你最想学哪门编程语言？",
        options: [
          { label: "Python", description: "AI/数据科学" },
          { label: "TypeScript", description: "前端全栈" },
        ],
        multiSelect: false,
      }],
    })

    const message = await cardMessage
    expect(message.card.title).toBe("Answer required")
    expect(message.card.body).toContain("Pick one: 你最想学哪门编程语言？")
    expect(message.card.body).toContain("- Python: AI/数据科学")
    expect(message.card.actions).toEqual([
      { label: "Submit answer", action: "question:question-1:answer" },
      { label: "Skip", action: "perm:question-1:deny" },
    ])
    expect(JSON.stringify(message)).not.toContain("Permission required")
    expect(JSON.stringify(message)).not.toContain("Allow")
    ws.close()
    await service.stop()
  })

  it("submits AskUserQuestion answers from bridge card actions", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text", "card"])

    ws.send(JSON.stringify({
      type: "card_action",
      session_key: "bridge:s1",
      action: "question:question-1:answer",
      updated_input: {
        answers: {
          "选一个？": "A",
        },
      },
      reply_ctx: "ctx",
      project: "project-1",
    }))

    await expectEventually(() => agent.permissions.length, 1)
    expect(agent.permissions[0]).toEqual(expect.objectContaining({
      requestId: "question-1",
      behavior: "allow",
      actor: { kind: "user", id: "bridge:bridge" },
      updatedInput: {
        answers: {
          "选一个？": "A",
        },
      },
    }))
    ws.close()
    await service.stop()
  })

  it("rejects AskUserQuestion answer actions without answers", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text", "card"])

    ws.send(JSON.stringify({
      type: "card_action",
      session_key: "bridge:s1",
      action: "question:question-1:answer",
      updated_input: {},
      reply_ctx: "ctx",
      project: "project-1",
    }))

    await expect(readJson(ws)).resolves.toEqual(expect.objectContaining({
      type: "error",
      session_key: "bridge:s1",
      reply_ctx: "ctx",
      error: {
        code: "invalid_card_action",
        message: "question answers are required",
      },
    }))
    expect(agent.permissions).toEqual([])
    ws.close()
    await service.stop()
  })

  it("does not expose raw permission response failures to bridge adapters", async () => {
    const agent = new FailingPermissionAgentRuntime("permission failed at /Users/liyang/private token=secret")
    const { service, port } = await startBridge(agent)
    const ws = await registeredBridge(port, "tok", ["text"])

    ws.send(JSON.stringify({
      type: "card_action",
      session_key: "bridge:s1",
      action: "perm:req-1:allow",
      reply_ctx: "ctx",
      project: "project-1",
    }))

    const response = await readJson(ws)
    expect(response).toEqual(expect.objectContaining({
      type: "error",
      session_key: "bridge:s1",
      reply_ctx: "ctx",
      error: {
        code: "permission_response_failed",
        message: "Permission response failed",
      },
    }))
    expect(JSON.stringify(response)).not.toContain("/Users/liyang/private")
    expect(JSON.stringify(response)).not.toContain("secret")
    ws.close()
    await service.stop()
  })

  it("sends reply, compact progress, typing, and side-channel payloads to fake adapter", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text", "typing", "update_message", "image"])
    const target = bridgeTarget()
    const messages = readJsonN(ws, 6)

    await service.dispatchAgentEvent(target, { type: "thinking", content: "thinking" })
    await service.dispatchAgentEvent(target, { type: "toolUse", toolName: "Bash" })
    await service.dispatchAgentEvent(target, { type: "result", content: "done", done: true })
    await service.dispatchSideChannelSend(target, {
      message: "chart",
      attachments: [{
        kind: "image",
        fileName: "chart.png",
        mimeType: "image/png",
        bytes: Buffer.from("image"),
        size: 5,
      }],
    })

    const received = await messages
    expect(received[0]).toEqual(expect.objectContaining({ type: "typing_start" }))
    expect(received[1]).toEqual(expect.objectContaining({
      type: "update_message",
      content: expect.stringContaining("Thinking"),
    }))
    expect(received[2]).toEqual(expect.objectContaining({
      type: "update_message",
      content: expect.stringContaining("Using Bash"),
    }))
    expect(received[3]).toEqual(expect.objectContaining({
      type: "typing_stop",
    }))
    expect(received[4]).toEqual(expect.objectContaining({
      type: "reply",
      content: "done",
    }))
    expect(received[5]).toEqual(expect.objectContaining({
      type: "reply",
      content: "chart",
      attachments: [expect.objectContaining({ kind: "image", file_name: "chart.png" })],
    }))
    ws.close()
    await service.stop()
  })

  it("uses preview_start, preview_ack, and update_message for streamed text", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text", "preview", "update_message"])
    const target = bridgeTarget()

    const stream = service.dispatchAgentEvent(target, { type: "text", content: "hello" })
    const preview = await readJson(ws) as { ref_id: string }
    expect(preview).toEqual(expect.objectContaining({
      type: "preview_start",
      content: "hello",
    }))
    ws.send(JSON.stringify({
      type: "preview_ack",
      ref_id: preview.ref_id,
      preview_handle: "preview-1",
    }))
    await stream

    const final = readJson(ws)
    await service.dispatchAgentEvent(target, { type: "result", content: "hello world", done: true })
    await expect(final).resolves.toEqual(expect.objectContaining({
      type: "update_message",
      preview_handle: "preview-1",
      content: "hello world",
    }))
    ws.close()
    await service.stop()
  })

  it("logs preview ack timeouts before falling back to a reply", async () => {
    const logger = createLogger()
    const { service, port } = await startBridge(new FakeAgentRuntime(), { logger })
    const ws = await registeredBridge(port, "tok", ["text", "preview", "update_message"])
    const target = bridgeTarget()

    const stream = service.dispatchAgentEvent(target, { type: "text", content: "hello" })
    await expect(readJson(ws)).resolves.toEqual(expect.objectContaining({
      type: "preview_start",
      content: "hello",
    }))
    await stream

    const final = readJson(ws)
    await service.dispatchAgentEvent(target, { type: "result", content: "hello world", done: true })

    await expect(final).resolves.toEqual(expect.objectContaining({
      type: "reply",
      content: "hello world",
    }))
    expect(logger.warn).toHaveBeenCalledWith("Bridge preview ack failed; falling back to reply.", expect.objectContaining({
      projectId: "project-1",
      conversationId: "conv-1",
      sessionKey: "bridge:s1",
      adapterId: expect.any(String),
      platform: "bridge",
      stage: "preview_start",
      failureType: "timeout",
    }))
    ws.close()
    await service.stop()
  })

  it("publishes command capabilities to control-plane adapters", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const ws = await openBridge(port, "tok")
    const messages = readJsonN(ws, 2)
    ws.send(JSON.stringify({
      type: "register",
      platform: "bridge",
      capabilities: ["text"],
      metadata: { control_plane: ["capabilities_snapshot_v1"] },
    }))

    const received = await messages
    expect(received[0]).toEqual({ type: "register_ack", ok: true })
    expect(received[1]).toEqual(expect.objectContaining({
      type: "capabilities_snapshot",
      projects: [expect.objectContaining({
        project: "project-1",
        commands: [expect.objectContaining({ name: "status" })],
      })],
    }))
    ws.close()
    await service.stop()
  })

  it("redacts command capability listing failures", async () => {
    const logger = createLogger()
    const agent = new FakeAgentRuntime()
    agent.listPublishedCommands = async () => {
      throw new Error("SDK command failed for secret prompt /Users/liyang/private sk-test")
    }
    const { service, port } = await startBridge(agent, { logger })
    const ws = await openBridge(port, "tok")
    const messages = readJsonN(ws, 2)
    ws.send(JSON.stringify({
      type: "register",
      platform: "bridge",
      capabilities: ["text"],
      metadata: { control_plane: ["capabilities_snapshot_v1"] },
    }))

    const received = await messages
    expect(received[1]).toEqual(expect.objectContaining({
      type: "capabilities_snapshot",
      projects: [expect.objectContaining({
        project: "project-1",
        commands: [],
      })],
    }))
    expect(logger.warn).toHaveBeenCalledWith(
      "Bridge capabilities command listing failed.",
      expect.objectContaining({
        projectId: "project-1",
        platform: "bridge",
        errorName: "Error",
        errorLength: "SDK command failed for secret prompt /Users/liyang/private sk-test".length,
      }),
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/liyang/private")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sk-test")
    ws.close()
    await service.stop()
  })

  it("falls back to text when card and update capabilities are missing", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text"])
    const target = bridgeTarget()
    const messages = readJsonN(ws, 2)

    await service.dispatchAgentEvent(target, {
      type: "permissionRequest",
      requestId: "req-1",
      toolName: "Bash",
    })
    await service.dispatchAgentEvent(target, { type: "toolResult", toolName: "Bash", content: "ok" })

    const received = await messages
    expect(received[0]).toEqual(expect.objectContaining({
      type: "reply",
      content: "Permission required: Bash",
    }))
    expect(received[1]).toEqual(expect.objectContaining({
      type: "reply",
      content: expect.stringContaining("ok"),
    }))
    ws.close()
    await service.stop()
  })

  it("falls back to answer prompt text for AskUserQuestion without card capability", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text"])
    const message = readJson(ws) as Promise<{ readonly content: string }>

    await service.dispatchAgentEvent(bridgeTarget(), {
      type: "permissionRequest",
      requestId: "question-1",
      toolName: "AskUserQuestion",
      questions: [{
        question: "选一个？",
        options: [
          { label: "A" },
          { label: "B" },
        ],
        multiSelect: false,
      }],
    })

    const received = await message
    expect(received.content).toContain("Answer required: 选一个？")
    expect(received.content).not.toContain("Permission required")
    ws.close()
    await service.stop()
  })

  it("supports session list, create, switch, delete, auth, and missing params", async () => {
    const agent = new FakeAgentRuntime()
    const { service, port } = await startBridge(agent)
    const base = `http://127.0.0.1:${String(port)}/bridge/sessions`

    expect((await fetch(`${base}?session_key=bridge:s1`)).status).toBe(401)
    const missing = await fetch(base, { headers: { Authorization: "Bearer tok" } })
    expect(missing.status).toBe(400)

    const created = await fetch(base, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ project: "project-1", session_key: "bridge:s1", name: "Main" }),
    })
    expect(created.status).toBe(200)
    const createdBody = await created.json() as { data: { id: string } }

    const listed = await fetch(`${base}?project=project-1&session_key=bridge:s1`, {
      headers: { Authorization: "Bearer tok" },
    })
    expect(await listed.json()).toEqual({
      ok: true,
      data: {
        sessions: [expect.objectContaining({ id: createdBody.data.id, name: "Main" })],
        active_session_id: createdBody.data.id,
      },
    })

    const second = await agent.createSession({ sessionKey: "bridge:s1", platform: "bridge", name: "Second" })
    const switched = await fetch(`${base}/switch`, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ project: "project-1", session_key: "bridge:s1", target: second.id }),
    })
    expect(await switched.json()).toEqual({
      ok: true,
      data: { message: "session switched", active_session_id: second.id },
    })

    const deleted = await fetch(`${base}/${second.id}?project=project-1&session_key=bridge:s1`, {
      method: "DELETE",
      headers: { Authorization: "Bearer tok" },
    })
    expect(deleted.status).toBe(200)
    expect(await agent.getSession(second.id)).toBeNull()
    await service.stop()
  })

  it("does not expose raw session HTTP failures to bridge adapters", async () => {
    const agent = new FailingSessionAgentRuntime("session failed at /Users/liyang/private token=secret")
    const { service, port } = await startBridge(agent)
    const base = `http://127.0.0.1:${String(port)}/bridge/sessions`

    const response = await fetch(base, {
      method: "POST",
      headers: { Authorization: "Bearer tok", "Content-Type": "application/json" },
      body: JSON.stringify({ project: "project-1", session_key: "bridge:s1", name: "Main" }),
    })
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body).toEqual({
      ok: false,
      error: "Bridge session request failed",
    })
    expect(JSON.stringify(body)).not.toContain("/Users/liyang/private")
    expect(JSON.stringify(body)).not.toContain("secret")
    await service.stop()
  })
})

async function startBridge(
  agent = new FakeAgentRuntime(),
  options: {
    readonly logger?: StructuredLogger
    readonly projects?: readonly { readonly projectId: string; readonly name: string; readonly workspacePath: string }[]
  } = {},
): Promise<{
  readonly service: BridgeAdapterService
  readonly port: number
  readonly sideChannel: FakeSideChannel
}> {
  const port = await getFreePort()
  const sideChannel = new FakeSideChannel()
  const service = new BridgeAdapterService({
    projectContainers: fakeProjectContainers(agent),
    networkRegistry: createNetworkServiceRegistry(),
    sideChannel: sideChannel as unknown as SideChannelService,
    listProjects: async () => options.projects ?? [{ projectId: "project-1", name: "Project", workspacePath: "/repo" }],
    auditSink: new InMemoryAuditSink(),
    logger: options.logger,
    token: "tok",
    preferredPort: port,
  })
  await service.start()
  return { service, port, sideChannel }
}

function createLogger(): StructuredLogger & {
  readonly warn: ReturnType<typeof vi.fn>
  readonly child: ReturnType<typeof vi.fn>
} {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
}

function denyPermissionGuard(): PermissionGuard {
  return {
    registerPolicy: vi.fn(() => () => {}),
    check: vi.fn(async () => ({
      allowed: false as const,
      reason: "denied by test-policy",
      policyId: "test-policy",
    })),
  }
}

async function registeredBridge(
  port: number,
  token: string,
  capabilities: readonly string[],
): Promise<WebSocket> {
  const ws = await openBridge(port, token)
  ws.send(JSON.stringify({ type: "register", platform: "bridge", capabilities }))
  await readJson(ws)
  return ws
}

function openBridge(port: number, token: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const headers = token ? { Authorization: `Bearer ${token}` } : undefined
    const ws = new WebSocket(`ws://127.0.0.1:${String(port)}/bridge/ws`, { headers })
    ws.once("open", () => resolve(ws))
    ws.once("error", reject)
    ws.once("unexpected-response", (_request, response) => {
      reject(new Error(`unexpected status ${String(response.statusCode)}`))
    })
  })
}

function readJson(ws: WebSocket): Promise<unknown> {
  return new Promise((resolve) => {
    ws.once("message", (data) => resolve(JSON.parse(data.toString()) as unknown))
  })
}

function readJsonN(ws: WebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve) => {
    const values: unknown[] = []
    const onMessage = (data: WebSocket.RawData) => {
      values.push(JSON.parse(data.toString()) as unknown)
      if (values.length === count) {
        ws.off("message", onMessage)
        resolve(values)
      }
    }
    ws.on("message", onMessage)
  })
}

async function getFreePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address() as AddressInfo
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolve()
    })
  })
  return address.port
}

function bridgeTarget(): ReplyTarget {
  return {
    projectId: "project-1",
    sessionKey: "bridge:s1",
    conversationId: "conv-1",
    transport: { kind: "bridge", connectorId: "bridge" },
    replyCtx: {
      kind: "bridge",
      platform: "bridge",
      replyCtx: "ctx-1",
    },
  }
}

class FakeSideChannel {
  dispatcher: BridgeOutboundDispatcher | undefined

  registerDispatcher(_kind: string, dispatcher: BridgeOutboundDispatcher): () => void {
    this.dispatcher = dispatcher
    return () => {
      this.dispatcher = undefined
    }
  }
}

class FakeAgentRuntime {
  readonly messages: AgentMessage[] = []
  readonly permissions: AgentPermissionResponseRequest[] = []
  private readonly sessions = new Map<string, ConversationEntryV1>()
  private nextId = 1

  async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    this.messages.push(message)
    return {
      conversationId: "conv-1",
      events: [],
      resultText: "",
    }
  }

  async respondPermission(request: AgentPermissionResponseRequest): Promise<void> {
    this.permissions.push(request)
  }

  async listSessions(): Promise<readonly ConversationEntryV1[]> {
    return [...this.sessions.values()]
  }

  async getSession(id: string): Promise<ConversationEntryV1 | null> {
    return this.sessions.get(id) ?? null
  }

  async createSession(input: {
    readonly sessionKey: string
    readonly platform?: string
    readonly name?: string
  }): Promise<ConversationEntryV1> {
    for (const session of this.sessions.values()) {
      if (session.sessionKey === input.sessionKey) {
        this.sessions.set(session.id, { ...session, active: false })
      }
    }
    const now = "2026-04-26T00:00:00.000Z"
    const session: ConversationEntryV1 = {
      id: `session-${String(this.nextId++)}`,
      schemaVersion: 1,
      projectId: "project-1",
      sessionKey: input.sessionKey,
      platform: input.platform,
      name: input.name,
      history: [],
      active: true,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(session.id, session)
    return session
  }

  async switchSession(sessionKey: string, id: string): Promise<ConversationEntryV1> {
    const target = this.sessions.get(id)
    if (!target || target.sessionKey !== sessionKey) throw new Error("session not found")
    for (const session of this.sessions.values()) {
      if (session.sessionKey === sessionKey) {
        this.sessions.set(session.id, { ...session, active: false })
      }
    }
    const updated = { ...target, active: true }
    this.sessions.set(id, updated)
    return updated
  }

  async deleteSession(id: string): Promise<boolean> {
    return this.sessions.delete(id)
  }

  async listPublishedCommands(): Promise<readonly Record<string, unknown>[]> {
    return [{
      name: "status",
      source: "builtin",
      kind: "builtin",
      adminOnly: false,
    }]
  }
}

class FailingAgentRuntime extends FakeAgentRuntime {
  constructor(private readonly failureMessage: string) {
    super()
  }

  override async send(message: AgentMessage): Promise<AgentRuntimeTurnResult> {
    this.messages.push(message)
    throw new Error(this.failureMessage)
  }
}

class FailingPermissionAgentRuntime extends FakeAgentRuntime {
  constructor(private readonly failureMessage: string) {
    super()
  }

  override async respondPermission(_request: AgentPermissionResponseRequest): Promise<void> {
    throw new Error(this.failureMessage)
  }
}

class FailingSessionAgentRuntime extends FakeAgentRuntime {
  constructor(private readonly failureMessage: string) {
    super()
  }

  override async createSession(input: {
    readonly sessionKey: string
    readonly platform?: string
    readonly name?: string
  }): Promise<ConversationEntryV1> {
    void input
    throw new Error(this.failureMessage)
  }
}

function fakeProjectContainers(agent: FakeAgentRuntime) {
  return {
    open: async () => ({
      projectId: "project-1",
      get: <T,>() => agent as unknown as T,
      inspect: () => [],
      dispose: async () => {},
    }),
    peek: () => undefined,
    close: async () => {},
    list: () => [],
    registerService: () => {},
    setQuota: () => {},
  }
}

async function expectEventually(read: () => number, expected: number): Promise<void> {
  for (let i = 0; i < 20; i += 1) {
    if (read() === expected) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  expect(read()).toBe(expected)
}
