import { beforeEach, describe, expect, it, vi } from "vitest"
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import * as os from "node:os"
import * as path from "node:path"
import { PassThrough, Readable } from "node:stream"
import * as tar from "tar"
import { BackupService, buildBackupKey, buildPgDumpOptions } from "./backup.service"
import {
  createBackupManifest,
  createRestoreMarkdown,
  scanForSecretLikeText,
  sha256File,
  writeJsonFile,
} from "./backup-package"

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    ...actual,
    createReadStream: vi.fn(actual.createReadStream),
    readFileSync: vi.fn(actual.readFileSync),
  }
})

vi.mock("node:child_process", async () => {
  const actualFs = await vi.importActual<typeof import("node:fs")>("node:fs")
  return {
    execFile: vi.fn((_command, args, _options, callback) => {
      const argList = Array.isArray(args) ? args : []
      const fileIndex = argList.indexOf("-f")
      const outputPath = fileIndex >= 0 && typeof argList[fileIndex + 1] === "string"
        ? argList[fileIndex + 1]
        : undefined
      if (outputPath) {
        actualFs.writeFileSync(outputPath, "postgres globals", "utf8")
      }
      callback(null, "25\n", "")
    }),
  }
})

beforeEach(() => {
  vi.clearAllMocks()
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
      "--exclude-table-data=public.\"ProblemFeedback\"",
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

describe("backup package helpers", () => {
  it("writes stable JSON and calculates sha256 checksums", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-backup-package-"))
    const jsonPath = path.join(dir, "manifest.json")
    const textPath = path.join(dir, "payload.txt")

    try {
      await writeJsonFile(jsonPath, { ok: true, count: 2 })
      await writeFile(textPath, "payload", "utf8")

      await expect(readFile(jsonPath, "utf8")).resolves.toBe(
        "{\n  \"ok\": true,\n  \"count\": 2\n}\n",
      )
      await expect(sha256File(textPath)).resolves.toBe(
        "239f59ed55e737c77147cf55ad0c1b030b6d7ee748a7426952f9b852d5a935e5",
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it("creates a manifest without secret values", () => {
    const manifest = createBackupManifest({
      createdAt: "2026-06-08T14:23:25.189Z",
      appVersion: "0.1.0",
      migrationCount: 25,
      backupBucket: "synapse-file-backup-1252371654",
      backupRegion: "ap-beijing",
      driveBucket: "synapse-file-user-1252371654",
      driveRegion: "ap-beijing",
      contents: [
        {
          path: "database.sql.gz",
          sha256: "a".repeat(64),
          size: 1024,
        },
      ],
    })

    const serialized = JSON.stringify(manifest)
    expect(manifest.secretsIncluded).toBe(false)
    expect(manifest.driveObjectsIncluded).toBe(false)
    expect(serialized).not.toContain("SECRET")
    expect(serialized).not.toContain("TOKEN")
    expect(serialized).not.toContain("PASSWORD")
  })

  it("detects secret-like restore text regressions", () => {
    expect(scanForSecretLikeText("restore with bucket names only")).toBe(false)
    expect(scanForSecretLikeText("BACKUP_COS_SECRET_KEY=plain")).toBe(true)
    expect(scanForSecretLikeText("Authorization: Bearer token")).toBe(true)
  })

  it("creates restore markdown that points users to the production server env", () => {
    const restore = createRestoreMarkdown({
      createdAt: "2026-06-08T14:23:25.189Z",
      filename: "synapse-backup-2026-06-08T14-23-25-189Z.tar",
    })

    expect(restore).toContain("server/.env.server")
    expect(restore).toContain("database.sql.gz")
    expect(restore).toContain("不包含问题反馈记录")
    expect(restore).toContain("postgres-globals.sql")
    expect(scanForSecretLikeText(restore)).toBe(false)
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

  it("lists backups across paginated COS results", async () => {
    const logger = { error: vi.fn() }
    const getBucket = vi.fn((options, callback) => {
      if (options.Marker === "next") {
        callback(null, {
          Contents: [
            {
              Key: "backups/page-b.tar.gz",
              Size: "4096",
              LastModified: "2026-05-24T00:00:00.000Z",
            },
          ],
          IsTruncated: "false",
        })
        return
      }
      callback(null, {
        Contents: [
          {
            Key: "backups/page-a.tar.gz",
            Size: "2048",
            LastModified: "2026-05-23T00:00:00.000Z",
          },
        ],
        IsTruncated: "true",
        NextMarker: "next",
      })
    })
    const service = createBackupService({ getBucket }, logger)

    await expect(service.listBackups()).resolves.toEqual([
      {
        filename: "page-a.tar.gz",
        size: 2048,
        createdAt: "2026-05-23T00:00:00.000Z",
      },
      {
        filename: "page-b.tar.gz",
        size: 4096,
        createdAt: "2026-05-24T00:00:00.000Z",
      },
    ])
    expect(getBucket).toHaveBeenCalledTimes(2)
    expect(getBucket).toHaveBeenNthCalledWith(
      2,
      {
        Bucket: "bucket",
        Region: "ap-guangzhou",
        Prefix: "backups/",
        Marker: "next",
      },
      expect.any(Function),
    )
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
      if (options.Key === "backups/expired-a.tar.gz") {
        callback(new Error("delete failed token=secret-token at /Users/liyang/private"))
      }
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
      { error: "delete failed token=[REDACTED] at [PATH]", filename: "expired-a.tar.gz" },
      "Failed to delete expired backup",
    )
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret-token")
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("/Users/liyang/private")
    expect(auditLog.record).toHaveBeenNthCalledWith(1, {
      adminEmail: "system",
      action: "backup.cleanup.failed",
      targetType: "backup",
      targetId: "expired-a.tar.gz",
      detail: {
        filename: "expired-a.tar.gz",
        createdAt: "2026-04-01T00:00:00.000Z",
        size: 1,
        error: "delete failed token=[REDACTED] at [PATH]",
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

  it("cleans expired backups across paginated COS results", async () => {
    const deleteObject = vi.fn((_options, callback) => callback(null))
    const getBucket = vi.fn((options, callback) => {
      if (options.Marker === "next") {
        callback(null, {
          Contents: [
            {
              Key: "backups/expired-b.tar.gz",
              Size: "1",
              LastModified: "2026-04-02T00:00:00.000Z",
            },
          ],
          IsTruncated: "false",
        })
        return
      }
      callback(null, {
        Contents: [
          {
            Key: "backups/expired-a.tar.gz",
            Size: "1",
            LastModified: "2026-04-01T00:00:00.000Z",
          },
        ],
        IsTruncated: "true",
        NextMarker: "next",
      })
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({ deleteObject, getBucket }, logger, auditLog)

    await (service as unknown as { cleanExpiredBackups(): Promise<void> }).cleanExpiredBackups()

    expect(getBucket).toHaveBeenCalledTimes(2)
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
  })

  it("records failed cleanup scans in audit logs", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const auditLog = { record: vi.fn().mockResolvedValue(undefined) }
    const service = createBackupService({
      getBucket: vi.fn((_options, callback) => callback(new Error("COS unavailable apiKey=secret-key at /tmp/backup"))),
    }, logger, auditLog)

    await (service as unknown as { cleanExpiredBackups(): Promise<void> }).cleanExpiredBackups()

    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "system",
      action: "backup.cleanup.failed",
      targetType: "backup",
      targetId: "expired-scan",
      detail: { error: "COS unavailable apiKey=[REDACTED] at [PATH]" },
      ipAddress: "system",
    })
    expect(logger.error).toHaveBeenCalledWith(
      { error: "COS unavailable apiKey=[REDACTED] at [PATH]" },
      "Failed to clean expired backups",
    )
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("secret-key")
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("/tmp/backup")
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
      error: "pg_dump failed apiKey=secret-key Authorization: Bearer sk-secret https://example.com/private /Users/example/private/report.zip",
    }
    vi.spyOn(service, "performBackup").mockResolvedValue(result)

    await service.scheduledBackup()

    const detail = {
      ...result,
      error: expect.stringContaining("apiKey=[REDACTED]"),
    }
    expect(auditLog.record).toHaveBeenCalledWith({
      adminEmail: "system",
      action: "backup.scheduled.failed",
      targetType: "backup",
      targetId: "synapse-backup-2026-05-23.tar.gz",
      detail,
      ipAddress: "system",
    })
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("secret-key")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("sk-secret")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("https://example.com/private")
    expect(JSON.stringify(auditLog.record.mock.calls)).not.toContain("/Users/example/private/report.zip")
  })

  it("exports postgres globals into the backup package", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({}, logger)
    const globalsPath = path.join(os.tmpdir(), `synapse-globals-${Date.now()}.sql`)

    await (service as unknown as {
      dumpPostgresGlobals(filePath: string): Promise<void>
    }).dumpPostgresGlobals(globalsPath)

    try {
      expect(fs.readFileSync(globalsPath, "utf8")).toContain("postgres globals")
      const pgDumpAllCall = vi.mocked(execFile).mock.calls.find(([command]) => command === "pg_dumpall")
      expect(pgDumpAllCall?.[1]).toEqual([
        "-h",
        "localhost",
        "-p",
        "5432",
        "-U",
        "synapse",
        "--globals-only",
        "--no-role-passwords",
        "-f",
        globalsPath,
      ])
    } finally {
      fs.rmSync(globalsPath, { force: true })
    }
  })

  it("writes a paginated Drive COS manifest when Drive COS is configured", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const getBucket = vi.fn((options, callback) => {
      if (options.Marker === "next") {
        callback(null, {
          Contents: [
            {
              Key: "drive/item-b",
              Size: "22",
              ETag: "\"etag-b\"",
              LastModified: "2026-06-08T14:23:01.000Z",
            },
          ],
          IsTruncated: "false",
        })
        return
      }
      callback(null, {
        Contents: [
          {
            Key: "drive/item-a",
            Size: "11",
            ETag: "\"etag-a\"",
            LastModified: "2026-06-08T14:23:00.000Z",
          },
        ],
        IsTruncated: "true",
        NextMarker: "next",
      })
    })
    const service = createBackupService({ getBucket }, logger)
    vi.spyOn(service as unknown as {
      createDriveCosClient(): { getBucket: typeof getBucket }
    }, "createDriveCosClient").mockReturnValue({ getBucket })
    Object.assign(service as unknown as { env: Record<string, string> }, {
      env: {
        backupCosBucket: "backup-bucket",
        backupCosRegion: "ap-guangzhou",
        backupCosSecretId: "secret-id",
        backupCosSecretKey: "secret-key",
        driveCosBucket: "drive-bucket",
        driveCosRegion: "ap-beijing",
        driveCosSecretId: "drive-secret-id",
        driveCosSecretKey: "drive-secret-key",
        databaseUrl: "postgresql://synapse:secret@localhost:5432/synapse",
      },
    })
    const manifestPath = path.join(os.tmpdir(), `drive-cos-manifest-${Date.now()}.json`)

    await (service as unknown as {
      writeDriveCosManifest(filePath: string): Promise<void>
    }).writeDriveCosManifest(manifestPath)

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      expect(manifest).toEqual({
        bucket: "drive-bucket",
        region: "ap-beijing",
        prefix: "drive/",
        objects: [
          {
            key: "drive/item-a",
            size: 11,
            etag: "\"etag-a\"",
            lastModified: "2026-06-08T14:23:00.000Z",
          },
          {
            key: "drive/item-b",
            size: 22,
            etag: "\"etag-b\"",
            lastModified: "2026-06-08T14:23:01.000Z",
          },
        ],
      })
      expect(getBucket).toHaveBeenCalledTimes(2)
      expect(getBucket).toHaveBeenNthCalledWith(
        1,
        {
          Bucket: "drive-bucket",
          Region: "ap-beijing",
          Prefix: "drive/",
        },
        expect.any(Function),
      )
    } finally {
      fs.rmSync(manifestPath, { force: true })
    }
  })

  it("writes a local Drive manifest when Drive COS is not configured", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({}, logger)
    const manifestPath = path.join(os.tmpdir(), `drive-local-manifest-${Date.now()}.json`)

    await (service as unknown as {
      writeDriveCosManifest(filePath: string): Promise<void>
    }).writeDriveCosManifest(manifestPath)

    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
      expect(manifest).toEqual({
        storage: "local",
        included: false,
        reason: "Drive COS is not configured.",
      })
    } finally {
      fs.rmSync(manifestPath, { force: true })
    }
  })

  it("packs database, globals, Drive manifest, backup manifest, and restore instructions", async () => {
    const archiveCopyPath = path.join(os.tmpdir(), `synapse-backup-upload-${Date.now()}.tar`)
    const putObject = vi.fn((options, callback) => {
      const body = options.Body as NodeJS.ReadableStream
      body.pipe(fs.createWriteStream(archiveCopyPath)).on("finish", () => callback(null))
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({
      putObject,
      getBucket: vi.fn((_options, callback) => callback(null, { Contents: [] })),
    }, logger)

    vi.spyOn(service as unknown as { dumpDatabase(): Promise<string> }, "dumpDatabase")
      .mockImplementation(async () => {
        const dumpPath = path.join(os.tmpdir(), `database-${Date.now()}.sql.gz`)
        fs.writeFileSync(dumpPath, "database", "utf8")
        return dumpPath
      })
    vi.spyOn(service as unknown as { dumpPostgresGlobals(filePath: string): Promise<void> }, "dumpPostgresGlobals")
      .mockImplementation(async (filePath) => {
        fs.writeFileSync(filePath, "globals", "utf8")
      })
    vi.spyOn(service as unknown as { writeDriveCosManifest(filePath: string): Promise<void> }, "writeDriveCosManifest")
      .mockImplementation(async (filePath) => {
        fs.writeFileSync(filePath, "{\n  \"objects\": []\n}\n", "utf8")
      })

    const result = await service.performBackup()

    expect(result.status).toBe("success")
    expect(result.filename).toMatch(/\.tar$/)
    const extractDir = path.join(os.tmpdir(), `synapse-backup-extract-${Date.now()}`)

    try {
      fs.mkdirSync(extractDir, { recursive: true })
      await tar.extract({ file: archiveCopyPath, cwd: extractDir })

      expect(fs.existsSync(path.join(extractDir, "database.sql.gz"))).toBe(true)
      expect(fs.readFileSync(path.join(extractDir, "postgres-globals.sql"), "utf8")).toBe("globals")
      expect(fs.existsSync(path.join(extractDir, "drive-cos-manifest.json"))).toBe(true)
      expect(fs.readFileSync(path.join(extractDir, "restore.md"), "utf8")).toContain("server/.env.server")

      const manifest = JSON.parse(fs.readFileSync(path.join(extractDir, "backup-manifest.json"), "utf8"))
      expect(manifest.secretsIncluded).toBe(false)
      expect(manifest.driveObjectsIncluded).toBe(false)
      expect(manifest.database.migrationCount).toBe(25)
      expect(JSON.stringify(manifest)).not.toContain("secret-id")
      expect(JSON.stringify(manifest)).not.toContain("secret-key")
      expect(JSON.stringify(manifest)).not.toContain("postgresql://")
      expect(manifest.contents.map((item: { path: string }) => item.path)).toEqual([
        "database.sql.gz",
        "postgres-globals.sql",
        "drive-cos-manifest.json",
        "restore.md",
      ])
    } finally {
      fs.rmSync(archiveCopyPath, { force: true })
      fs.rmSync(extractDir, { recursive: true, force: true })
    }
  })

  it("fails the backup when postgres globals export fails", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({
      putObject: vi.fn((_options, callback) => callback(null)),
      getBucket: vi.fn((_options, callback) => callback(null, { Contents: [] })),
    }, logger)
    vi.spyOn(service as unknown as { dumpDatabase(): Promise<string> }, "dumpDatabase")
      .mockImplementation(async () => {
        const dumpPath = path.join(os.tmpdir(), `database-${Date.now()}.sql.gz`)
        fs.writeFileSync(dumpPath, "database", "utf8")
        return dumpPath
      })
    vi.spyOn(service as unknown as { dumpPostgresGlobals(filePath: string): Promise<void> }, "dumpPostgresGlobals")
      .mockRejectedValue(new Error("globals failed"))

    const result = await service.performBackup()

    expect(result.status).toBe("failed")
    expect(result.error).toBe("globals failed")
  })

  it("fails the backup when Drive COS manifest export fails", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({
      putObject: vi.fn((_options, callback) => callback(null)),
      getBucket: vi.fn((_options, callback) => callback(null, { Contents: [] })),
    }, logger)
    vi.spyOn(service as unknown as { dumpDatabase(): Promise<string> }, "dumpDatabase")
      .mockImplementation(async () => {
        const dumpPath = path.join(os.tmpdir(), `database-${Date.now()}.sql.gz`)
        fs.writeFileSync(dumpPath, "database", "utf8")
        return dumpPath
      })
    vi.spyOn(service as unknown as { dumpPostgresGlobals(filePath: string): Promise<void> }, "dumpPostgresGlobals")
      .mockImplementation(async (filePath) => {
        fs.writeFileSync(filePath, "globals", "utf8")
      })
    vi.spyOn(service as unknown as { writeDriveCosManifest(filePath: string): Promise<void> }, "writeDriveCosManifest")
      .mockRejectedValue(new Error("drive manifest failed"))

    const result = await service.performBackup()

    expect(result.status).toBe("failed")
    expect(result.error).toBe("drive manifest failed")
  })

  it("redacts sensitive failed backup errors before returning the result", async () => {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({
      putObject: vi.fn((_options, callback) => callback(null)),
      getBucket: vi.fn((_options, callback) => callback(null, { Contents: [] })),
    }, logger)
    vi.spyOn(service as unknown as { dumpDatabase(): Promise<string> }, "dumpDatabase")
      .mockImplementation(async () => {
        const dumpPath = path.join(os.tmpdir(), `database-${Date.now()}.sql.gz`)
        fs.writeFileSync(dumpPath, "database", "utf8")
        return dumpPath
      })
    vi.spyOn(service as unknown as { dumpPostgresGlobals(filePath: string): Promise<void> }, "dumpPostgresGlobals")
      .mockRejectedValue(new Error("backup failed token=plain-token https://user:password@internal.example.com/bucket/key /Users/liyang/private/backup.sql"))

    const result = await service.performBackup()

    expect(result.status).toBe("failed")
    expect(result.error).toContain("token=[REDACTED]")
    expect(result.error).toContain("[URL]")
    expect(result.error).toContain("[PATH]")
    expect(result.error).not.toContain("plain-token")
    expect(result.error).not.toContain("user:password")
    expect(logger.error).toHaveBeenCalledWith({ error: result.error }, "Backup failed")
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
    const createReadStream = vi.mocked(fs.createReadStream).mockReturnValueOnce(archiveStream as fs.ReadStream)
    const readFileSync = vi.mocked(fs.readFileSync)
    const putObject = vi.fn((options, callback) => {
      ;(options.Body as NodeJS.ReadableStream).resume()
      callback(null)
    })
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

  it("waits for the backup archive stream to finish before resolving upload", async () => {
    const archiveStream = new PassThrough()
    vi.mocked(fs.createReadStream).mockReturnValueOnce(archiveStream as unknown as fs.ReadStream)
    const putObject = vi.fn((options, callback) => {
      ;(options.Body as NodeJS.ReadableStream).resume()
      callback(null)
    })
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
    const service = createBackupService({ putObject }, logger)

    const uploadPromise = (service as unknown as {
      uploadToCos(filePath: string, filename: string): Promise<void>
    }).uploadToCos("/tmp/synapse-backup.tar", "synapse-backup.tar")
    let resolved = false
    uploadPromise.then(() => {
      resolved = true
    })

    await new Promise((resolve) => setImmediate(resolve))
    expect(resolved).toBe(false)

    archiveStream.end("archive")

    await expect(uploadPromise).resolves.toBeUndefined()
    expect(resolved).toBe(true)
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
      backupCosBucket: "bucket",
      backupCosRegion: "ap-guangzhou",
      backupCosSecretId: "secret-id",
      backupCosSecretKey: "secret-key",
      databaseUrl: "postgresql://synapse:secret@localhost:5432/synapse",
    },
    region: "ap-guangzhou",
    prefix: "backups/",
    logger,
  })
  return service
}
