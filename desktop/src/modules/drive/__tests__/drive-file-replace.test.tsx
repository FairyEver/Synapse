/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveItemDto } from "@synapse/shared"
import { DriveFileReplaceDialog } from "../drive-file-replace-dialog"

const mocks = vi.hoisted(() => ({ choose: vi.fn(), preview: vi.fn(), apply: vi.fn(), changed: vi.fn(), manage: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireSynapseBridge: () => ({
  driveSync: { chooseLocalPath: mocks.choose },
  drive: { file: { replace: { preview: mocks.preview, apply: mocks.apply } } },
}) }))
vi.mock("@/lib/ui-tracking", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/ui-tracking")>(), startTrackedOperation: () => vi.fn(), track: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root
let host: HTMLDivElement
let unmounted = false
const item = { id: "file-1", name: "report.md", type: "file" } as DriveItemDto
const preview = { itemId: item.id, name: item.name, localName: "new.md", size: "30", previousSize: "20", versionId: "v1", confirmationToken: "token-1", syncImpacts: [{ bindingId: "b1", localPath: "/docs/report.md", status: "paused" }], blockedReason: null }
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((button) => button.textContent === text)
  expect(button, text).toBeTruthy()
  await act(async () => { button!.click(); await Promise.resolve() })
}
beforeEach(() => {
  vi.clearAllMocks(); unmounted = false
  mocks.choose.mockResolvedValue("/tmp/new.md")
  mocks.preview.mockResolvedValue(preview)
  mocks.apply.mockResolvedValue({ item, versionId: "v2", syncPending: true })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { if (!unmounted) await act(async () => root.unmount()); host.remove() })
async function renderDialog() {
  await act(async () => { root.render(<DriveFileReplaceDialog item={item} onClose={vi.fn()} onChanged={mocks.changed} onManageSync={mocks.manage} />); await Promise.resolve() })
}
describe("上传新版本", () => {
  it("previews the selected file, preserves the remote identity, and reports pending sync honestly", async () => {
    await renderDialog(); await click("选择文件")
    expect(mocks.preview).toHaveBeenCalledWith({ itemId: "file-1", filePath: "/tmp/new.md" })
    expect(mocks.apply).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("/docs/report.md")
    expect(document.body.textContent).toContain("保持暂停")
    await click("上传新版本")
    expect(mocks.apply).toHaveBeenCalledWith({ itemId: "file-1", filePath: "/tmp/new.md", confirmationToken: "token-1" })
    expect(document.body.textContent).toContain("云端已更新")
    expect(document.body.textContent).toContain("本机同步尚未完成")
    expect(mocks.changed).toHaveBeenCalled()
  })
  it("blocks local conflicts and opens their actual sync relationship", async () => {
    mocks.preview.mockResolvedValue({ ...preview, blockedReason: "本地存在未同步修改" })
    await renderDialog(); await click("选择文件")
    expect(document.body.textContent).toContain("本地存在未同步修改")
    expect([...document.querySelectorAll("button")].find((button) => button.textContent === "上传新版本")?.disabled).toBe(true)
    await click("管理同步")
    expect(mocks.manage).toHaveBeenCalledWith("b1")
    expect(mocks.apply).not.toHaveBeenCalled()
  })
  it("invalidates a failed confirmation and requires a fresh preview before retry", async () => {
    mocks.apply.mockRejectedValue(new Error("云端版本已变化"))
    await renderDialog(); await click("选择文件"); await click("上传新版本")
    expect(document.body.textContent).toContain("云端版本已变化")
    expect([...document.querySelectorAll("button")].find((button) => button.textContent === "上传新版本")?.disabled).toBe(true)
    await click("重新检查")
    expect(mocks.preview).toHaveBeenCalledTimes(2)
  })
  it("does not refresh a disposed dialog after an upload response arrives", async () => {
    let finish!: (value: { item: DriveItemDto; versionId: string; syncPending: boolean }) => void
    mocks.apply.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    await renderDialog(); await click("选择文件"); await click("上传新版本")
    await act(async () => root.unmount()); unmounted = true
    await act(async () => { finish({ item, versionId: "v2", syncPending: false }); await Promise.resolve() })
    expect(mocks.changed).not.toHaveBeenCalled()
  })
  it("prevents duplicate submissions while an upload is pending", async () => {
    mocks.apply.mockReturnValueOnce(new Promise(() => undefined))
    await renderDialog(); await click("选择文件"); await click("上传新版本"); await click("处理中…")
    expect(mocks.apply).toHaveBeenCalledTimes(1)
  })

})
