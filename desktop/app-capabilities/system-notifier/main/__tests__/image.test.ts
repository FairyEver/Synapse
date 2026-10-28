import { mkdtemp, symlink, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import { DataRepositoryAuditSink } from "../../../../electron/runtime/security"
import { NOTIFICATION_IMAGE_AUDIT_RESOURCE, NOTIFICATION_IMAGE_MAX_BYTES, readNotificationImageFile } from "../image"

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function allowedGuard() {
  return { check: vi.fn(async () => ({ allowed: true })) }
}

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
      resource: NOTIFICATION_IMAGE_AUDIT_RESOURCE,
      metadata: expect.objectContaining({
        source: "mcp-http",
        mimeType: "image/png",
        byteSize: png.byteLength,
      }),
    })
    // 路径和文件名都不进审计：审计只说明「读了一张通知图片」。
    expect(JSON.stringify(event)).not.toContain(file)
    expect(JSON.stringify(event)).not.toContain("a.png")
    expect(event.metadata).not.toHaveProperty("path")
  })

  it("rejects relative, missing, unsupported and denied inputs", async () => {
    const relativeSink = { record: vi.fn() }
    expect(await readNotificationImageFile({
      filePath: "a.png", actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: relativeSink as never, metadata: {},
    })).toEqual({ ok: false, reason: "not_absolute" })
    expect(relativeSink.record).toHaveBeenCalledTimes(1)
    expect(relativeSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      resource: NOTIFICATION_IMAGE_AUDIT_RESOURCE,
      metadata: expect.objectContaining({ failureReason: "not_absolute" }),
    }))
    expect(JSON.stringify(relativeSink.record.mock.calls)).not.toContain("a.png")
    const auditSink = { record: vi.fn() }
    expect(await readNotificationImageFile({
      filePath: "/definitely/missing.png", actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: auditSink as never, metadata: {},
    })).toEqual({ ok: false, reason: "not_found" })
    expect(auditSink.record).toHaveBeenCalledTimes(1)
    expect(auditSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      resource: NOTIFICATION_IMAGE_AUDIT_RESOURCE,
      metadata: expect.objectContaining({ failureReason: "not_found" }),
    }))
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const text = path.join(dir, "a.png")
    await writeFile(text, "hello")
    const unsupportedSink = { record: vi.fn() }
    expect(await readNotificationImageFile({
      filePath: text, actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: unsupportedSink as never, metadata: {},
    })).toEqual({ ok: false, reason: "unsupported_type" })
    expect(unsupportedSink.record).toHaveBeenCalledTimes(1)
    expect(unsupportedSink.record).toHaveBeenCalledWith(expect.objectContaining({
      outcome: "failed",
      resource: NOTIFICATION_IMAGE_AUDIT_RESOURCE,
      metadata: expect.objectContaining({ failureReason: "unsupported_type" }),
    }))
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
      resource: NOTIFICATION_IMAGE_AUDIT_RESOURCE,
      metadata: expect.objectContaining({ failureReason: "permission_denied" }),
    }))
  })

  it("keeps failure and image metadata through the production audit redaction", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const sink = new DataRepositoryAuditSink({ audit: { upsert: async () => {} } as never })
    const text = path.join(dir, "note.png")
    await writeFile(text, "hello")
    expect(await readNotificationImageFile({
      filePath: text, actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: sink, metadata: { source: "mcp-http" },
    })).toEqual({ ok: false, reason: "unsupported_type" })
    await sink.flushForTests()
    const [failedEvent] = sink.list()
    expect(failedEvent?.outcome).toBe("failed")
    expect(failedEvent?.resource).toBe(NOTIFICATION_IMAGE_AUDIT_RESOURCE)
    expect(failedEvent?.metadata).toEqual({ source: "mcp-http", failureReason: "unsupported_type" })
    expect(JSON.stringify(failedEvent)).not.toContain(dir)

    const good = path.join(dir, "ok.png")
    await writeFile(good, png)
    expect(await readNotificationImageFile({
      filePath: good, actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: sink, metadata: {},
    })).toMatchObject({ ok: true, mimeType: "image/png" })
    await sink.flushForTests()
    const allowedEvent = sink.list()[1]
    expect(allowedEvent?.outcome).toBe("allowed")
    expect(allowedEvent?.metadata).toEqual({ mimeType: "image/png", byteSize: png.byteLength })
    expect(JSON.stringify(allowedEvent)).not.toContain(dir)
  })

  it("rejects directories and symlinks instead of following them", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const guard = allowedGuard()
    expect(await readNotificationImageFile({
      filePath: dir, actor: { kind: "system" }, permissionGuard: guard as never,
      auditSink: { record: vi.fn() } as never, metadata: {},
    })).toEqual({ ok: false, reason: "not_regular_file" })
    const target = path.join(dir, "real.png")
    await writeFile(target, png)
    const link = path.join(dir, "link.png")
    await symlink(target, link)
    expect(await readNotificationImageFile({
      filePath: link, actor: { kind: "system" }, permissionGuard: guard as never,
      auditSink: { record: vi.fn() } as never, metadata: {},
    })).toEqual({ ok: false, reason: "not_regular_file" })
  })

  it("rejects files above the local byte limit", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "notify-image-"))
    const file = path.join(dir, "big.png")
    const bytes = Buffer.alloc(NOTIFICATION_IMAGE_MAX_BYTES + 1)
    png.copy(bytes)
    await writeFile(file, bytes)
    expect(await readNotificationImageFile({
      filePath: file, actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
      auditSink: { record: vi.fn() } as never, metadata: {},
    })).toEqual({ ok: false, reason: "too_large" })
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
      expect(await readNotificationImageFile({
        filePath: file, actor: { kind: "system" }, permissionGuard: allowedGuard() as never,
        auditSink: { record: vi.fn() } as never, metadata: {},
      })).toMatchObject({ ok: true, mimeType })
    }
  })
})
