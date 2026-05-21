/**
 * @vitest-environment jsdom
 */
import { act, type FormEvent, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../components/agent-composer"
import { getPermissionModeCapability } from "../permission-mode-capability"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  mergeRefs: (...refs: Array<Ref<HTMLElement> | undefined>) => (node: HTMLElement | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node)
      else if (ref) ref.current = node
    }
  },
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
  it("requires a new session when switching a non-bypass conversation to bypassPermissions", () => {
    expect(getPermissionModeCapability({
      currentMode: "default",
      targetMode: "bypassPermissions",
    })).toBe("requiresNewSession")
  })

  it("treats selecting the current bypassPermissions mode as current", () => {
    expect(getPermissionModeCapability({
      currentMode: "bypassPermissions",
      targetMode: "bypassPermissions",
    })).toBe("current")
  })

  it("keeps auto as confirmable", () => {
    expect(getPermissionModeCapability({
      currentMode: "default",
      targetMode: "auto",
    })).toBe("confirmable")
  })

  it("renders a Claude-style input box with an icon-only send button", () => {
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
    expect(html).toContain("agent-composer-input-box")
    expect(html).toContain("agent-composer-input-box__editor")
    expect(html).toContain("agent-composer-input-box__toolbar")
    expect(html).toContain("agent-composer__input")
    expect(html).toContain("agent-composer__send")
    expect(html).toContain("agent-composer__permission-trigger")
    expect(html).toContain("默认")
    expect(html).toContain("lucide-chevron-down")
    expect(html).toContain('aria-label="发送"')
    expect(html).toContain('placeholder="输入消息"')
    expect(html).toContain("你好")
    expect(html).not.toContain(">发送</button>")
    expect(html).not.toContain("lucide-shield-check")
  })

  it("places the permission mode selector next to the send button with the selected label", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft="run"
        disabled={false}
        canSend={true}
        sending={false}
        cancelPhase="idle"
        permissionMode="bypassPermissions"
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    const permissionIndex = html.indexOf("agent-composer__permission-trigger")
    const sendIndex = html.indexOf("agent-composer__send")

    expect(permissionIndex).toBeGreaterThan(-1)
    expect(sendIndex).toBeGreaterThan(permissionIndex)
    expect(html).toContain('aria-label="权限模式：跳过权限"')
    expect(html).toContain(">跳过权限")
    expect(html).toContain("lucide-chevron-down")
  })

  it("keeps the composer visual treatment isolated in the input box component", () => {
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

    expect(html).toContain("agent-composer-input-box rounded-2xl border border-border bg-card")
    expect(html).toContain("focus-within:border-ring")
    expect(html).toContain("agent-composer-input-box__toolbar flex items-center justify-between")
    expect(html).toContain("agent-composer__input max-h-40 min-h-12")
    expect(html).toContain("px-2")
    expect(html).toContain("py-2")
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

  it("renders all permission modes in the selector", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          permissionMode="default"
          onPermissionModeChange={vi.fn()}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openPermissionMenu(container)

    expect(container.innerHTML).toContain("权限模式")
    expect(document.body.textContent).toContain("默认")
    expect(document.body.textContent).toContain("接受编辑")
    expect(document.body.textContent).toContain("计划")
    expect(document.body.textContent).toContain("自动")
    expect(document.body.textContent).toContain("不再询问")
    expect(document.body.textContent).toContain("跳过权限")
  })

  it("shows the original SDK mode name and description in a left-side hover card", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          permissionMode="default"
          onPermissionModeChange={vi.fn()}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openPermissionMenu(container)
    const item = getPermissionModeItem("bypassPermissions")
    expect(item.textContent).toContain("跳过权限")

    await hoverElement(item)

    expect(document.body.textContent).toContain("bypassPermissions")
    expect(document.body.textContent).toContain("跳过所有权限确认")
  })

  it("shows provider availability only for modes with provider limitations", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          permissionMode="default"
          onPermissionModeChange={vi.fn()}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openPermissionMenu(container)
    await hoverPermissionMode("auto")

    expect(document.body.textContent).toContain("部分服务不可用")
    expect(document.body.textContent).toContain("切换失败时请换其他模式")

    await hoverPermissionMode("default")

    expect(document.body.textContent).not.toContain("部分服务不可用")
  })

  it("opens a new-session dialog for bypassPermissions instead of switching live mode", async () => {
    const onPermissionModeChange = vi.fn(async () => {})
    const onCreatePermissionModeSession = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          permissionMode="default"
          onPermissionModeChange={onPermissionModeChange}
          onCreatePermissionModeSession={onCreatePermissionModeSession}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openPermissionMenu(container)
    const dangerousItem = getPermissionModeItem("bypassPermissions")
    await act(async () => {
      dangerousItem.click()
    })

    expect(onPermissionModeChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("需要新会话")
    expect(document.body.textContent).toContain("跳过权限只能在会话启动时启用。")

    const confirm = Array.from(document.querySelectorAll("button"))
      .find((button) => button.textContent === "新建会话") as HTMLButtonElement
    await act(async () => {
      confirm.click()
    })

    expect(onPermissionModeChange).not.toHaveBeenCalled()
    expect(onCreatePermissionModeSession).toHaveBeenCalledWith("bypassPermissions")
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

  it("tracks composer submits without recording message content", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="secret prompt text"
          disabled={false}
          canSend={true}
          sending={true}
          cancelPhase="idle"
          pendingMessages={[{
            id: "pending-1",
            target: {
              projectId: "project-1",
              conversationId: "conversation-1",
              sessionKey: "local:renderer",
            },
            content: "queued message",
            createdAt: "2026-05-13T10:00:02.000Z",
            status: "queued",
          }]}
          permissionMode="auto"
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const form = container.querySelector("form")
    expect(form).toBeTruthy()
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "agent",
      name: "agent-message-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.agent.composer-submit",
        draftLength: 18,
        canSend: true,
        sending: true,
        pendingCount: 1,
        permissionMode: "auto",
      },
    })
    expect(JSON.stringify(track.mock.calls)).not.toContain("secret prompt text")
  })

  it("opens the slash menu and inserts the highlighted item with Enter", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const onInputKeyDown = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Please /rev now"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "review-code",
              description: "Review code changes",
              kind: "skill",
              source: "skill",
            },
          ]}
          onDraftChange={onDraftChange}
          onInputKeyDown={onInputKeyDown}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(11, 11)

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onDraftChange).toHaveBeenCalledWith("Please /review-code now")
    expect(onSubmit).not.toHaveBeenCalled()
    expect(onInputKeyDown).not.toHaveBeenCalled()
  })

  it("closes the slash menu with Escape without changing the draft", async () => {
    const onDraftChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Run /status"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "status",
              description: "Show agent status",
              kind: "command",
              source: "builtin",
            },
          ]}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(11, 11)
    textarea!.dispatchEvent(new Event("select", { bubbles: true }))
    expect(container.textContent).toContain("/status")

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }))
    })

    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("keeps normal Enter submission when no slash menu is active", async () => {
    const onInputKeyDown = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Send this message"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "status",
              description: "Show agent status",
              kind: "command",
              source: "builtin",
            },
          ]}
          onDraftChange={vi.fn()}
          onInputKeyDown={onInputKeyDown}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onInputKeyDown).toHaveBeenCalled()
  })

  it("closes the slash menu when clicking outside the composer", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const outside = document.createElement("button")
    outside.type = "button"
    outside.textContent = "outside"
    document.body.appendChild(outside)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="Run /status"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[
            {
              name: "status",
              description: "Show agent status",
              kind: "command",
              source: "builtin",
            },
          ]}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(11, 11)
    await act(async () => {
      textarea!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(container.textContent).toContain("Show agent status")

    await act(async () => {
      outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }))
    })

    expect(container.textContent).not.toContain("Show agent status")
  })
})

function clickButton(container: HTMLElement, label: string) {
  const button = container.querySelector(`button[aria-label="${label}"]`)
  expect(button).toBeTruthy()
  act(() => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function openPermissionMenu(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-label^="权限模式"]')
  expect(trigger).toBeTruthy()
  act(() => {
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function getPermissionModeItem(mode: string) {
  const item = document.querySelector(`[data-mode="${mode}"]`)
  expect(item).toBeTruthy()
  return item as HTMLElement
}

async function hoverPermissionMode(mode: string) {
  await hoverElement(getPermissionModeItem(mode))
}

async function hoverElement(element: HTMLElement) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }))
    element.dispatchEvent(new MouseEvent("pointerenter", { bubbles: false }))
    element.dispatchEvent(new MouseEvent("pointermove", { bubbles: true }))
    element.focus()
    await wait(120)
  })
}
