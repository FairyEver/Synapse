import { BadRequestException, Injectable, Optional, ServiceUnavailableException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { finished, pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import * as tar from "tar"
import type COS from "cos-nodejs-sdk-v5"
import { AuditLogService } from "../common/audit-log.service"
import { formatAuditError } from "../common/audit-error"
import { isBackupCosConfigured, isDriveCosConfigured, loadEnv, type ServerEnv } from "../config/env"
import {
  contentManifestItem,
  createBackupManifest,
  createRestoreMarkdown,
  scanForSecretLikeText,
  writeJsonFile,
} from "./backup-package"

const execFileAsync = promisify(execFile)

export interface BackupResult {
  filename: string
  size: number
  uploadedAt: string
  status: "success" | "failed"
  error?: string
}

export interface BackupItem {
  filename: string
  size: number
  createdAt: string
}

export interface PgDumpOptions {
  args: string[]
  env: NodeJS.ProcessEnv
}

export function buildBackupKey(prefix: string, filename: string): string {
  if (!filename || filename.includes("..") || filename.includes("/") || filename.includes("\\")) {
    throw new BadRequestException("备份文件名无效。")
  }
  return `${prefix}${filename}`
}

export function buildPgDumpOptions(
  databaseUrl: string,
  dumpFile: string,
  baseEnv: NodeJS.ProcessEnv = process.env,
): PgDumpOptions {
  const url = new URL(databaseUrl)
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    PGPASSWORD: decodeURIComponent(url.password),
  }
  const sslMode = url.searchParams.get("sslmode")
  if (sslMode) env.PGSSLMODE = sslMode

  return {
    args: [
      "-h",
      url.hostname,
      "-p",
      url.port || "5432",
      "-U",
      decodeURIComponent(url.username),
      "-d",
      decodeURIComponent(url.pathname.replace(/^\//, "")),
      "--exclude-table-data=public.\"ProblemFeedback\"",
      "-f",
      dumpFile,
    ],
    env,
  }
}

async function writeStreamChunk(stream: fs.WriteStream, chunk: string): Promise<void> {
  if (stream.write(chunk)) return
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      stream.off("drain", handleDrain)
      stream.off("error", handleError)
    }
    const handleDrain = () => {
      cleanup()
      resolve()
    }
    const handleError = (error: Error) => {
      cleanup()
      reject(error)
    }
    stream.once("drain", handleDrain)
    stream.once("error", handleError)
  })
}

@Injectable()
export class BackupService {
  private readonly env: ServerEnv
  private readonly cos: COS | null = null
  private readonly bucket: string
  private readonly region: string
  private readonly prefix = "backups/"

  constructor(
    private readonly logger: PinoLogger,
    @Optional() private readonly auditLog?: AuditLogService,
  ) {
    this.env = loadEnv(process.env)
    this.bucket = this.env.backupCosBucket ?? ""
    this.region = this.env.backupCosRegion ?? ""

    if (isBackupCosConfigured(this.env)) {
      const CosClient = require("cos-nodejs-sdk-v5") as typeof COS
      this.cos = new CosClient({
        SecretId: this.env.backupCosSecretId!,
        SecretKey: this.env.backupCosSecretKey!,
      })
    }
  }

  @Cron("0 3 * * *")
  async scheduledBackup(): Promise<void> {
    if (!isBackupCosConfigured(this.env)) {
      this.logger.info("Backup not configured, skipping scheduled backup")
      return
    }
    const result = await this.performBackup()
    await this.auditLog?.record({
      adminEmail: "system",
      action: result.status === "failed" ? "backup.scheduled.failed" : "backup.scheduled",
      targetType: "backup",
      targetId: result.filename,
      detail: formatScheduledBackupAuditDetail(result),
      ipAddress: "system",
    })
  }

  async performBackup(): Promise<BackupResult> {
    this.getBackupCos()
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `synapse-backup-${timestamp}.tar`
    const tempFiles: string[] = []
    const tempDirs: string[] = []

    try {
      const dbPath = await this.dumpDatabase()
      tempFiles.push(dbPath)

      const createdAt = new Date().toISOString()
      const packageDir = path.join(os.tmpdir(), `synapse-backup-package-${Date.now()}`)
      tempDirs.push(packageDir)
      fs.mkdirSync(packageDir, { recursive: true })

      fs.copyFileSync(dbPath, path.join(packageDir, "database.sql.gz"))
      await this.dumpPostgresGlobals(path.join(packageDir, "postgres-globals.sql"))
      await this.writeDriveCosManifest(path.join(packageDir, "drive-cos-manifest.json"))

      const restoreMarkdown = createRestoreMarkdown({ createdAt, filename })
      if (scanForSecretLikeText(restoreMarkdown)) {
        throw new Error("恢复说明包含疑似敏感信息。")
      }
      fs.writeFileSync(path.join(packageDir, "restore.md"), restoreMarkdown, "utf8")

      const manifest = createBackupManifest({
        createdAt,
        appVersion: process.env.npm_package_version ?? "0.1.0",
        migrationCount: await this.countAppliedMigrations(),
        backupBucket: this.bucket,
        backupRegion: this.region,
        driveBucket: this.env.driveCosBucket,
        driveRegion: this.env.driveCosRegion,
        contents: [
          await contentManifestItem(packageDir, "database.sql.gz"),
          await contentManifestItem(packageDir, "postgres-globals.sql"),
          await contentManifestItem(packageDir, "drive-cos-manifest.json"),
          await contentManifestItem(packageDir, "restore.md"),
        ],
      })
      await writeJsonFile(path.join(packageDir, "backup-manifest.json"), manifest)

      const archivePath = await this.packDirectory(packageDir)
      tempFiles.push(archivePath)

      await this.uploadToCos(archivePath, filename)

      const stat = fs.statSync(archivePath)
      const result: BackupResult = {
        filename,
        size: stat.size,
        uploadedAt: new Date().toISOString(),
        status: "success",
      }

      this.logger.info({ filename, size: stat.size }, "Backup completed successfully")

      await this.cleanExpiredBackups()

      return result
    } catch (error) {
      const message = formatAuditError(error)
      this.logger.error({ error: message }, "Backup failed")
      return {
        filename,
        size: 0,
        uploadedAt: new Date().toISOString(),
        status: "failed",
        error: message,
      }
    } finally {
      for (const file of tempFiles) {
        try {
          if (fs.existsSync(file)) fs.unlinkSync(file)
        } catch (error) {
          const message = formatAuditError(error)
          this.logger.warn?.({ error: message, file: formatAuditError(file) }, "Failed to remove backup temp file")
        }
      }
      for (const dir of tempDirs) {
        try {
          fs.rmSync(dir, { recursive: true, force: true })
        } catch (error) {
          const message = formatAuditError(error)
          this.logger.warn?.({ error: message, dir: formatAuditError(dir) }, "Failed to remove backup temp directory")
        }
      }
    }
  }

  async listBackups(): Promise<BackupItem[]> {
    if (!this.cos) return []

    try {
      const items: BackupItem[] = []
      let marker: string | undefined

      do {
        const page = await new Promise<{
          readonly Contents?: Array<{
            readonly Key: string
            readonly Size: string | number
            readonly LastModified: string
          }>
          readonly IsTruncated?: string | boolean
          readonly NextMarker?: string
        }>((resolve, reject) => {
          this.cos!.getBucket(
            {
              Bucket: this.bucket,
              Region: this.region,
              Prefix: this.prefix,
              ...(marker ? { Marker: marker } : {}),
            },
            (err, data) => {
              if (err) reject(err)
              else resolve(data)
            },
          )
        })

        for (const obj of page.Contents ?? []) {
          if (obj.Key === this.prefix) continue
          items.push({
            filename: obj.Key.replace(this.prefix, ""),
            size: Number(obj.Size),
            createdAt: obj.LastModified,
          })
        }

        marker = page.NextMarker
        if (page.IsTruncated !== true && page.IsTruncated !== "true") marker = undefined
      } while (marker)

      return items
    } catch (error) {
      const message = formatAuditError(error)
      this.logger.error({ error: message }, "Failed to list backups")
      throw error
    }
  }

  downloadBackup(filename: string): NodeJS.ReadableStream {
    const cos = this.getBackupCos()
    const key = buildBackupKey(this.prefix, filename)

    return cos.getObjectStream({
      Bucket: this.bucket,
      Region: this.region,
      Key: key,
    }) as NodeJS.ReadableStream
  }

  async checkBackupAvailable(filename: string): Promise<void> {
    const cos = this.getBackupCos()
    const key = buildBackupKey(this.prefix, filename)

    await new Promise<void>((resolve, reject) => {
      cos.headObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
        },
        (error) => {
          if (error) reject(error)
          else resolve()
        },
      )
    })
  }

  async deleteBackup(filename: string): Promise<void> {
    const cos = this.getBackupCos()
    const key = buildBackupKey(this.prefix, filename)

    await new Promise<void>((resolve, reject) => {
      cos.deleteObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
        },
        (err) => {
          if (err) reject(err)
          else resolve()
        },
      )
    })
  }

  private async dumpDatabase(): Promise<string> {
    const tmpDir = os.tmpdir()
    const dumpFile = path.join(tmpDir, `synapse-dump-${Date.now()}.sql`)
    const gzFile = `${dumpFile}.gz`
    let completed = false

    try {
      const pgDump = buildPgDumpOptions(this.env.databaseUrl, dumpFile)
      await execFileAsync("pg_dump", pgDump.args, { env: pgDump.env })

      const readStream = fs.createReadStream(dumpFile)
      const writeStream = fs.createWriteStream(gzFile)
      const gzip = createGzip()

      await pipeline(readStream, gzip, writeStream)

      completed = true
      return gzFile
    } finally {
      fs.rmSync(dumpFile, { force: true })
      if (!completed) {
        fs.rmSync(gzFile, { force: true })
      }
    }
  }

  private async dumpPostgresGlobals(filePath: string): Promise<void> {
    const pgDump = buildPgDumpOptions(this.env.databaseUrl, filePath)
    await execFileAsync("pg_dumpall", [
      "-h",
      pgDump.args[1],
      "-p",
      pgDump.args[3],
      "-U",
      pgDump.args[5],
      "--globals-only",
      "--no-role-passwords",
      "-f",
      filePath,
    ], { env: pgDump.env })
  }

  private createDriveCosClient(): COS {
    const CosClient = require("cos-nodejs-sdk-v5") as typeof COS
    return new CosClient({
      SecretId: this.env.driveCosSecretId!,
      SecretKey: this.env.driveCosSecretKey!,
    })
  }

  private async writeDriveCosManifest(filePath: string): Promise<void> {
    if (!isDriveCosConfigured(this.env)) {
      await writeJsonFile(filePath, {
        storage: "local",
        included: false,
        reason: "Drive COS is not configured.",
      })
      return
    }

    const driveCos = this.createDriveCosClient()
    const stream = fs.createWriteStream(filePath, { encoding: "utf8" })
    let marker: string | undefined
    let completed = false
    let firstObject = true

    try {
      await writeStreamChunk(stream, "{\n")
      await writeStreamChunk(stream, `  "bucket": ${JSON.stringify(this.env.driveCosBucket)},\n`)
      await writeStreamChunk(stream, `  "region": ${JSON.stringify(this.env.driveCosRegion)},\n`)
      await writeStreamChunk(stream, '  "prefix": "drive/",\n')
      await writeStreamChunk(stream, '  "objects": [\n')

      do {
        const page = await new Promise<{
          readonly Contents?: Array<{
            readonly Key?: string
            readonly Size?: string | number
            readonly ETag?: string
            readonly LastModified?: string
          }>
          readonly IsTruncated?: string | boolean
          readonly NextMarker?: string
        }>((resolve, reject) => {
          driveCos.getBucket(
            {
              Bucket: this.env.driveCosBucket!,
              Region: this.env.driveCosRegion!,
              Prefix: "drive/",
              ...(marker ? { Marker: marker } : {}),
            },
            (err, data) => {
              if (err) reject(err)
              else resolve(data)
            },
          )
        })

        for (const item of page.Contents ?? []) {
          if (!item.Key) continue
          const object = {
            key: item.Key,
            size: Number(item.Size ?? 0),
            ...(item.ETag ? { etag: item.ETag } : {}),
            ...(item.LastModified ? { lastModified: item.LastModified } : {}),
          }
          await writeStreamChunk(stream, `${firstObject ? "" : ",\n"}    ${JSON.stringify(object)}`)
          firstObject = false
        }

        marker = page.NextMarker
        if (page.IsTruncated !== true && page.IsTruncated !== "true") marker = undefined
      } while (marker)

      await writeStreamChunk(stream, "\n  ]\n}\n")
      stream.end()
      await finished(stream)
      completed = true
    } finally {
      if (!completed) {
        stream.destroy()
        fs.rmSync(filePath, { force: true })
      }
    }
  }

  private async packDirectory(directoryPath: string): Promise<string> {
    const archivePath = path.join(os.tmpdir(), `synapse-backup-${Date.now()}.tar`)
    let completed = false

    try {
      await tar.create(
        { gzip: false, file: archivePath, cwd: directoryPath },
        [
          "database.sql.gz",
          "postgres-globals.sql",
          "drive-cos-manifest.json",
          "backup-manifest.json",
          "restore.md",
        ],
      )
      completed = true
      return archivePath
    } finally {
      if (!completed) {
        fs.rmSync(archivePath, { force: true })
      }
    }
  }

  private async countAppliedMigrations(): Promise<number> {
    const pg = buildPgDumpOptions(this.env.databaseUrl, "")
    const result = await execFileAsync("psql", [
      "-h",
      pg.args[1],
      "-p",
      pg.args[3],
      "-U",
      pg.args[5],
      "-d",
      pg.args[7],
      "-Atc",
      "SELECT COUNT(*) FROM public._prisma_migrations WHERE finished_at IS NOT NULL;",
    ], { env: pg.env })
    const stdout = typeof result === "object" && result !== null && "stdout" in result
      ? result.stdout
      : result
    return Number(String(stdout).trim() || "0")
  }

  private async packFiles(dbPath: string): Promise<string> {
    const tmpDir = os.tmpdir()
    const workDir = path.join(tmpDir, `synapse-backup-${Date.now()}`)
    const archivePath = path.join(tmpDir, `synapse-backup-${Date.now()}.tar`)
    let completed = false

    try {
      fs.mkdirSync(workDir, { recursive: true })

      fs.copyFileSync(dbPath, path.join(workDir, "database.sql.gz"))

      await tar.create(
        { gzip: false, file: archivePath, cwd: workDir },
        ["database.sql.gz"],
      )

      completed = true
      return archivePath
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true })
      if (!completed) {
        fs.rmSync(archivePath, { force: true })
      }
    }
  }

  private async uploadToCos(filePath: string, filename: string): Promise<void> {
    const cos = this.getBackupCos()

    const body = fs.createReadStream(filePath)

    const uploadPromise = new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: `${this.prefix}${filename}`,
          Body: body,
        },
        (err) => {
          if (err) reject(err)
          else resolve()
        },
      )
    })

    try {
      await Promise.all([uploadPromise, finished(body)])
    } catch (error) {
      body.destroy()
      throw error
    }
  }

  private async cleanExpiredBackups(): Promise<void> {
    if (!this.cos) return

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    try {
      const items = await this.listBackups()
      const expired = items.filter(
        (item) => new Date(item.createdAt) < thirtyDaysAgo,
      )

      for (const item of expired) {
        try {
          await new Promise<void>((resolve, reject) => {
            this.cos!.deleteObject(
              {
                Bucket: this.bucket,
                Region: this.region,
                Key: `${this.prefix}${item.filename}`,
              },
              (err) => {
                if (err) reject(err)
                else resolve()
              },
            )
          })
          await this.recordBackupCleanupAudit({
            action: "backup.cleanup.delete",
            targetId: item.filename,
            detail: {
              filename: item.filename,
              createdAt: item.createdAt,
              size: item.size,
            },
          })
        } catch (error) {
          const auditError = formatAuditError(error)
          await this.recordBackupCleanupAudit({
            action: "backup.cleanup.failed",
            targetId: item.filename,
            detail: {
              filename: item.filename,
              createdAt: item.createdAt,
              size: item.size,
              error: auditError,
            },
          })
          this.logger.warn({ error: auditError, filename: item.filename }, "Failed to delete expired backup")
        }
      }

      if (expired.length > 0) {
        this.logger.info({ count: expired.length }, "Cleaned expired backups")
      }
    } catch (error) {
      const auditError = formatAuditError(error)
      await this.recordBackupCleanupAudit({
        action: "backup.cleanup.failed",
        targetId: "expired-scan",
        detail: { error: auditError },
      })
      this.logger.error({ error: auditError }, "Failed to clean expired backups")
    }
  }

  private getBackupCos(): COS {
    if (!isBackupCosConfigured(this.env) || !this.cos) {
      throw new ServiceUnavailableException("备份未配置。")
    }
    return this.cos
  }

  private async recordBackupCleanupAudit(input: {
    readonly action: "backup.cleanup.delete" | "backup.cleanup.failed"
    readonly targetId: string
    readonly detail: Record<string, unknown>
  }): Promise<void> {
    if (!this.auditLog) return
    try {
      await this.auditLog.record({
        adminEmail: "system",
        action: input.action,
        targetType: "backup",
        targetId: input.targetId,
        detail: input.detail,
        ipAddress: "system",
      })
    } catch (error) {
      const message = formatAuditError(error)
      this.logger.warn(
        { error: message, action: input.action, targetId: input.targetId },
        "Failed to record backup cleanup audit",
      )
    }
  }
}

function formatScheduledBackupAuditDetail(result: BackupResult): BackupResult {
  if (result.status !== "failed" || !result.error) return result
  return {
    ...result,
    error: formatAuditError(result.error),
  }
}
