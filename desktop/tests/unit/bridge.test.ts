import { describe, expect, it } from "vitest"
import { createNetworkServiceRegistry } from "../../electron/runtime/network"
import { BridgeService, bridgeCapabilitiesFromWire } from "../../electron/services/bridge-service"

describe("bridge service", () => {
  it("uses CC Connect defaults and registers a websocket descriptor through NetworkServiceRegistry", async () => {
    const service = new BridgeService({ path: "bridge/ws", tokenSecretRef: "secret:bridge" })
    const registry = createNetworkServiceRegistry({ probePort: async () => true })

    const binding = await registry.register(service.createNetworkDescriptor())

    expect(service.port).toBe(9810)
    expect(service.path).toBe("/bridge/ws")
    expect(binding).toEqual({ id: "connectors.bridge", port: 9810, bindAddress: "127.0.0.1" })
    expect(service.createNetworkDescriptor().auth).toEqual({
      kind: "bearer",
      tokenSecretRef: "secret:bridge",
    })
  })

  it("authenticates bridge adapters and requires platform registration", () => {
    const service = new BridgeService({ tokenValue: "secret" })

    expect(service.authenticate({ authorization: "Bearer secret" })).toBe(true)
    expect(service.authenticate({ bridgeToken: "secret" })).toBe(true)
    expect(service.authenticate({ queryToken: "secret" })).toBe(true)
    expect(service.authenticate({ authorization: "Bearer wrong" })).toBe(false)
    expect(service.registerAdapter({ platform: "", capabilities: ["text"] })).toEqual({
      ok: false,
      type: "register_ack",
      error: "platform name is required",
    })
  })

  it("registers adapters, replaces existing adapters, and sends capabilities snapshots on request", () => {
    const service = new BridgeService({ now: () => new Date("2026-04-26T00:31:00.000Z") })
    service.setPublishedCommands("demo", [
      { name: "help", description: "Help", source: "builtin", argsMode: "text" },
      { name: "deploy", description: "Deploy app", source: "custom", argsMode: "text" },
    ])

    const first = service.registerAdapter({
      platform: "bridge",
      capabilities: ["text"],
      metadata: { control_plane: ["capabilities_snapshot.v1"] },
    })

    expect(first.ok).toBe(true)
    if (!first.ok) {
      throw new Error(first.error)
    }
    expect(first.capabilitiesSnapshot?.projects[0]?.commands.map((command) => command.name)).toEqual(["help", "deploy"])

    service.registerAdapter({
      platform: "bridge",
      capabilities: ["text", "card"],
    })

    expect(service.listAdapters()).toEqual([{
      platform: "bridge",
      capabilities: ["card", "text"],
      metadata: {},
      status: "connected",
      connectedAt: "2026-04-26T00:31:00.000Z",
    }])
  })

  it("normalizes bridge adapter messages into inbound messages and session state", () => {
    const service = new BridgeService({ now: () => new Date("2026-04-26T00:32:00.000Z") })
    service.registerAdapter({
      platform: "mychat",
      capabilities: ["text", "image"],
      metadata: { adapter: "bot-gateway", progress_style: "card" },
    })

    const result = service.handleAdapterMessage("mychat", {
      type: "message",
      msg_id: "m1",
      session_key: "mychat:room-1:user-1",
      user_id: "user-1",
      user_name: "Alice",
      content: "hello bridge",
      reply_ctx: "ctx-1",
      images: [{ mime_type: "image/png", data: "ZmFrZXBuZw==", file_name: "test.png" }],
    }, "demo")

    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error)
    }
    expect(result.message).toMatchObject({
      connectorId: "connector:bridge:mychat",
      platform: "mychat",
      sessionKey: "mychat:room-1:user-1",
      userId: "user-1",
      userName: "Alice",
      content: "hello bridge",
      receivedAt: "2026-04-26T00:32:00.000Z",
    })
    expect(result.message.attachments).toEqual([{
      kind: "image",
      name: "test.png",
      mimeType: "image/png",
      hasInlineData: true,
    }])
    expect(result.replyContext).toMatchObject({
      platform: "mychat",
      sessionKey: "mychat:room-1:user-1",
      replyContext: "ctx-1",
      progressStyle: "card",
    })
    expect(service.listSessions("mychat:room-1:user-1")).toHaveLength(1)
  })

  it("reconstructs reply context only when adapter declares capability", () => {
    const service = new BridgeService()
    service.registerAdapter({ platform: "bridge", capabilities: ["text"] })

    expect(service.reconstructReplyContext("advisor-gemini", "bridge:1491487450722341088:relay")).toEqual({
      ok: false,
      error: "adapter \"bridge\" does not support reconstruct_reply",
    })

    service.registerAdapter({
      platform: "bridge",
      capabilities: ["text", "reconstruct_reply", "preview", "update_message", "card"],
      metadata: { adapter: "bot-gateway" },
    })

    const result = service.reconstructReplyContext("advisor-gemini", "bridge:1491487450722341088:relay")
    expect("ok" in result).toBe(false)
    if ("ok" in result) {
      throw new Error(result.error)
    }

    expect(result.platform).toBe("bridge")
    expect(result.progressStyle).toBe("card")
    expect(result.supportsProgressCardPayload).toBe(true)
    expect(JSON.parse(result.replyContext)).toEqual({
      kind: "bridge_reconstruct",
      v: 1,
      sender_project: "advisor-gemini",
      transport_chat_id: "1491487450722341088",
      transport_session_key: "bridge:1491487450722341088:relay",
    })
  })

  it("maps card actions to permission, question, command, or navigation dispatch", () => {
    const service = new BridgeService()
    service.registerAdapter({ platform: "web", capabilities: ["text"] })

    expect(service.handleCardAction("web", {
      session_key: "web:u1:u1",
      action: "perm:allow_all",
      reply_ctx: "ctx",
    })).toMatchObject({ ok: true, dispatch: "message", content: "allow all" })
    expect(service.handleCardAction("web", {
      session_key: "web:u1:u1",
      action: "askq:selected",
      reply_ctx: "ctx",
    })).toMatchObject({ ok: true, dispatch: "message", content: "askq:selected" })
    expect(service.handleCardAction("web", {
      session_key: "web:u1:u1",
      action: "cmd:/new",
      reply_ctx: "ctx",
    })).toMatchObject({ ok: true, dispatch: "message", content: "/new" })
    expect(service.handleCardAction("web", {
      session_key: "web:u1:u1",
      action: "nav:/model",
      reply_ctx: "ctx",
    })).toMatchObject({ ok: true, dispatch: "navigation", action: "nav:/model" })
  })

  it("manages bridge sessions with create, switch, and delete semantics", () => {
    const service = new BridgeService()
    const first = service.createSession("web:u1:u1", "first")
    const second = service.createSession("web:u1:u1", "second")

    expect(service.listSessions("web:u1:u1").map((session) => [session.name, session.active])).toEqual([
      ["first", false],
      ["second", true],
    ])
    expect(service.switchSession("web:u1:u1", first.id)?.id).toBe(first.id)
    expect(service.deleteSession("web:u1:u1", second.id)).toBe(true)
    expect(service.deleteSession("web:u1:u1", second.id)).toBe(false)
  })

  it("normalizes wire capabilities with text always enabled", () => {
    expect(bridgeCapabilitiesFromWire(["card", "text", "card"])).toEqual(["card", "text"])
    expect(bridgeCapabilitiesFromWire("bad")).toEqual(["text"])
  })
})
