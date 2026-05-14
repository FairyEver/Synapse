/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../components/agent-composer"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  track,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

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

  it("marks primary Agent composer actions for renderer action diagnostics", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="run"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          pendingMessages={[{
            id: "pending-1",
            target: {
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "local:renderer",
            },
            content: "failed message",
            createdAt: "2026-05-13T10:00:02.000Z",
            status: "failed",
            error: "发送失败",
          }]}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={(event) => event.preventDefault()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
          onRemovePendingMessage={vi.fn()}
          onRetryPendingMessage={vi.fn()}
        />,
      )
    })

    clickButton(container, "发送")
    clickButton(container, "重试发送")
    clickButton(container, "删除待发送消息")

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={true}
          cancelPhase="idle"
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })
    clickButton(container, "停止")

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={true}
          cancelPhase="cancel_pending"
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })
    clickButton(container, "强制停止")

    expect(track).toHaveBeenCalledWith({ component: "button", name: "agent-message-send", action: "click" })
    expect(track).toHaveBeenCalledWith({ component: "button", name: "agent-pending-message-retry", action: "click" })
    expect(track).toHaveBeenCalledWith({ component: "button", name: "agent-pending-message-remove", action: "click" })
    expect(track).toHaveBeenCalledWith({ component: "button", name: "agent-turn-stop", action: "click" })
    expect(track).toHaveBeenCalledWith({ component: "button", name: "agent-turn-force-stop", action: "click" })
  })
})

function clickButton(container: HTMLElement, label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`)
  expect(button).toBeTruthy()
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}
