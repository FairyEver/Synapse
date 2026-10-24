import { mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { AgentShareImageService } from "../agent-share-image-service"

const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nV8AAAAASUVORK5CYII="
const dirs: string[] = []
async function directory() { const dir = await realpath(await mkdtemp(path.join(os.tmpdir(), "synapse-share-test-"))); dirs.push(dir); return dir }
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))) })
function setup(chooseSavePath = vi.fn<() => Promise<string | null>>().mockResolvedValue(null)) {
  const check = vi.fn().mockResolvedValue({ allowed: true })
  const record = vi.fn()
  const copyPng = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  return { check, record, copyPng, chooseSavePath, service: new AgentShareImageService({ permissionGuard: { check }, auditSink: { record }, chooseSavePath, copyPng }) }
}
const request = { action: "save" as const, pngBase64, fileName: "分享.png" }

describe("Agent share PNG output", () => {
  it("saves to an explicit path without a dialog and never overwrites it", async () => {
    const dir = await directory(), outputPath = path.join(dir, "direct.png"), deps = setup()
    await expect(deps.service.exportImage(request, { outputPath, actor: { kind: "agent", id: "share" } })).resolves.toEqual({ success: true, filePath: outputPath })
    expect(deps.chooseSavePath).not.toHaveBeenCalled()
    expect(deps.check).toHaveBeenCalledWith(expect.objectContaining({ actor: { kind: "agent", id: "share" } }))
    await expect(deps.service.exportImage(request, { outputPath })).rejects.toThrow("已存在")
    expect(await readFile(outputPath)).toEqual(Buffer.from(pngBase64, "base64"))
  })
  it("cancels without permissions, clipboard changes, or writing files", async () => {
    const deps = setup()
    await expect(deps.service.exportImage(request)).resolves.toEqual({ success: false })
    expect(deps.check).not.toHaveBeenCalled(); expect(deps.record).not.toHaveBeenCalled(); expect(deps.copyPng).not.toHaveBeenCalled()
  })
  it("writes actual PNG bytes atomically and only reports success after completion", async () => {
    const dir = await directory(); const output = path.join(dir, "image.png")
    await writeFile(output, "previous")
    const deps = setup(vi.fn().mockResolvedValue(output))
    await expect(deps.service.exportImage(request)).resolves.toEqual({ success: true, filePath: output })
    expect(await readFile(output)).toEqual(Buffer.from(pngBase64, "base64"))
    expect(await readdir(dir)).toEqual(["image.png"])
    expect(deps.check).toHaveBeenCalledWith(expect.objectContaining({ action: "fs.write.outside-userdata", resource: output }))
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "allowed", metadata: expect.objectContaining({ width: 1, height: 1 }) }))
  })
  it("does not overwrite symlinks or leave temporary output on failure", async () => {
    const dir = await directory(); const original = path.join(dir, "original"); const output = path.join(dir, "image.png")
    await writeFile(original, "keep"); await symlink(original, output)
    const deps = setup(vi.fn().mockResolvedValue(output))
    await expect(deps.service.exportImage(request)).rejects.toThrow()
    expect(await readFile(original, "utf8")).toBe("keep")
    expect((await readdir(dir)).sort()).toEqual(["image.png", "original"])
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }))
  })
  it("denies writes and records the permission rejection", async () => {
    const dir = await directory(); const output = path.join(dir, "image.png")
    const deps = setup(vi.fn().mockResolvedValue(output)); deps.check.mockResolvedValue({ allowed: false, reason: "synthetic denied" })
    await expect(deps.service.exportImage(request)).rejects.toThrow("权限")
    expect(await readdir(dir)).toEqual([])
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "denied" }))
  })
  it("awaits the native image clipboard and audits only after it completes", async () => {
    const deps = setup(); let finish!: () => void
    deps.copyPng.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const output = deps.service.exportImage({ ...request, action: "copy" })
    await vi.waitFor(() => expect(deps.copyPng).toHaveBeenCalled())
    expect(deps.record).not.toHaveBeenCalled()
    finish(); await expect(output).resolves.toEqual({ success: true })
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ action: "clipboard.write", outcome: "allowed" }))
  })
  it("audits native failures and rejects malformed or excessive images before output", async () => {
    const deps = setup(); deps.copyPng.mockRejectedValue(new Error("native failure"))
    await expect(deps.service.exportImage({ ...request, action: "copy" })).rejects.toThrow()
    expect(deps.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed" }))
    await expect(deps.service.exportImage({ ...request, pngBase64: "not a png" })).rejects.toThrow("PNG")
    const excessive = Buffer.from(pngBase64, "base64"); excessive.writeUInt32BE(64_001, 20)
    await expect(deps.service.exportImage({ ...request, pngBase64: excessive.toString("base64") })).rejects.toThrow("过长")
  })
  it("does not write when cancellation arrives while the save dialog or permission check is pending", async () => {
    const dir = await directory(), controller = new AbortController()
    const deps = setup(vi.fn(async () => { controller.abort(); return path.join(dir, "cancelled.png") }))
    await expect(deps.service.exportImage(request, { signal: controller.signal })).rejects.toThrow()
    expect(await readdir(dir)).toEqual([])
    const copyAbort = new AbortController(), copy = setup()
    copy.check.mockImplementation(async () => { copyAbort.abort(); return { allowed: true } })
    await expect(copy.service.exportImage({ ...request, action: "copy" }, { signal: copyAbort.signal })).rejects.toThrow()
    expect(copy.copyPng).not.toHaveBeenCalled()
  })

})
