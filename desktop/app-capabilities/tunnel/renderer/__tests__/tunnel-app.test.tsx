/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { TunnelModule } from "../index"
const mocks = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn(), setEnabled: vi.fn(), delete: vi.fn(), write: vi.fn() }))
vi.mock("@/app-shell/account", () => ({ useAccount: () => ({ state: { status: "authenticated", profile: { user: { id: "u1" } } }, isLoading: false }) }))
vi.mock("@/modules/apps/components/system-app-window-shell", () => ({ SystemAppWindowShell: ({ children, left, actions }: { children: React.ReactNode; left: React.ReactNode; actions: React.ReactNode }) => <main>{left}{actions}{children}</main> }))
vi.mock("@/modules/apps/components/system-app-top-bar", () => ({ SystemAppTopBarActionButton: (props: Record<string, unknown>) => <button onClick={props.onClick as never} aria-label={props["aria-label"] as string}>{props.children as React.ReactNode}</button> }))
let root: Root, container: HTMLDivElement
const row = { id: "m1", clientInstanceId: "d1", deviceName: "Mac", port: 3000, url: `https://${"a".repeat(32)}.tunnel.d2.pub`, enabled: true, revision: 1, runtimeStatus: "local-unavailable", lastErrorCode: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
  Object.values(mocks).forEach(fn => fn.mockReset())
  mocks.list.mockResolvedValue({ items: [], total: 0, nextOffset: null, currentClientInstanceId: "d1" }); mocks.create.mockResolvedValue(row); mocks.setEnabled.mockResolvedValue({ ...row, enabled: false, revision: 2, runtimeStatus: "stopped" }); mocks.update.mockResolvedValue({ ...row, port: 3001, revision: 2 }); mocks.delete.mockResolvedValue({ id: row.id, deleted: true })
  vi.stubGlobal("synapse", { tunnel: { mapping: { ...mocks, onChanged: () => () => {}, onReset: () => () => {} } } })
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: mocks.write } })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() })
const click = async (text: string) => { const button = [...document.querySelectorAll("button")].find(b => b.textContent === text)!; expect(button).toBeTruthy(); await act(async () => button.click()) }
async function port(value: string) { const input = document.querySelector<HTMLInputElement>('input[aria-label="本机端口"]')!; await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })) }) }
async function openMenu() {
  const trigger = document.querySelector<HTMLButtonElement>('button[aria-label$="的更多操作"]')!
  await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
}
describe("tunnel app", () => {
  it("opens menus for copy, port editing and confirmed deletion", async () => {
    mocks.list.mockResolvedValue({ items: [row], total: 1, nextOffset: null, currentClientInstanceId: "d1" })
    await act(async () => root.render(<TunnelModule />))
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label^="复制端口"]')!.click())
    expect(mocks.write).toHaveBeenCalledWith(row.url)
    await openMenu()
    const edit = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "修改端口")!
    expect(edit).toBeTruthy(); await act(async () => edit.click())
    await port("3001"); await click("保存")
    expect(mocks.update).toHaveBeenCalledWith(row.id, { port: 3001, expectedRevision: 1 })
    await openMenu()
    const remove = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === "删除链接")!
    await act(async () => remove.click()); await click("删除链接")
    expect(mocks.delete).toHaveBeenCalledWith(row.id, { expectedRevision: 2 })
    expect(document.body.textContent).toContain("暂无链接")
  })

  it("requires only a port, preserves failed input, then shows an unreachable allocated URL", async () => {
    await act(async () => root.render(<TunnelModule />)); await click("申请链接"); await port("3000")
    expect(document.querySelectorAll("input[required]")).toHaveLength(1)
    mocks.create.mockRejectedValueOnce(new Error("暂时失败")); await click("申请")
    expect(document.querySelector<HTMLInputElement>('input[aria-label="本机端口"]')!.value).toBe("3000")
    await click("申请")
    expect(mocks.create).toHaveBeenLastCalledWith(expect.objectContaining({ port: 3000 }))
    expect(document.body.textContent).toContain(row.url); expect(document.body.textContent).toContain("本机服务不可达")
  })
  it("defaults to this computer and exposes other devices read-only", async () => {
    mocks.list.mockResolvedValue({ items: [row, { ...row, id: "m2", clientInstanceId: "other", deviceName: "Other" }], total: 2, nextOffset: null, currentClientInstanceId: "d1" })
    await act(async () => root.render(<TunnelModule />))
    expect(document.body.textContent).not.toContain("Other")
    const select = document.querySelector("select")!; await act(async () => { select.value = "all"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(document.body.textContent).toContain("Other")
    const switches = [...document.querySelectorAll<HTMLButtonElement>('[role="switch"]')]
    expect(switches).toHaveLength(2); expect(switches[1]!.disabled).toBe(true)
    await act(async () => switches[0]!.click())
    expect(mocks.setEnabled).toHaveBeenCalledWith("m1", { enabled: false, expectedRevision: 1 })
  })
})
