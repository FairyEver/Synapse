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
        error: "COS failed token=plain-token https://user:password@internal.example.com/bucket/key",
      }),
    }
    const controller = new BackupController(service as unknown as BackupService)

    const error = await controller.triggerBackup().catch((caught: unknown) => caught)

    expect(error).toMatchObject({
      message: "备份失败，请检查服务器日志或备份配置。",
      filename: "synapse-backup.tar.gz",
    })
    expect(JSON.stringify(error)).not.toContain("plain-token")
    expect(JSON.stringify(error)).not.toContain("user:password")
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

  it("answers backup download HEAD checks without opening the backup stream", () => {
    const service = {
      downloadBackup: vi.fn(),
    }
    const auditLog = {
      record: vi.fn().mockResolvedValue(undefined),
    }
    const response = {
      end: vi.fn(),
      set: vi.fn(),
    }
    const controller = new BackupController(service as unknown as BackupService, auditLog as never)

    controller.checkDownloadBackup("synapse-backup.tar", response as never)

    expect(service.downloadBackup).not.toHaveBeenCalled()
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/x-tar",
      "Content-Disposition": "attachment; filename=\"synapse-backup.tar\"; filename*=UTF-8''synapse-backup.tar",
    })
    expect(response.end).toHaveBeenCalledOnce()
    expect(auditLog.record).not.toHaveBeenCalled()
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

  it("redacts sensitive backup download errors before recording audit details", async () => {
    const rawError = [
      "download failed Authorization: Bearer secret-bearer",
      "token=plain-token",
      "apiKey=plain-api-key",
      "https://user:password@internal.example.com/bucket/key",
      "/Users/liyang/private/backup.sql",
    ].join(" ")
    const error = new Error(rawError)
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

    await expect(controller.downloadBackup("synapse-backup.tar", response as never)).rejects.toThrow(rawError)

    const detail = auditLog.record.mock.calls[0]?.[0].detail
    expect(detail.error).toContain("[REDACTED]")
    expect(JSON.stringify(detail)).not.toContain("secret-bearer")
    expect(JSON.stringify(detail)).not.toContain("plain-token")
    expect(JSON.stringify(detail)).not.toContain("plain-api-key")
    expect(JSON.stringify(detail)).not.toContain("internal.example.com")
    expect(JSON.stringify(detail)).not.toContain("/Users/liyang/private")
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
