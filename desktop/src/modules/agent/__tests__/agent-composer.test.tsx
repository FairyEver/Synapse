/**
 * @vitest-environment jsdom
 */
import { act, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentComposer } from "../components/agent-composer"
import type { AgentDraftAttachment } from "../attachments"
import { getPermissionModeCapability } from "../permission-mode-capability"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const track = vi.hoisted(() => vi.fn())
const toast = vi.hoisted(() => vi.fn())

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

vi.mock("sonner", () => ({
  toast,
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
  delete (window as unknown as { synapse?: unknown }).synapse
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
    expect(html).toContain("按需询问")
    expect(html).toContain("lucide-chevron-down")
    expect(html).toContain('aria-label="发送"')
    expect(html).toContain('placeholder="输入消息"')
    expect(html).toContain("你好")
    expect(html).not.toContain(">发送</button>")
    expect(html).not.toContain("lucide-shield-check")
  })

  it("does not expose screenshot capture from the composer", () => {
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

    expect(html).not.toContain('aria-label="截图"')
    expect(html).not.toContain("agent-screenshot-capture")
  })

  it("renders the persona selector in ordinary mode", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        personaItems={[{
          id: "builtin-zh-en-translator",
          schemaVersion: 1,
          name: "中英翻译",
          description: "在中文和英文之间互译。",
          systemPrompt: "你是中英翻译智能体。",
          providerModel: null,
          source: "builtin",
          readonly: true,
        }]}
        activePersonaId={null}
        onPersonaChange={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="智能体"')
    expect(html).toContain("普通")
  })

  it("does not render the jump-to-bottom pill unless there are unread messages", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showJumpToBottom={false}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).not.toContain("↓ 新消息")
    expect(html).not.toContain("跳到最新消息")
  })

  it("renders the jump-to-bottom pill at the composer top-right", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showJumpToBottom
        onJumpToBottom={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
    expect(html).toContain("-top-11")
    expect(html).toContain("right-0")
  })

  it("renders the idle jump-to-bottom icon centered above the composer", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showIdleJumpToBottom
        onJumpToBottom={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain('aria-label="滚动到底部"')
    expect(html).toContain("absolute -top-11 left-1/2")
    expect(html).toContain("-translate-x-1/2")
    expect(html).not.toContain("↓ 新消息")
  })

  it("keeps the unread jump button ahead of the idle jump icon", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showJumpToBottom
        showIdleJumpToBottom
        onJumpToBottom={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).toContain("↓ 新消息")
    expect(html).toContain('aria-label="跳到最新消息"')
    expect(html).not.toContain('aria-label="滚动到底部"')
  })

  it("renders the one-hour context cache reminder inside the input box", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showConversationRolloverPrompt
        onStartNewConversation={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    const promptIndex = html.indexOf("已空闲较久，继续对话可能无法命中缓存")
    const inputBoxIndex = html.indexOf("agent-composer-input-box")
    const noticeIndex = html.indexOf("agent-composer-input-box__notice")
    const editorIndex = html.indexOf("agent-composer-input-box__editor")

    expect(promptIndex).toBeGreaterThan(-1)
    expect(inputBoxIndex).toBeGreaterThan(-1)
    expect(noticeIndex).toBeGreaterThan(inputBoxIndex)
    expect(editorIndex).toBeGreaterThan(-1)
    expect(promptIndex).toBeGreaterThan(noticeIndex)
    expect(editorIndex).toBeGreaterThan(promptIndex)
    expect(html).toContain("agent-composer-input-box__notice flex min-w-0 justify-center bg-muted/50")
    expect(html).toContain('aria-label="新建对话"')
    expect(html).toContain(">新建对话</button>")
    expect(html).not.toContain("继续当前对话可能按完整上下文计费")
    expect(html).not.toContain("继续会按完整上下文计费")
    expect(html).not.toContain("这个对话已经很长")
    expect(html).not.toContain("开始新对话")
  })

  it("keeps the one-hour reminder after the jump button and within the input box", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        showJumpToBottom
        showConversationRolloverPrompt
        onJumpToBottom={vi.fn()}
        onStartNewConversation={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    const jumpIndex = html.indexOf("跳到最新消息")
    const promptIndex = html.indexOf("已空闲较久，继续对话可能无法命中缓存")
    const inputBoxIndex = html.indexOf("agent-composer-input-box")

    expect(jumpIndex).toBeGreaterThan(-1)
    expect(inputBoxIndex).toBeGreaterThan(jumpIndex)
    expect(promptIndex).toBeGreaterThan(inputBoxIndex)
  })

  it("calls onStartNewConversation from the one-hour reminder link", async () => {
    const onStartNewConversation = vi.fn()
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
          showConversationRolloverPrompt
          onStartNewConversation={onStartNewConversation}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const button = container.querySelector('button[aria-label="新建对话"]')
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onStartNewConversation).toHaveBeenCalledTimes(1)
  })

  it("tracks the jump-to-bottom action from the composer", async () => {
    const onJumpToBottom = vi.fn()
    const container = document.createElement("div")
    const root = createRoot(container)
    roots.push(root)
    track.mockClear()

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          showJumpToBottom
          onJumpToBottom={onJumpToBottom}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const button = container.querySelector('button[aria-label="跳到最新消息"]')
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onJumpToBottom).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-timeline-jump-to-bottom",
      action: "click",
    })
  })

  it("uses the same jump action for the idle jump icon", async () => {
    const onJumpToBottom = vi.fn()
    const container = document.createElement("div")
    const root = createRoot(container)
    roots.push(root)
    track.mockClear()

    await act(async () => {
      root.render(
        <AgentComposer
          draft=""
          disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          showIdleJumpToBottom
          onJumpToBottom={onJumpToBottom}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const button = container.querySelector('button[aria-label="滚动到底部"]')
    expect(button).toBeTruthy()
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onJumpToBottom).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-timeline-idle-jump-to-bottom",
      action: "click",
    })
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
    expect(html).toContain('aria-label="权限模式：跳过权限确认"')
    expect(html).toContain(">跳过权限确认")
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

  it("renders a non-interactive background fade behind the composer", () => {
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

    expect(html).toContain('aria-hidden="true"')
    expect(html).toContain("agent-composer-fade")
    expect(html).toContain("pointer-events-none")
    expect(html).toContain("absolute inset-x-0 bottom-0")
    expect(html).toContain("bg-gradient-to-b")
    expect(html).toContain("from-background/0")
    expect(html).toContain("to-background")
    expect(html).not.toContain("to-background/80")
    expect(html).toContain("h-56")
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

  it("renders a pasted image attachment and lets users delete it", async () => {
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
    const image = imageFile([1, 2, 3], "screen.png", "image/png")

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => image,
        }],
      }))
      await wait(0)
    })

    expect(container.textContent).toContain("[Image #1]")
    expect(container.querySelector('button[aria-label^="删除附件"]')).toBeTruthy()

    await act(async () => {
      container.querySelector('button[aria-label^="删除附件"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(container.textContent).not.toContain("[Image #1]")
  })

  it("renders pasted non-image files as full path attachments", async () => {
    const filePathForDroppedFile = installShellBridge((file) =>
      file.name === "课堂内容.md" ? "/Users/liyang/Desktop/课堂内容.md" : null)
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
    const file = new File(["content"], "课堂内容.md", { type: "text/markdown" })

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "text/markdown",
          getAsFile: () => file,
        }],
        text: "课堂内容.md",
      }))
      await wait(0)
    })

    expect(filePathForDroppedFile).toHaveBeenCalledWith(file)
    expect(container.textContent).toContain("/Users/liyang/Desktop/课堂内容.md")
    expect(container.textContent).not.toContain("课堂内容.md片段")
    expect(container.querySelectorAll('button[aria-label^="删除附件"]')).toHaveLength(1)
  })

  it("submits pasted non-image files with their resolved full paths", async () => {
    installShellBridge((file) =>
      file.name === "课堂内容.md" ? "/Users/liyang/Desktop/课堂内容.md" : null)
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
    ) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "text/markdown",
          getAsFile: () => new File(["content"], "课堂内容.md", { type: "text/markdown" }),
        }],
        text: "课堂内容.md",
      }))
      await wait(0)
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[1]).toEqual([
      expect.objectContaining({
        kind: "path",
        path: "/Users/liyang/Desktop/课堂内容.md",
        entryType: "file",
        name: "课堂内容.md",
      }),
    ])
  })

  it("does not create pasted file attachments when the full path cannot be resolved", async () => {
    const filePathForDroppedFile = installShellBridge(() => null)
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
    ) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    const file = new File(["content"], "课堂内容.md", { type: "text/markdown" })

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "text/markdown",
          getAsFile: () => file,
        }],
        text: "课堂内容.md",
      }))
      await wait(0)
    })

    expect(filePathForDroppedFile).toHaveBeenCalledWith(file)
    expect(toast).toHaveBeenCalledWith("无法读取文件完整路径")
    expect(container.querySelectorAll('button[aria-label^="删除附件"]')).toHaveLength(0)
    expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("")

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton?.disabled).toBe(true)
  })

  it("renders dropped path files and folders as path context", async () => {
    const filePathForDroppedFile = installShellBridge()
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const file = withPath(new File(["content"], "brief.md", { type: "text/markdown" }), "/Users/liyang/Desktop/brief.md")
    const folder = withPath(new File([], "materials"), "/Users/liyang/Downloads/materials")
    const form = container.querySelector("form")
    expect(form).toBeTruthy()

    await act(async () => {
      form!.dispatchEvent(createDropEvent([file, folder]))
      await wait(0)
    })

    expect(container.textContent).toContain("/Users/liyang/Desktop/brief.md")
    expect(container.textContent).toContain("/Users/liyang/Downloads/materials")
    expect(container.querySelectorAll('button[aria-label^="删除附件"]')).toHaveLength(2)
    expect(filePathForDroppedFile).toHaveBeenCalledTimes(2)
  })

  it("resolves dropped file paths through the bridge before legacy file path fallback", async () => {
    const filePathForDroppedFile = installShellBridge((file) =>
      file.name === "bridge.md" ? "/Users/liyang/Bridge/bridge.md" : null)
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const file = withPath(new File(["content"], "bridge.md", { type: "text/markdown" }), "/legacy/bridge.md")
    const form = container.querySelector("form")
    expect(form).toBeTruthy()

    await act(async () => {
      form!.dispatchEvent(createDropEvent([file]))
      await wait(0)
    })

    expect(filePathForDroppedFile).toHaveBeenCalledWith(file)
    expect(container.textContent).toContain("/Users/liyang/Bridge/bridge.md")
    expect(container.textContent).not.toContain("/legacy/bridge.md")
  })

  it("does not create dropped path attachments from unresolved file names", async () => {
    const filePathForDroppedFile = installShellBridge(() => null)
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const file = new File(["content"], "brief.md", { type: "text/markdown" })
    const form = container.querySelector("form")
    expect(form).toBeTruthy()

    await act(async () => {
      form!.dispatchEvent(createDropEvent([file]))
      await wait(0)
    })

    expect(filePathForDroppedFile).toHaveBeenCalledWith(file)
    expect(toast).toHaveBeenCalledWith("无法读取文件完整路径")
    expect(container.textContent).not.toContain("brief.md")
    expect(container.querySelectorAll('button[aria-label^="删除附件"]')).toHaveLength(0)
  })

  it("submits attachment-only drafts when canSend is false because text is empty", async () => {
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
    ) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    const image = imageFile([4, 5], "visual.webp", "image/webp")

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/webp",
          getAsFile: () => image,
        }],
      }))
      await wait(0)
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()
    expect(sendButton!.disabled).toBe(false)

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(onSubmit.mock.calls[0]?.[1]).toHaveLength(1)
  })

  it("clears attachment rows after an accepted click submit", async () => {
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
      accept: () => void,
    ) => {
      event.preventDefault()
      accept()
    })
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => imageFile([8, 9], "accepted.png", "image/png"),
        }],
      }))
      await wait(0)
    })

    expect(container.textContent).toContain("[Image #1]")
    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("[Image #1]")
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')?.disabled).toBe(true)
  })

  it("keeps attachment rows when submit is not accepted", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => imageFile([1, 1], "rejected.png", "image/png"),
        }],
      }))
      await wait(0)
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("[Image #1]")
  })

  it("restores attachment rows when an accepted submit is restored", async () => {
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
      accept: () => () => void,
    ) => {
      event.preventDefault()
      const restore = accept()
      restore()
      restore()
    })
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => imageFile([3, 3], "restore.png", "image/png"),
        }],
      }))
      await wait(0)
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain("[Image #1]")
    expect(container.querySelectorAll('button[aria-label^="删除附件"]')).toHaveLength(1)
  })

  it("clears attachment rows after an accepted Enter submit", async () => {
    const onInputKeyDown = vi.fn((
      event: ReactKeyboardEvent<HTMLTextAreaElement>,
      _attachments: readonly AgentDraftAttachment[],
      accept: () => void,
    ) => {
      if (event.key !== "Enter") return
      event.preventDefault()
      accept()
    })
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
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => imageFile([2, 2], "enter-accepted.png", "image/png"),
        }],
      }))
      await wait(0)
    })

    expect(container.textContent).toContain("[Image #1]")

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onInputKeyDown).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("[Image #1]")
  })

  it("passes current attachments to Enter submissions", async () => {
    const onInputKeyDown = vi.fn((
      _event: unknown,
      _attachments: readonly AgentDraftAttachment[],
    ) => undefined)
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
    const image = imageFile([6, 7], "enter.png", "image/png")

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [{
          kind: "file",
          type: "image/png",
          getAsFile: () => image,
        }],
      }))
      await wait(0)
    })

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onInputKeyDown).toHaveBeenCalledTimes(1)
    const [, attachments] = onInputKeyDown.mock.calls[0] ?? []
    expect(attachments).toHaveLength(1)
    expect(attachments?.[0]).toMatchObject({
      kind: "image",
      name: "enter.png",
      mimeType: "image/png",
      size: 2,
    })
  })

  it("treats pasted absolute paths with trailing separators as directories", async () => {
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
    ) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [],
        text: "/Users/liyang/Downloads/materials/\nC:\\Users\\liyang\\Pictures\\",
      }))
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [, attachments] = onSubmit.mock.calls[0] ?? []
    expect(attachments).toEqual([
      expect.objectContaining({
        kind: "path",
        path: "/Users/liyang/Downloads/materials/",
        entryType: "directory",
        name: "materials",
      }),
      expect.objectContaining({
        kind: "path",
        path: "C:\\Users\\liyang\\Pictures\\",
        entryType: "directory",
        name: "Pictures",
      }),
    ])
  })

  it("treats pasted Windows UNC paths as path attachments", async () => {
    const onSubmit = vi.fn((
      event: FormEvent,
      _attachments: readonly AgentDraftAttachment[],
    ) => event.preventDefault())
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
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()

    await act(async () => {
      textarea!.dispatchEvent(createPasteEvent({
        items: [],
        text: "\\\\server\\share\\docs\\guide.md\n//server/share/docs/",
      }))
    })

    const sendButton = container.querySelector<HTMLButtonElement>('button[aria-label="发送"]')
    expect(sendButton).toBeTruthy()

    await act(async () => {
      sendButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSubmit).toHaveBeenCalledTimes(1)
    const [, attachments] = onSubmit.mock.calls[0] ?? []
    expect(attachments).toEqual([
      expect.objectContaining({
        kind: "path",
        path: "\\\\server\\share\\docs\\guide.md",
        entryType: "file",
        name: "guide.md",
      }),
      expect.objectContaining({
        kind: "path",
        path: "//server/share/docs/",
        entryType: "directory",
        name: "docs",
      }),
    ])
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
    expect(document.body.textContent).toContain("按需询问")
    expect(document.body.textContent).toContain("自动接受编辑")
    expect(document.body.textContent).toContain("只读计划")
    expect(document.body.textContent).toContain("自动判定")
    expect(document.body.textContent).toContain("不询问并拒绝")
    expect(document.body.textContent).toContain("跳过权限确认")
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
    expect(item.textContent).toContain("跳过权限确认")

    await hoverElement(item)

    expect(document.body.textContent).toContain("bypassPermissions")
    expect(document.body.textContent).toContain("Bypass all permission checks")
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
        attachmentCount: 0,
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

  it("inserts knowledge base slash candidates without submitting", async () => {
    const onDraftChange = vi.fn()
    const onSubmit = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="/wiki-q"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          slashCandidates={[{
            name: "wiki-query",
            description: "查询知识库并基于已有页面回答",
            kind: "knowledgeBase",
            insertText: "/wiki-query ",
          }]}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const textarea = container.querySelector<HTMLTextAreaElement>("textarea")
    expect(textarea).not.toBeNull()
    textarea!.setSelectionRange(7, 7)
    await act(async () => {
      textarea!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(container.textContent).toContain("知识库")
    expect(container.textContent).toContain("/wiki-query")
    expect(container.textContent).toContain("查询知识库并基于已有页面回答")

    await act(async () => {
      textarea!.dispatchEvent(new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }))
    })

    expect(onDraftChange).toHaveBeenCalledWith("/wiki-query ")
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("does not render the quick input menu when no quick inputs exist", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
        canSend={false}
        sending={false}
        cancelPhase="idle"
        quickInputs={[]}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html).not.toContain("快捷输入")
  })

  it("renders the quick input menu before knowledge base actions", () => {
    const html = renderToStaticMarkup(
      <AgentComposer
        draft=""
        disabled={false}
          canSend={false}
          sending={false}
          cancelPhase="idle"
          quickInputs={[quickInputItem("quick-1", "常用输入")]}
        knowledgeBaseActions={[{
          label: "查询知识库",
          description: "插入查询指令，继续输入要检索的问题。",
          action: "insert",
          commandText: "/wiki query ",
        }]}
        onKnowledgeBaseCommand={vi.fn()}
        onDraftChange={vi.fn()}
        onInputKeyDown={vi.fn()}
        onSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onForceKillTurn={vi.fn()}
      />,
    )

    expect(html.indexOf("快捷输入")).toBeGreaterThan(-1)
    expect(html.indexOf("知识库")).toBeGreaterThan(html.indexOf("快捷输入"))
  })

  it("direct sends a quick input without changing the current draft", async () => {
    const onDraftChange = vi.fn()
    const onDirectSend = vi.fn()
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault())
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="用户正在输入"
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          quickInputs={[quickInputItem("quick-1", "继续")]}
          onDraftChange={onDraftChange}
          onQuickInputDirectSend={onDirectSend}
          onInputKeyDown={vi.fn()}
          onSubmit={onSubmit}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openQuickInputMenu(container)
    const item = document.querySelector('[role="menuitem"][aria-label="发送快捷输入：继续"]') as HTMLElement | null
    expect(item).toBeTruthy()

    await act(async () => {
      item?.click()
      await wait(0)
    })

    expect(onDirectSend).toHaveBeenCalledWith("继续")
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it("truncates quick input menu labels without leading item icons", async () => {
    const longContent = "这是一段非常长的片段内容，用来验证菜单中只显示预览"
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
          quickInputs={[quickInputItem("quick-1", longContent)]}
          onDraftChange={vi.fn()}
          onQuickInputDirectSend={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openQuickInputMenu(container)
    const menu = document.querySelector('[data-slot="dropdown-menu-content"]') as HTMLElement | null
    const item = document.querySelector('[role="menuitem"][aria-label^="发送快捷输入："]') as HTMLElement | null
    expect(menu?.className).toContain("w-80")
    expect(item).toBeTruthy()
    expect(item?.textContent).toBe("这是一段非常长的片段内容，用来验证菜单中只显示预…")
    expect(item?.querySelector('[data-quick-input-action="send"]')).toBeNull()
  })

  it("does not render the knowledge base action button without actions", () => {
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

    expect(html).not.toContain("知识库")
  })

  it("sends direct knowledge base actions from the composer menu", async () => {
    const onSendCommand = vi.fn()
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
          knowledgeBaseActions={[{
            label: "汲取来源",
            description: "扫描 .raw/ 变更来源并导入到 wiki。",
            action: "send",
            commandText: "/wiki ingest",
          }]}
          onKnowledgeBaseCommand={onSendCommand}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "汲取来源") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onSendCommand).toHaveBeenCalledWith("/wiki ingest")
  })

  it("opens source manager from the knowledge base menu without sending a command", async () => {
    const onOpenSourceManager = vi.fn()
    const onSendCommand = vi.fn()
    const onDraftChange = vi.fn()
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
          knowledgeBaseActions={[{
            label: "汲取来源",
            description: "扫描 .raw/ 变更来源并导入到 wiki。",
            action: "send",
            commandText: "/wiki ingest",
          }]}
          onKnowledgeBaseCommand={onSendCommand}
          onOpenKnowledgeBaseSourceManager={onOpenSourceManager}
          onDraftChange={onDraftChange}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "资料管理") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onOpenSourceManager).toHaveBeenCalledTimes(1)
    expect(onSendCommand).not.toHaveBeenCalled()
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it("shows knowledge base command descriptions in hover cards", async () => {
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
          knowledgeBaseActions={[{
            label: "汲取来源",
            description: "扫描 .raw/ 变更来源并导入到 wiki。",
            action: "send",
            commandText: "/wiki ingest",
          }]}
          onKnowledgeBaseCommand={vi.fn()}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "汲取来源") as HTMLElement
    expect(item).toBeTruthy()

    await hoverElement(item)

    expect(document.body.textContent).toContain("/wiki ingest")
    expect(document.body.textContent).toContain("扫描 .raw/ 变更来源并导入到 wiki。")
  })

  it("sends hot refresh from the knowledge base action menu", async () => {
    const onSendCommand = vi.fn()
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
          knowledgeBaseActions={[{
            label: "刷新热点",
            description: "更新 wiki/hot.md 的近期事实和活跃主题。",
            action: "send",
            commandText: "/wiki hot",
          }]}
          onKnowledgeBaseCommand={onSendCommand}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "刷新热点") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onSendCommand).toHaveBeenCalledWith("/wiki hot")
  })

  it("keeps knowledge base actions available while a turn is sending", async () => {
    const onSendCommand = vi.fn()
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
          sending={true}
          cancelPhase="idle"
          knowledgeBaseActions={[{
            label: "汲取来源",
            description: "扫描 .raw/ 变更来源并导入到 wiki。",
            action: "send",
            commandText: "/wiki ingest",
          }]}
          onKnowledgeBaseCommand={onSendCommand}
          onDraftChange={vi.fn()}
          onInputKeyDown={vi.fn()}
          onSubmit={vi.fn()}
          onCancelTurn={vi.fn()}
          onForceKillTurn={vi.fn()}
        />,
      )
    })

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="知识库"]')
    expect(trigger).toBeTruthy()
    expect(trigger?.disabled).toBe(false)

    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "汲取来源") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
    })

    expect(onSendCommand).toHaveBeenCalledWith("/wiki ingest")
  })

  it("inserts query command and focuses the composer textarea", async () => {
    const onDraftChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentComposer
          draft="请 "
          disabled={false}
          canSend={true}
          sending={false}
          cancelPhase="idle"
          knowledgeBaseActions={[{
            label: "查询知识库",
            description: "插入查询指令，继续输入要检索的问题。",
            action: "insert",
            commandText: "/wiki query ",
          }]}
          onKnowledgeBaseCommand={vi.fn()}
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
    textarea!.focus()
    textarea!.setSelectionRange(2, 2)
    openKnowledgeBaseMenu(container)
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find((node) => node.textContent === "查询知识库") as HTMLElement
    expect(item).toBeTruthy()

    await act(async () => {
      item.click()
      await wait(0)
    })

    expect(onDraftChange).toHaveBeenCalledWith("请 /wiki query ")
    expect(document.activeElement?.tagName).toBe("TEXTAREA")
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

function openKnowledgeBaseMenu(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-label="知识库"]')
  expect(trigger).toBeTruthy()
  act(() => {
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function openQuickInputMenu(container: HTMLElement) {
  const trigger = container.querySelector('button[aria-label="快捷输入"]')
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

function withPath<T extends File>(file: T, path: string): T {
  Object.defineProperty(file, "path", {
    configurable: true,
    value: path,
  })
  return file
}

function quickInputItem(id: string, content: string) {
  return {
    id,
    schemaVersion: 1 as const,
    content,
    sortOrder: 10,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  }
}

function imageFile(bytes: readonly number[], name: string, type: "image/png" | "image/webp"): File {
  const file = new File([new Uint8Array(bytes)], name, { type })
  Object.defineProperty(file, "arrayBuffer", {
    configurable: true,
    value: () => Promise.resolve(new Uint8Array(bytes).buffer),
  })
  return file
}

function createPasteEvent(input: {
  readonly items: Array<{
    readonly kind: string
    readonly type: string
    readonly getAsFile: () => File | null
  }>
  readonly text?: string
}): Event {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", {
    configurable: true,
    value: {
      items: input.items,
      getData: (type: string) => type === "text/plain" ? input.text ?? "" : "",
    },
  })
  return event
}

function createDropEvent(files: readonly File[]): Event {
  const event = new Event("drop", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", {
    configurable: true,
    value: {
      files,
    },
  })
  return event
}

function installShellBridge(
  filePathForDroppedFile: (file: File) => string | null = (file) =>
    (file as File & { readonly path?: string }).path ?? null,
) {
  const filePathForDroppedFileMock = vi.fn(filePathForDroppedFile)
  ;(window as unknown as {
    synapse?: {
      shell: {
        filePathForDroppedFile: typeof filePathForDroppedFileMock
      }
    }
  }).synapse = {
    shell: {
      filePathForDroppedFile: filePathForDroppedFileMock,
    },
  }
  return filePathForDroppedFileMock
}
