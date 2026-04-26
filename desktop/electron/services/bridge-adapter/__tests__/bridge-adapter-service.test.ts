import { createServer } from "node:net"
import type { AddressInfo } from "node:net"
import { describe, expect, it } from "vitest"
import WebSocket from "ws"

import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import { createNetworkServiceRegistry } from "../../../runtime/network"
import { InMemoryAuditSink } from "../../../runtime/security"
import type {
  AgentMessage,
  AgentPermissionResponseRequest,
  AgentRuntimeTurnResult,
} from "../../agent-runtime"
import type { ReplyTarget } from "../../reply-target"
import type { SideChannelService } from "../../side-channel"
import { BridgeAdapterService } from "../bridge-adapter-service"
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

  it("sends reply, update, typing, and side-channel payloads to fake adapter", async () => {
    const { service, port } = await startBridge()
    const ws = await registeredBridge(port, "tok", ["text", "typing", "update_message", "image"])
    const target = bridgeTarget()
    const messages = readJsonN(ws, 4)

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
    expect(received[0]).toEqual(expect.objectContaining({ type: "typing" }))
    expect(received[1]).toEqual(expect.objectContaining({
      type: "update_message",
      content: "Using Bash",
    }))
    expect(received[2]).toEqual(expect.objectContaining({
      type: "reply",
      content: "done",
    }))
    expect(received[3]).toEqual(expect.objectContaining({
      type: "reply",
      content: "chart",
      attachments: [expect.objectContaining({ kind: "image", file_name: "chart.png" })],
    }))
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
      content: "ok",
    }))
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
})

async function startBridge(agent = new FakeAgentRuntime()): Promise<{
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
    listProjects: async () => [{ projectId: "project-1", name: "Project", workspacePath: "/repo" }],
    auditSink: new InMemoryAuditSink(),
    token: "tok",
    preferredPort: port,
  })
  await service.start()
  return { service, port, sideChannel }
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
}

function fakeProjectContainers(agent: FakeAgentRuntime) {
  return {
    open: async () => ({
      projectId: "project-1",
      get: <T,>() => agent as unknown as T,
      inspect: () => [],
      dispose: async () => {},
    }),
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
