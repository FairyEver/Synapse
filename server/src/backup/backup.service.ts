import { BadRequestException, Injectable, ServiceUnavailableException } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { execFile } from "node:child_process"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import * as tar from "tar"
import type COS from "cos-nodejs-sdk-v5"
import { isBackupConfigured, loadEnv, type ServerEnv } from "../config/env"

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
  lastModified: string
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
      "-f",
      dumpFile,
    ],
    env,
  }
}

@Injectable()
export class BackupService {
  private readonly env: ServerEnv
  private readonly cos: COS | null = null
  private readonly bucket: string
  private readonly region: string
  private readonly prefix = "backups/"

  constructor(private readonly logger: PinoLogger) {
    this.env = loadEnv(process.env)
    this.bucket = this.env.cosBucket ?? ""
    this.region = this.env.cosRegion ?? ""

    if (isBackupConfigured(this.env)) {
      const CosClient = require("cos-nodejs-sdk-v5") as typeof COS
      this.cos = new CosClient({
        SecretId: this.env.cosSecretId!,
        SecretKey: this.env.cosSecretKey!,
      })
    }
  }

  @Cron("0 3 * * *")
  async scheduledBackup(): Promise<void> {
    if (!isBackupConfigured(this.env)) {
      this.logger.info("Backup not configured, skipping scheduled backup")
      return
    }
    await this.performBackup()
  }

  async performBackup(): Promise<BackupResult> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
    const filename = `synapse-backup-${timestamp}.tar.gz`
    const tempFiles: string[] = []

    try {
      const dbPath = await this.dumpDatabase()
      tempFiles.push(dbPath)

      const archivePath = await this.packFiles(dbPath)
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
      const message = error instanceof Error ? error.message : String(error)
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
        } catch {
          // ignore cleanup errors
        }
      }
    }
  }

  async listBackups(): Promise<BackupItem[]> {
    if (!this.cos) return []

    try {
      return await new Promise((resolve, reject) => {
        this.cos!.getBucket(
          {
            Bucket: this.bucket,
            Region: this.region,
            Prefix: this.prefix,
          },
          (err, data) => {
            if (err) {
              reject(err)
              return
            }
            const items: BackupItem[] = (data.Contents ?? [])
              .filter((obj) => obj.Key !== this.prefix)
              .map((obj) => ({
                filename: obj.Key.replace(this.prefix, ""),
                size: Number(obj.Size),
                lastModified: obj.LastModified,
              }))
            resolve(items)
          },
        )
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error({ error: message }, "Failed to list backups")
      return []
    }
  }

  async downloadBackup(filename: string): Promise<Buffer> {
    if (!this.cos) throw new ServiceUnavailableException("备份未配置。")
    const key = buildBackupKey(this.prefix, filename)

    const body = await new Promise<unknown>((resolve, reject) => {
      this.cos!.getObject(
        {
          Bucket: this.bucket,
          Region: this.region,
          Key: key,
        },
        (err, data) => {
          if (err) {
            reject(err)
            return
          }
          resolve(data.Body)
        },
      )
    })

    if (Buffer.isBuffer(body)) return body
    if (body instanceof Uint8Array) return Buffer.from(body)
    if (typeof body === "string") return Buffer.from(body)
    throw new Error("备份文件内容无效。")
  }

  async deleteBackup(filename: string): Promise<void> {
    if (!this.cos) throw new ServiceUnavailableException("备份未配置。")
    const key = buildBackupKey(this.prefix, filename)

    await new Promise<void>((resolve, reject) => {
      this.cos!.deleteObject(
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

    const pgDump = buildPgDumpOptions(this.env.databaseUrl, dumpFile)
    await execFileAsync("pg_dump", pgDump.args, { env: pgDump.env })

    const readStream = fs.createReadStream(dumpFile)
    const writeStream = fs.createWriteStream(gzFile)
    const gzip = createGzip()

    await pipeline(readStream, gzip, writeStream)

    fs.unlinkSync(dumpFile)

    return gzFile
  }

  private async packFiles(dbPath: string): Promise<string> {
    const tmpDir = os.tmpdir()
    const workDir = path.join(tmpDir, `synapse-backup-${Date.now()}`)
    const archivePath = path.join(tmpDir, `synapse-backup-${Date.now()}.tar.gz`)

    fs.mkdirSync(workDir, { recursive: true })

    fs.copyFileSync(dbPath, path.join(workDir, "database.sql.gz"))

    await tar.create(
      { gzip: true, file: archivePath, cwd: workDir },
      ["database.sql.gz"],
    )

    fs.rmSync(workDir, { recursive: true, force: true })

    return archivePath
  }

  private async uploadToCos(filePath: string, filename: string): Promise<void> {
    if (!this.cos) throw new Error("COS client not initialized")

    const body = fs.readFileSync(filePath)

    return new Promise((resolve, reject) => {
      this.cos!.putObject(
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
  }

  private async cleanExpiredBackups(): Promise<void> {
    if (!this.cos) return

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)

    try {
      const items = await this.listBackups()
      const expired = items.filter(
        (item) => new Date(item.lastModified) < thirtyDaysAgo,
      )

      for (const item of expired) {
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
      }

      if (expired.length > 0) {
        this.logger.info({ count: expired.length }, "Cleaned expired backups")
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.logger.error({ error: message }, "Failed to clean expired backups")
    }
  }
}
