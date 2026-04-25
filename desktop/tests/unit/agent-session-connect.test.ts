import { describe, expect, it } from "vitest"
import { AgentSessionConnectService, buildConnectorSessionPrompt } from "../../electron/services/agent-session-connect-service"
import { normalizeInboundMessage } from "../../electron/services/inbound-message-normalizer"
import { AgentSessionsRepository } from "../../electron/services/sessions-repository-service"

function now() {
  let tick = 0
  return () => new Date(Date.UTC(2026, 3, 25, 1, tick += 1, 0))
}

describe("agent session connector flow", () => {
  it("connects a normalized inbound message to the active agent session and reply context", () => {
    const clock = now()
    const normalized = normalizeInboundMessage({
      Platform: "feishu",
      SessionKey: "feishu:oc_chat:root:om_root",
      UserID: "ou_1",
      UserName: "Ada",
      ChatName: "Build Room",
      Content: "Summarize the diff",
      ReplyCtx: { messageId: "om_root" },
      Images: [{ name: "screen.png", ref: "img-1" }],
    }, {
      connectorId: "connector:feishu:build-room",
      now: clock,
    })

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) {
      return
    }

    const repository = new AgentSessionsRepository({ now: clock })
    const service = new AgentSessionConnectService()
    const result = service.connect({
      inbound: normalized.message,
      repository,
      agentType: "codex",
      now: clock,
      events: [
        { type: "text", content: "The diff updates session wiring.", sessionId: "agent-thread-1" },
        { type: "result", done: true },
      ],
    })

    expect(result.turn).toMatchObject({
      sessionId: "s1",
      prompt: "Summarize the diff\n\nAttachments:\n- image: screen.png",
      replyContext: { messageId: "om_root" },
    })
    expect(result.session).toMatchObject({
      id: "s1",
      agentType: "codex",
      agentSessionId: "agent-thread-1",
    })
    expect(result.outbound).toEqual({
      kind: "reply",
      content: "The diff updates session wiring.",
      replyContext: { messageId: "om_root" },
    })
    expect(repository.getOrCreateActive("feishu:oc_chat:root:om_root").id).toBe("s1")
    expect(repository.snapshot().userMeta).toEqual({
      "feishu:oc_chat:root:om_root": {
        userName: "Ada",
        chatName: "Build Room",
      },
    })
    expect(repository.findById("s1")?.history.map((entry) => [entry.role, entry.content])).toEqual([
      ["user", "Summarize the diff\n\nAttachments:\n- image: screen.png"],
      ["assistant", "The diff updates session wiring."],
    ])
  })

  it("keeps permission prompts pending instead of guessing a reply", () => {
    const clock = now()
    const normalized = normalizeInboundMessage({
      Platform: "telegram",
      UserID: "u1",
      Content: "edit files",
      ReplyCtx: "reply-1",
    }, { now: clock })

    expect(normalized.ok).toBe(true)
    if (!normalized.ok) {
      return
    }

    const result = new AgentSessionConnectService().connect({
      inbound: normalized.message,
      repository: new AgentSessionsRepository({ now: clock }),
      now: clock,
      events: [
        {
          type: "permission_request",
          requestId: "req-1",
          toolName: "Edit",
          toolInput: "desktop/src/App.tsx",
        },
      ],
    })

    expect(result.engineResult.status).toBe("waiting_permission")
    expect(result.outbound).toEqual({
      kind: "pending",
      reason: "permission",
      replyContext: "reply-1",
    })
  })

  it("builds prompts from content, extra text, location, and attachments", () => {
    expect(buildConnectorSessionPrompt({
      platform: "weixin",
      sessionKey: "weixin:user",
      channelKey: "weixin:user",
      userId: "user",
      content: "check this",
      attachments: [{ kind: "file", name: "report.pdf", ref: "file-1" }],
      extraContent: "forwarded from thread",
      location: { latitude: 31.2, longitude: 121.5, label: "Shanghai" },
      fromVoice: false,
      authorized: true,
      receivedAt: "2026-04-25T00:00:00.000Z",
    })).toBe(
      "check this\n\nforwarded from thread\n\nLocation: 31.2, 121.5 (Shanghai)\n\nAttachments:\n- file: report.pdf",
    )
  })
})
