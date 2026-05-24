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

  it("throws when backup returns a failed result", async () => {
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

    await expect(controller.triggerBackup()).rejects.toThrow("备份失败：COS 未配置")
  })

  it("sends backup downloads as attachments", async () => {
    const stream = Readable.from(["backup"])
    const service = {
      downloadBackup: vi.fn().mockReturnValue(stream),
    }
    const chunks: Buffer[] = []
    const response = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }) as Writable & { set: ReturnType<typeof vi.fn> }
    response.set = vi.fn()
    const controller = new BackupController(service as unknown as BackupService)

    await controller.downloadBackup("synapse-backup.tar", response as never)

    expect(service.downloadBackup).toHaveBeenCalledWith("synapse-backup.tar")
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/x-tar",
      "Content-Disposition": "attachment; filename=\"synapse-backup.tar\"; filename*=UTF-8''synapse-backup.tar",
    })
    expect(Buffer.concat(chunks)).toEqual(Buffer.from("backup"))
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
