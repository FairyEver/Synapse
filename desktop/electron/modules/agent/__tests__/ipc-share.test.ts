import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IpcHandlerContext } from "../../../runtime/ipc/types"
const native = vi.hoisted(() => ({ window: { isDestroyed: vi.fn() }, fromId: vi.fn(), fromWebContents: vi.fn(), showSaveDialog: vi.fn(), write: vi.fn(), record: vi.fn(), check: vi.fn() }))
vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: native.fromWebContents }, webContents: { fromId: native.fromId }, dialog: { showSaveDialog: native.showSaveDialog }, clipboard: { write: native.write }, ClipboardItem: class { constructor(readonly data: Record<string, Blob>) {} } }))
vi.mock("../../../services/log-store", () => ({ createMainLogger: () => ({ warn: vi.fn() }) }))
import { shareMethods, shareImageRequestSchema, shareImageResourceRequestSchema } from "../ipc-share"
import { AgentShareImageService } from "../../../services/agent-share-image-service"
const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII="
const input = { action: "copy" as const, pngBase64, fileName: "test.png" }
function context(sender = true) {
  return { moduleId: "agent", ...(sender ? { sender: { id: 42 } } : {}), resolve: (id: string) => id === "core.permission-guard" ? { check: native.check } : { record: native.record } } as unknown as IpcHandlerContext
}
beforeEach(() => {
  vi.resetAllMocks(); native.fromId.mockReturnValue({ id: 42 }); native.fromWebContents.mockReturnValue(native.window); native.window.isDestroyed.mockReturnValue(false)
  native.check.mockResolvedValue({ allowed: true }); native.write.mockResolvedValue(undefined)
})
describe("private conversation PNG IPC", () => {
  it("keeps resource reads window-bound and remote-only without exposing arbitrary file reads", async () => {
    for (const url of ["file:///etc/passwd", "synapse-agent-artifact://local/p/s/a.png", "https://user:secret@images.example/photo", "data:image/png;base64,AA=="]) expect(shareImageResourceRequestSchema.safeParse({ url }).success).toBe(false)
    expect(shareImageResourceRequestSchema.safeParse({ url: "https://images.example/photo", path: "/private/file" }).success).toBe(false)
    const read = vi.spyOn(AgentShareImageService.prototype, "readRemoteImage").mockResolvedValue({ dataUrl: "data:image/png;base64,AA==" })
    try {
      await expect(shareMethods.readShareImageResource!.handler(context(false), { url: "https://images.example/photo" })).rejects.toThrow("窗口")
      expect(read).not.toHaveBeenCalled()
      await expect(shareMethods.readShareImageResource!.handler(context(), { url: "https://images.example/photo" })).resolves.toEqual({ dataUrl: "data:image/png;base64,AA==" })
    } finally { read.mockRestore() }
  })
  it("requires bounded PNG actions and rejects unrecognized privileged inputs", () => {
    expect(shareImageRequestSchema.safeParse(input).success).toBe(true)
    for (const invalid of [{ ...input, path: "/tmp/bypass.png" }, { ...input, action: "upload" }, { ...input, fileName: "x".repeat(121) }]) expect(shareImageRequestSchema.safeParse(invalid).success).toBe(false)
  })
  it("binds output to a live sender window and writes real PNG bytes through ClipboardItem", async () => {
    await expect(shareMethods.exportShareImage!.handler(context(false), input)).rejects.toThrow("窗口")
    await expect(shareMethods.exportShareImage!.handler(context(), input)).resolves.toEqual({ success: true })
    expect(native.fromId).toHaveBeenCalledWith(42)
    const blob = native.write.mock.calls[0]![0][0].data["image/png"] as Blob
    expect(blob.type).toBe("image/png"); expect(Buffer.from(await blob.arrayBuffer())).toEqual(Buffer.from(pngBase64, "base64"))
    expect(native.check).toHaveBeenCalledWith(expect.objectContaining({ action: "clipboard.write" }))
  })
  it("uses the sender-owned save dialog and returns cancellation without writing", async () => {
    native.showSaveDialog.mockResolvedValue({ canceled: true })
    await expect(shareMethods.exportShareImage!.handler(context(), { ...input, action: "save" })).resolves.toEqual({ success: false })
    expect(native.showSaveDialog).toHaveBeenCalledWith(native.window, expect.objectContaining({ defaultPath: "test.png", filters: [{ name: "PNG 图片", extensions: ["png"] }] }))
    expect(native.check).not.toHaveBeenCalled(); expect(native.write).not.toHaveBeenCalled()
  })
})
