/** @vitest-environment jsdom */
import { act, useRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAgentShare, type AgentShareController } from "../use-agent-share"
import { AgentShareSelectionContext, ShareMessageFrame } from "../selection-context"
import { AgentShareSelectionBar } from "../selection-bar"
import { AgentSharePreviewDialog } from "../preview-dialog"
import { AgentMessageToolbar } from "../../components/agent-message-toolbar"
const mocks = vi.hoisted(() => ({ getTimeline: vi.fn(), run: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => mocks }))
vi.mock("@/app-shell/logging", () => ({ createRendererLogger: () => ({ warn: vi.fn(), error: vi.fn() }) }))
vi.mock("../use-share-image-export", () => ({ useShareImageExport: () => ({ busy: null, error: null, run: mocks.run }) }))
vi.mock("../../components/agent-message-event", () => ({ AgentShareMessageBody: ({ item }: { item: { content: string } }) => <p>{item.content}</p> }))
vi.mock("../../openui/generated-ui-theme", () => ({ GeneratedUiTheme: ({ children }: { children: import("react").ReactNode }) => children }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const target = { projectId: "p", conversationId: "c", sessionKey: "s" }
const items = [1, 2, 3, 4].map((id) => ({ id: `m${id}`, historyIndex: id - 1, kind: "message" as const, role: id % 2 ? "user" as const : "assistant" as const, content: `message ${id} test@example.com`, timestamp: "2026-10-24T00:00:00Z", metadata: id === 2 ? { model: "Old Model" } : id === 4 ? { model: "New Model" } : undefined }))
let root: Root, host: HTMLElement, share: AgentShareController
function Driver() {
  const viewport = useRef<HTMLDivElement>(null)
  share = useAgentShare({ target, title: "selected conversation", items, sending: false, viewport })
  return <AgentShareSelectionContext.Provider value={{ active: share.active, indexes: new Map(share.messages.map((item, index) => [item.id, index])), selected: share.selected, onShare: (id) => { void share.enter(id) }, onChoose: share.choose }}>
    <div ref={viewport}>{items.map((item) => <ShareMessageFrame key={item.id} item={item}><p data-source-message={item.id}>{item.content}</p><AgentMessageToolbar messageId={item.id} role={item.role} content={item.content} /></ShareMessageFrame>)}</div>
    {share.active && <AgentShareSelectionBar share={share} />}
    <AgentSharePreviewDialog share={share} target={target} />
  </AgentShareSelectionContext.Provider>
}
function button(label: string) { const node = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent === label || item.getAttribute("aria-label") === label); if (!node) throw new Error(`Missing button ${label}`); return node }
beforeEach(async () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} })
  mocks.getTimeline.mockResolvedValue({ ...target, entries: items, total: 4, startIndex: 0, hasMore: false })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => root.render(<Driver />))
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe("message selection and preview UI", () => {
  it("enters from a message toolbar, preserves message DOM, and supports round and Shift selection", async () => {
    const original = host.querySelector('[data-source-message="m1"]')
    await act(async () => button("分享这条消息").click())
    expect([...share.selected]).toEqual(["m1"])
    expect(host.querySelector('[data-source-message="m1"]')).toBe(original)
    await act(async () => button("选择本轮").click())
    expect([...share.selected]).toEqual(["m1", "m2"])
    act(() => share.preset("clear"))
    const choices = host.querySelectorAll<HTMLButtonElement>('[role="checkbox"]')
    act(() => choices[0]!.click())
    act(() => choices[3]!.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true })))
    expect(share.selected.size).toBe(4)
    act(() => button("取消本轮").click())
    expect([...share.selected]).toEqual(["m1", "m2"])
    act(() => button("取消").click()); expect(share.active).toBe(false)
    expect(host.querySelector('[data-source-message="m1"]')).toBe(original)
  })
  it("previews only selected messages with omissions and privacy controls, then returns without losing selection", async () => {
    await act(async () => share.enter())
    expect(button("预览图片").disabled).toBe(true)
    act(() => share.choose("m1", false)); act(() => share.choose("m4", false))
    await act(async () => button("预览图片").click())
    const paper = document.querySelector<HTMLElement>("[data-agent-share-paper]")!
    expect([...paper.querySelectorAll("[data-share-export-message]")].map((node) => node.getAttribute("data-share-export-message"))).toEqual(["m1", "m4"])
    expect(paper.textContent).toContain("已省略内容"); expect(paper.textContent).not.toContain("test@example.com")
    act(() => button("超清 3×").click()); act(() => button("宽版").click())
    act(() => button("复制图片").click())
    expect(mocks.run).toHaveBeenCalledWith(paper, expect.objectContaining({ scale: 3, width: 960 }), "copy")
    act(() => button("保存图片").click())
    expect(mocks.run).toHaveBeenLastCalledWith(paper, expect.anything(), "save")
    act(() => button("返回选择").click())
    expect(share.preview).toBeNull(); expect([...share.selected]).toEqual(["m1", "m4"])
  })
  it("shows the editable title and message bodies without identity or metadata rows", async () => {
    await act(async () => share.enter()); act(() => share.preset("all")); await act(async () => share.openPreview())
    const paper = document.querySelector<HTMLElement>("[data-agent-share-paper]")!
    expect(paper.querySelector("header")!.textContent).toBe("selected conversation")
    for (const message of items) {
      expect(paper.querySelector(`[data-share-export-message="${message.id}"]`)!.textContent).toBe(message.content.replace("test@example.com", "［邮箱已隐藏］"))
    }
    expect(document.querySelector("#agent-share-model")).toBeNull()
    expect(document.querySelector("#agent-share-time")).toBeNull()
    act(() => document.querySelector<HTMLButtonElement>("#agent-share-title")!.click())
    expect(paper.querySelector("header")).toBeNull()
  })
  it("keeps only selection actions in the source messages and a compact toolbar", async () => {
    await act(async () => share.enter("m1"))
    expect(host.querySelector('[aria-label="复制"]')).toBeNull()
    expect(host.querySelector('[role="toolbar"][aria-label="分享消息操作"]')).not.toBeNull()
    expect(host.querySelector('[data-share-message="m1"] button:not([role="checkbox"])')).toBeNull()
  })
  it("keeps batch selection and clearing available in the range menu", async () => {
    await act(async () => share.enter())
    await act(async () => button("选择范围").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "仅 AI")!.click())
    expect([...share.selected]).toEqual(["m2", "m4"])
    await act(async () => button("选择范围").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })))
    await act(async () => [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((node) => node.textContent === "清空")!.click())
    expect(share.selected.size).toBe(0)
    expect(button("预览图片").disabled).toBe(true)
  })
})
