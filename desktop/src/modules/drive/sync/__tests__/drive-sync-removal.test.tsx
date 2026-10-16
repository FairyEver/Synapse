/** @vitest-environment jsdom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { DriveSyncBindingDto } from "@synapse/shared"
import type { DriveSyncController } from "../use-drive-sync"
import { DriveSyncRemovalDialog } from "../drive-sync-removal-dialog"

vi.mock("@/lib/ui-tracking", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/ui-tracking")>(), startTrackedOperation: () => vi.fn(), track: vi.fn() }))
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
let root: Root; let host: HTMLDivElement
const previewRemoval = vi.fn(); const remove = vi.fn(); const refresh = vi.fn(); const removed = vi.fn()
const binding = { id: "b1", kind: "folder", driveItemName: "Docs", localPath: "/local/Docs", drivePathHint: "/Docs" } as DriveSyncBindingDto
const preview = { bindingId: "b1", disposition: "keep_both", localPath: "/local/Docs", drivePathHint: "/Docs", localPaths: [], remotePaths: [], warnings: [], blockedReason: null, confirmationToken: "review-1" }
const controller = { previewRemoval, remove, refresh, readOnly: false } as unknown as DriveSyncController
beforeEach(async () => {
  vi.clearAllMocks()
  previewRemoval.mockImplementation(async (_id, disposition) => ({ ...preview, disposition, remotePaths: disposition === "keep_local" ? ["/Docs/report.md"] : [] }))
  remove.mockResolvedValue({ bindingId: "b1", local: "retained", remote: "retained", errors: [] })
  refresh.mockResolvedValue({ bindings: [] })
  host = document.createElement("div"); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<DriveSyncRemovalDialog controller={controller} binding={binding} onClose={vi.fn()} onRemoved={removed} />); await Promise.resolve() })
})
afterEach(async () => { await act(async () => root.unmount()); host.remove() })
async function click(text: string) {
  const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === text)
  expect(button).toBeTruthy(); await act(async () => { button!.click(); await Promise.resolve() })
}
async function choose(value: string) { await act(async () => { (document.querySelector(`#remove-${value}`) as HTMLElement).click(); await Promise.resolve() }) }
describe("解除同步", () => {
  it("defaults to retaining both sides and submits the reviewed snapshot only on confirmation", async () => {
    expect(previewRemoval).toHaveBeenCalledWith("b1", "keep_both")
    expect(remove).not.toHaveBeenCalled()
    await click("解除同步")
    expect(remove).toHaveBeenCalledWith("b1", "keep_both", "review-1")
    expect(removed).toHaveBeenCalledTimes(1)
  })
  it("requires an explicit trash confirmation after previewing a destructive disposition", async () => {
    await choose("keep_local")
    expect(previewRemoval).toHaveBeenLastCalledWith("b1", "keep_local")
    expect([...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "解除同步")?.disabled).toBe(true)
    await act(async () => { (document.querySelector("#remove-confirm") as HTMLElement).click(); await Promise.resolve() })
    await click("解除同步")
    expect(remove).toHaveBeenCalledWith("b1", "keep_local", "review-1")
  })
  it("keeps partial failures visible and re-previews the same journal before retrying", async () => {
    remove.mockResolvedValueOnce({ bindingId: "b1", local: "retained", remote: "failed", errors: ["云端删除失败"] })
    await choose("keep_local")
    await act(async () => { (document.querySelector("#remove-confirm") as HTMLElement).click(); await Promise.resolve() })
    await click("解除同步")
    expect(removed).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("云端删除失败")
    expect(document.body.textContent).toContain("同步关系已解除")
    expect([...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "重试未完成项")?.disabled).toBe(true)
    previewRemoval.mockResolvedValueOnce({ ...preview, disposition: "keep_local", confirmationToken: "review-2" })
    await click("重新检查")
    await act(async () => { (document.querySelector("#remove-confirm") as HTMLElement).click(); await Promise.resolve() })
    await click("重试未完成项")
    expect(remove).toHaveBeenLastCalledWith("b1", "keep_local", "review-2")
    expect(removed).toHaveBeenCalledTimes(1)
  })
  it("reopens a detached cleanup with its original disposition and cannot remap it", async () => {
    await act(async () => root.unmount()); root = createRoot(host)
    await act(async () => { root.render(<DriveSyncRemovalDialog controller={controller} binding={{ ...binding, status: "removed", removalDisposition: "keep_remote" }} onClose={vi.fn()} onRemoved={removed} />); await Promise.resolve() })
    expect(previewRemoval).toHaveBeenLastCalledWith("b1", "keep_remote")
    expect((document.querySelector("#remove-keep_remote") as HTMLButtonElement).getAttribute("aria-checked")).toBe("true")
    expect((document.querySelector("#remove-keep_local") as HTMLButtonElement).disabled).toBe(true)
  })

  it("can stop retrying cleanup and retain remaining files without repeating deletion", async () => {
    remove.mockResolvedValueOnce({ bindingId: "b1", local: "retained", remote: "failed", errors: ["云端删除失败"] })
    await click("解除同步")
    await click("保留剩余文件")
    expect(remove).toHaveBeenLastCalledWith("b1", "keep_both")
    expect(removed).toHaveBeenCalledTimes(1)
  })

  it("does not run a late completion callback after the dialog is disposed", async () => {
    let finish!: (value: { bindingId: string; local: "retained"; remote: "retained"; errors: string[] }) => void
    remove.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    await click("解除同步")
    await act(async () => root.unmount()); root = createRoot(host)
    await act(async () => { finish({ bindingId: "b1", local: "retained", remote: "retained", errors: [] }); await Promise.resolve() })
    expect(removed).not.toHaveBeenCalled()
  })

})
