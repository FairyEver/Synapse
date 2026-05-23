import { describe, expect, it, vi } from "vitest"
import { BackupController } from "./backup.controller"
import type { BackupService } from "./backup.service"

describe("BackupController", () => {
  it("sends backup downloads as attachments", async () => {
    const buffer = Buffer.from("backup")
    const service = {
      downloadBackup: vi.fn().mockResolvedValue(buffer),
    }
    const response = {
      set: vi.fn(),
      send: vi.fn(),
    }
    const controller = new BackupController(service as unknown as BackupService)

    await controller.downloadBackup("synapse-backup.tar.gz", response as never)

    expect(service.downloadBackup).toHaveBeenCalledWith("synapse-backup.tar.gz")
    expect(response.set).toHaveBeenCalledWith({
      "Content-Type": "application/gzip",
      "Content-Disposition": 'attachment; filename="synapse-backup.tar.gz"',
      "Content-Length": buffer.length.toString(),
    })
    expect(response.send).toHaveBeenCalledWith(buffer)
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
