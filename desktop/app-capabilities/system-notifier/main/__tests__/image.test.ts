import { mkdtemp, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { NOTIFICATION_IMAGE_MAX_BYTES, readNotificationImageFile } from "../image"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe("readNotificationImageFile", () => {
  it("reads an absolute PNG after the permission check and audits without the path", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const file = path.join(dir, "a.png")
    await writeFile(file, png)
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = { record: vi.fn() }
    const result = await readNotificationImageFile({
      filePath: file, actor: { kind: "agent", id: "a1" }, permissionGuard: permissionGuard as never,
      auditSink: auditSink as never, metadata: { source: "mcp-http" },
    })
    expect(result).toMatchObject({ ok: true, mimeType: "image/png" })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "fs.read.outside-userdata", resource: file }))
    expect(auditSink.record).toHaveBeenCalledTimes(1)
    const [event] = auditSink.record.mock.calls[0] as [{
      outcome: string
      resource: string
      metadata: Record<string, unknown>
    }]
    expect(event).toMatchObject({
      outcome: "allowed",
      resource: "a.png",
      metadata: expect.objectContaining({
        source: "mcp-http",
        mimeType: "image/png",
        byteSize: png.byteLength,
      }),
    })
    expect(JSON.stringify(event)).not.toContain(file)
    expect(event.metadata).not.toHaveProperty("path")
  })

  it("rejects relative, missing, unsupported and denied inputs", async () => {
    expect(await readNotificationImageFile({ filePath: "a.png", actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "not_absolute" })
    const auditSink = { record: vi.fn() }
    expect(await readNotificationImageFile({ filePath: "/definitely/missing.png", actor: { kind: "system" }, auditSink: auditSink as never, metadata: {} }))
      .toEqual({ ok: false, reason: "not_found" })
    expect(auditSink.record).toHaveBeenCalledTimes(1)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      resource: "missing.png",
      metadata: expect.objectContaining({ reason: "not_found" }),
    }))
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const text = path.join(dir, "a.png")
    await writeFile(text, "hello")
    expect(await readNotificationImageFile({ filePath: text, actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "unsupported_type" })
    const deniedSink = { record: vi.fn() }
    expect(await readNotificationImageFile({
      filePath: text, actor: { kind: "system" },
      permissionGuard: { check: async () => ({ allowed: false, reason: "policy" }) } as never,
      auditSink: deniedSink as never,
      metadata: {},
    })).toEqual({ ok: false, reason: "permission_denied" })
    expect(deniedSink.record).toHaveBeenCalledTimes(1)
    expect(deniedSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "denied",
      resource: "a.png",
      metadata: expect.objectContaining({ reason: "permission_denied" }),
    }))
  })

  it("rejects directories and symlinks instead of following them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    expect(await readNotificationImageFile({ filePath: dir, actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "not_regular_file" })
    const target = path.join(dir, "real.png")
    await writeFile(target, png)
    const link = path.join(dir, "link.png")
    await symlink(target, link)
    expect(await readNotificationImageFile({ filePath: link, actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "not_regular_file" })
  })

  it("rejects files above the local byte limit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const file = path.join(dir, "big.png")
    const bytes = Buffer.alloc(NOTIFICATION_IMAGE_MAX_BYTES + 1)
    png.copy(bytes)
    await writeFile(file, bytes)
    expect(await readNotificationImageFile({ filePath: file, actor: { kind: "system" }, metadata: {} }))
      .toEqual({ ok: false, reason: "too_large" })
  })

  it("detects JPEG, GIF and WebP headers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const cases: Array<[string, Buffer, string]> = [
      ["a.jpg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]), "image/jpeg"],
      ["a.gif", Buffer.from("GIF89a......", "ascii"), "image/gif"],
      ["a.webp", Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ", "ascii")]), "image/webp"],
    ]
    for (const [name, bytes, mimeType] of cases) {
      const file = path.join(dir, name)
      await writeFile(file, bytes)
      expect(await readNotificationImageFile({ filePath: file, actor: { kind: "system" }, metadata: {} }))
        .toMatchObject({ ok: true, mimeType })
    }
  })
})
