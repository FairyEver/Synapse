import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../components/agent-composer"

describe("AgentComposer", () => {
  it("renders a ChatGPT-style input with an icon-only send button", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="你好"
        disabled={false}
        canSend={true}
        sending={false}
        cancelPhase="idle"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("agent-composer")
    expect(html).toContain("agent-composer__container")
    expect(html).toContain("agent-composer__input")
    expect(html).toContain("agent-composer__send")
    expect(html).toContain('aria-label="发送"')
    expect(html).toContain('placeholder="输入消息"')
    expect(html).toContain("你好")
    expect(html).not.toContain(">发送</button>")
  })

  it("disables send button when canSend is false", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("disabled")
  })

  it("renders queued and failed messages above the input", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={true}
        cancelPhase="idle"
        pendingMessages={[
          {
            id: "pending-1",
            target: {
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "local:renderer",
            },
            content: "queued message",
            createdAt: "2026-05-13T10:00:00.000Z",
            status: "queued",
          },
          {
            id: "pending-2",
            target: {
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "local:renderer",
            },
            content: "sending message",
            createdAt: "2026-05-13T10:00:01.000Z",
            status: "sending",
          },
          {
            id: "pending-3",
            target: {
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "local:renderer",
            },
            content: "failed message",
            createdAt: "2026-05-13T10:00:02.000Z",
            status: "failed",
            error: "发送失败",
          },
        ]}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
        onRemovePendingMessage={vi.fn()}
        onRetryPendingMessage={vi.fn()}
      />,
    )

    expect(html).toContain("queued message")
    expect(html).toContain("failed message")
    expect(html).toContain("发送失败")
    expect(html).not.toContain("sending message")
    expect(html).toContain('aria-label="删除待发送消息"')
    expect(html).toContain('aria-label="重试发送"')
  })
})
