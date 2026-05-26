import { describe, expect, it, vi } from "vitest"
import { Readable, Writable } from "node:stream"
import { BackupController } from "./backup.controller"
import type { BackupService } from "./backup.service"

describe("BackupController", () => {
  it("returns successful backup results", async () => {
    const result = {
      filename: "synapse-backup.tar.gz",
      size: 1024,
      uploadedAt: "2026-05-22T00:00:00.000Z",
      status: "success" as const,
    }
    const service = {
      performBackup: vi.fn().mockResolvedValue(result),
    }
    const controller = new BackupController(service as unknown as BackupService)

    await expect(controller.triggerBackup()).resolves.toEqual(result)
  })

  it("throws with the backup filename when backup returns a failed result", async () => {
    const service = {
      performBackup: vi.fn().mockResolvedValue({
        filename: "synapse-backup.tar.gz",
        size: 0,
        uploadedAt: "2026-05-22T00:00:00.000Z",
        status: "failed",
        error: "COS 未配置",
      }),
    }
    const controller = new BackupController(service as unknown as BackupService)

    await expect(controller.triggerBackup()).rejects.toMatchObject({
      message: "备份失败：COS 未配置",
      filename: "synapse-backup.tar.gz",
    })
  })

  it("sends backup downloads as attachments", async () => {
    const stream = Readable.from(["backup"])
    const service = {
      downloadBackup: vi.fn().mockReturnValue(stream),
    }
    const auditLog = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    const chunks: Buffer[] = []
    const response = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }) as Writable & { set: ReturnType<typeof vi.fn> }
    response.set = vi.fn()
    const controller = new BackupController(service as unknown as BackupService, auditLog as never)

    await controller.downloadBackup("synapse-backup.tar", response as never, {
      admin: { email: "admin@example.com" },
      ip: "203.0.113.80",
    } as never)

    expect(service.downloadBackup).toHaveBeenCalledWith("synapse-backup.tar")
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/x-tar",
      "Content-Disposition": "attachment; filename=\"synapse-backup.tar\"; filename*=UTF-8''synapse-backup.tar",
    })
    expect(Buffer.concat(chunks)).toEqual(Buffer.from("backup"))
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "admin@example.com",
      action: "backup.download",
      targetType: "backup",
      targetId: "synapse-backup.tar",
      detail: { filename: "synapse-backup.tar" },
      ipAddress: "203.0.113.80",
    })
  })

  it("rethrows backup stream errors before sending headers", async () => {
    const error = new Error("COS stream failed")
    const stream = new Readable({
      read() {
        this.destroy(error)
      },
    })
    const service = {
      downloadBackup: vi.fn().mockReturnValue(stream),
    }
    const response = new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        callback()
      },
    }) as Writable & { set: ReturnType<typeof vi.fn>; headersSent: boolean }
    response.set = vi.fn()
    Object.defineProperty(response, "headersSent", { value: false })
    const auditLog = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new BackupController(service as unknown as BackupService, auditLog as never)

    await expect(controller.downloadBackup("synapse-backup.tar", response as never)).rejects.toThrow(error)
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "backup.download.failed",
      targetId: "synapse-backup.tar",
      detail: { filename: "synapse-backup.tar", error: "COS stream failed" },
    }))
  })

  it("destroys the response on backup stream errors after headers are sent", async () => {
    const error = new Error("COS stream failed")
    let readStarted = false
    const stream = new Readable({
      read() {
        if (readStarted) return
        readStarted = true
        this.push("partial")
        this.destroy(error)
      },
    })
    const service = {
      downloadBackup: vi.fn().mockReturnValue(stream),
    }
    const response = new Writable({
      write(_chunk: Buffer, _encoding, callback) {
        headersSent = true
        callback()
      },
    }) as Writable & { set: ReturnType<typeof vi.fn>; headersSent: boolean }
    let headersSent = false
    response.set = vi.fn()
    const destroy = vi.spyOn(response, "destroy")
    Object.defineProperty(response, "headersSent", { get: () => headersSent })
    const auditLog = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new BackupController(service as unknown as BackupService, auditLog as never)

    await expect(controller.downloadBackup("synapse-backup.tar", response as never)).resolves.toBeUndefined()
    expect(auditLog.record).toHaveBeenCalledWith(expect.objectContaining({
      action: "backup.download.failed",
      targetId: "synapse-backup.tar",
      detail: { filename: "synapse-backup.tar", error: "COS stream failed" },
    }))
    expect(destroy).toHaveBeenCalledWith(error)
  })

  it("deletes a backup file", async () => {
    const service = {
      deleteBackup: vi.fn().mockResolvedValue(undefined),
    }
    const controller = new BackupController(service as unknown as BackupService)

    await expect(controller.deleteBackup("synapse-backup.tar.gz")).resolves.toEqual({ ok: true })

    expect(service.deleteBackup).toHaveBeenCalledWith("synapse-backup.tar.gz")
  })
})
