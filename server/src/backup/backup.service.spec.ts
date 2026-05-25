import { describe, expect, it, vi } from "vitest"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { Readable } from "node:stream"
import { BackupService, buildBackupKey, buildPgDumpOptions } from "./backup.service"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
    readFileSync: vi.fn(actual.readFileSync),
  }
})

describe("buildPgDumpOptions", () => {
  it("keeps database passwords out of pg_dump command arguments", () => {
    const databaseUrl = "postgresql://synapse_user:secret%40pass@localhost:5433/synapse?sslmode=require"

    const options = buildPgDumpOptions(databaseUrl, "/tmp/dump.sql", { PATH: "/usr/bin" })

    expect(options.args).toEqual([
      "-h",
      "localhost",
      "-p",
      "5433",
      "-U",
      "synapse_user",
      "-d",
      "synapse",
      "-f",
      "/tmp/dump.sql",
    ])
    expect(options.args.join(" ")).not.toContain("secret")
    expect(options.args).not.toContain(databaseUrl)
    expect(options.env.PGPASSWORD).toBe("secret@pass")
    expect(options.env.PGSSLMODE).toBe("require")
  })
})

describe("buildBackupKey", () => {
  it("rejects path traversal filenames", () => {
    expect(() => buildBackupKey("backups/", "../dump.tar.gz")).toThrow("备份文件名无效。")
    expect(() => buildBackupKey("backups/", "nested/dump.tar.gz")).toThrow("备份文件名无效。")
    expect(() => buildBackupKey("backups/", "nested\\dump.tar.gz")).toThrow("备份文件名无效。")
  })

  it("builds keys for plain backup filenames", () => {
    expect(buildBackupKey("backups/", "synapse-backup.tar.gz")).toBe("backups/synapse-backup.tar.gz")
  })
})

describe("BackupService", () => {
  it("rejects manual backups before dumping when COS is not configured", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService(null, logger)

    await expect(service.performBackup()).rejects.toThrow("备份未配置。")

    expect(logger.error).not.toHaveBeenCalled()
  })

  it("maps COS LastModified to the admin API createdAt field", async () => {
    const logger = { error: vi.fn() }
    const service = createBackupService({
      getBucket: vi.fn((_options, callback) => callback(null, {
        Contents: [
          {
            Key: "backups/synapse-backup.tar.gz",
            Size: "2048",
            LastModified: "2026-05-23T00:00:00.000Z",
          },
        ],
      })),
    }, logger)

    await expect(service.listBackups()).resolves.toEqual([
      {
        filename: "synapse-backup.tar.gz",
        size: 2048,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
    ])
  })

  it("propagates COS list failures instead of returning an empty list", async () => {
    const error = new Error("COS unavailable")
    const logger = { error: vi.fn() }
    const service = createBackupService({
      getBucket: vi.fn((_options, callback) => callback(error)),
    }, logger)

    await expect(service.listBackups()).rejects.toThrow("COS unavailable")

    expect(logger.error).toHaveBeenCalledWith({ error: "COS unavailable" }, "Failed to list backups")
  })

  it("continues cleaning expired backups when one delete fails", async () => {
    const deleteObject = vi.fn((options, callback) => {
      if (options.Key === "backups/expired-a.tar.gz") callback(new Error("delete failed"))
      else callback(null)
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({
      deleteObject,
      getBucket: vi.fn((_options, callback) => callback(null, {
        Contents: [
          {
            Key: "backups/expired-a.tar.gz",
            Size: "1",
            LastModified: "2026-04-01T00:00:00.000Z",
          },
          {
            Key: "backups/expired-b.tar.gz",
            Size: "1",
            LastModified: "2026-04-02T00:00:00.000Z",
          },
        ],
      })),
    }, logger, auditLog)

    await (service as unknown as { cleanExpiredBackups(): Promise<void> }).cleanExpiredBackups()

    expect(deleteObject).toHaveBeenCalledTimes(2)
    expect(deleteObject).toHaveBeenNthCalledWith(
      2,
      {
        Bucket: "bucket",
        Region: "ap-guangzhou",
        Key: "backups/expired-b.tar.gz",
      },
      expect.any(Function),
    )
    expect(logger.warn).toHaveBeenCalledWith(
      { error: "delete failed", filename: "expired-a.tar.gz" },
      "Failed to delete expired backup",
    )
    expect(auditLog.record).toHaveBeenNthCalledWith(1, {
      adminEmail: "system",
      action: "backup.cleanup.failed",
      targetType: "backup",
      targetId: "expired-a.tar.gz",
      detail: {
        filename: "expired-a.tar.gz",
        createdAt: "2026-04-01T00:00:00.000Z",
        size: 1,
        error: "delete failed",
      },
      ipAddress: "system",
    })
    expect(auditLog.record).toHaveBeenNthCalledWith(2, {
      adminEmail: "system",
      action: "backup.cleanup.delete",
      targetType: "backup",
      targetId: "expired-b.tar.gz",
      detail: {
        filename: "expired-b.tar.gz",
        createdAt: "2026-04-02T00:00:00.000Z",
        size: 1,
      },
      ipAddress: "system",
    })
  })

  it("records failed cleanup scans in audit logs", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({
      getBucket: vi.fn((_options, callback) => callback(new Error("COS unavailable"))),
    }, logger, auditLog)

    await (service as unknown as { cleanExpiredBackups(): Promise<void> }).cleanExpiredBackups()

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "system",
      action: "backup.cleanup.failed",
      targetType: "backup",
      targetId: "expired-scan",
      detail: { error: "COS unavailable" },
      ipAddress: "system",
    })
    expect(logger.error).toHaveBeenCalledWith({ error: "COS unavailable" }, "Failed to clean expired backups")
  })

  it("records scheduled backup results in audit logs", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({}, logger, auditLog)
    const result = {
      filename: "synapse-backup-2026-05-23.tar.gz",
      size: 1024,
      uploadedAt: "2026-05-23T03:00:00.000Z",
      status: "success" as const,
    }
    vi.spyOn(service, "performBackup").mockResolvedValue(result)

    await service.scheduledBackup()

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "system",
      action: "backup.scheduled",
      targetType: "backup",
      targetId: "synapse-backup-2026-05-23.tar.gz",
      detail: result,
      ipAddress: "system",
    })
  })

  it("marks failed scheduled backups with a failure action", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({}, logger, auditLog)
    const result = {
      filename: "synapse-backup-2026-05-23.tar.gz",
      size: 0,
      uploadedAt: "2026-05-23T03:00:00.000Z",
      status: "failed" as const,
      error: "pg_dump failed",
    }
    vi.spyOn(service, "performBackup").mockResolvedValue(result)

    await service.scheduledBackup()

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "system",
      action: "backup.scheduled.failed",
      targetType: "backup",
      targetId: "synapse-backup-2026-05-23.tar.gz",
      detail: result,
      ipAddress: "system",
    })
  })

  it("returns a COS object stream for backup downloads", () => {
    const stream = Readable.from(["backup"])
    const getObjectStream = vi.fn().mockReturnValue(stream)
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({ getObjectStream }, logger)

    expect(service.downloadBackup("synapse-backup.tar.gz")).toBe(stream)
    expect(getObjectStream).toHaveBeenCalledWith({
      Bucket: "bucket",
      Region: "ap-guangzhou",
      Key: "backups/synapse-backup.tar.gz",
    })
  })

  it("streams backup archives to COS without buffering the whole file", async () => {
    const archiveStream = Readable.from(["archive"])
    const createReadStream = vi.mocked(fs.createReadStream).mockReturnValue(archiveStream as fs.ReadStream)
    const readFileSync = vi.mocked(fs.readFileSync).mockReturnValue(Buffer.from("archive"))
    const putObject = vi.fn((options, callback) => callback(null))
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({ putObject }, logger)

    await (service as unknown as {
      uploadToCos(filePath: string, filename: string): Promise<void>
    }).uploadToCos("/tmp/synapse-backup.tar.gz", "synapse-backup.tar.gz")

    expect(createReadStream).toHaveBeenCalledWith("/tmp/synapse-backup.tar.gz")
    expect(readFileSync).not.toHaveBeenCalled()
    expect(putObject).toHaveBeenCalledWith(
      {
        Bucket: "bucket",
        Region: "ap-guangzhou",
        Key: "backups/synapse-backup.tar.gz",
        Body: archiveStream,
      },
      expect.any(Function),
    )
  })

  it("packs the already-compressed database dump without gziping the tar again", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({}, logger)
    const dbPath = path.join(os.tmpdir(), `synapse-test-${Date.now()}.sql.gz`)
    fs.writeFileSync(dbPath, Buffer.from([0x1f, 0x8b, 0x08, 0x00]))

    const archivePath = await (service as unknown as {
      packFiles(dbPath: string): Promise<string>
    }).packFiles(dbPath)

    try {
      expect(archivePath).toMatch(/\.tar$/)
      expect(fs.readFileSync(archivePath).subarray(0, 2)).not.toEqual(Buffer.from([0x1f, 0x8b]))
    } finally {
      fs.rmSync(dbPath, { force: true })
      fs.rmSync(archivePath, { force: true })
    }
  })

  it("removes the backup work directory when packing fails", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({}, logger)
    const now = 1_777_777_777_000
    const workDir = path.join(os.tmpdir(), `synapse-backup-${now}`)
    const archivePath = path.join(os.tmpdir(), `synapse-backup-${now}.tar`)
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now)

    try {
      await expect((service as unknown as {
        packFiles(dbPath: string): Promise<string>
      }).packFiles(path.join(os.tmpdir(), "missing-synapse-db.sql.gz")))
        .rejects
        .toThrow()

      expect(fs.existsSync(workDir)).toBe(false)
      expect(fs.existsSync(archivePath)).toBe(false)
    } finally {
      nowSpy.mockRestore()
      fs.rmSync(workDir, { recursive: true, force: true })
      fs.rmSync(archivePath, { force: true })
    }
  })
})

function createBackupService(cos: unknown, logger: {
  error: ReturnType<typeof vi.fn>
  info?: ReturnType<typeof vi.fn>
  warn?: ReturnType<typeof vi.fn>
}, auditLog?: { record: ReturnType<typeof vi.fn> }): BackupService {
  const service = Object.create(BackupService.prototype) as BackupService
  Object.assign(service as unknown as {
    auditLog?: typeof auditLog
    cos: unknown
    bucket: string
    env: unknown
    region: string
    prefix: string
    logger: typeof logger
  }, {
    auditLog,
    cos,
    bucket: "bucket",
    env: {
      cosBucket: "bucket",
      cosRegion: "ap-guangzhou",
      cosSecretId: "secret-id",
      cosSecretKey: "secret-key",
      databaseUrl: "postgresql://synapse:secret@localhost:5432/synapse",
    },
    region: "ap-guangzhou",
    prefix: "backups/",
    logger,
  })
  return service
}
