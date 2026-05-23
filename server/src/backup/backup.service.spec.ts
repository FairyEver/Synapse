import { describe, expect, it, vi } from "vitest"
import { BackupService, buildBackupKey, buildPgDumpOptions } from "./backup.service"

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
})

function createBackupService(cos: unknown, logger: { error: ReturnType<typeof vi.fn> }): BackupService {
  const service = Object.create(BackupService.prototype) as BackupService
  Object.assign(service as unknown as {
    cos: unknown
    bucket: string
    region: string
    prefix: string
    logger: typeof logger
  }, {
    cos,
    bucket: "bucket",
    region: "ap-guangzhou",
    prefix: "backups/",
    logger,
  })
  return service
}
