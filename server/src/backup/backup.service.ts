import { Injectable } from "@nestjs/common"
import { Cron } from "@nestjs/schedule"
import { PinoLogger } from "nestjs-pino"
import { execFile } from "node:child_process"
import * as crypto from "node:crypto"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { promisify } from "node:util"
import { pipeline } from "node:stream/promises"
import { createGzip } from "node:zlib"
import * as tar from "tar"
import COS from "cos-nodejs-sdk-v5"
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
      this.cos = new COS({
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

      const keysBuffer = this.encryptKeys()

      const archivePath = await this.packFiles(dbPath, keysBuffer)
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

    return new Promise((resolve, reject) => {
      this.cos!.getBucket(
        {
          Bucket: this.bucket,
          Region: this.region,
          Prefix: this.prefix,
        },
        (err, data) => {
          if (err) {
            this.logger.error({ error: err.message }, "Failed to list backups")
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
  }

  private async dumpDatabase(): Promise<string> {
    const tmpDir = os.tmpdir()
    const dumpFile = path.join(tmpDir, `synapse-dump-${Date.now()}.sql`)
    const gzFile = `${dumpFile}.gz`

    await execFileAsync("pg_dump", [this.env.databaseUrl, "-f", dumpFile])

    const readStream = fs.createReadStream(dumpFile)
    const writeStream = fs.createWriteStream(gzFile)
    const gzip = createGzip()

    await pipeline(readStream, gzip, writeStream)

    fs.unlinkSync(dumpFile)

    return gzFile
  }

  private encryptKeys(): Buffer {
    const payload = JSON.stringify({
      privateKey: this.env.licensePrivateKey,
      publicKey: this.env.licensePublicKey,
      keyId: this.env.licenseKeyId,
    })

    const key = Buffer.from(this.env.backupEncryptKey!, "hex")
    const iv = crypto.randomBytes(12)
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

    const encrypted = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()])
    const authTag = cipher.getAuthTag()

    return Buffer.concat([iv, authTag, encrypted])
  }

  private async packFiles(dbPath: string, keysBuffer: Buffer): Promise<string> {
    const tmpDir = os.tmpdir()
    const workDir = path.join(tmpDir, `synapse-backup-${Date.now()}`)
    const archivePath = path.join(tmpDir, `synapse-backup-${Date.now()}.tar.gz`)

    fs.mkdirSync(workDir, { recursive: true })

    fs.copyFileSync(dbPath, path.join(workDir, "database.sql.gz"))
    fs.writeFileSync(path.join(workDir, "keys.enc"), keysBuffer)

    await tar.create(
      { gzip: true, file: archivePath, cwd: workDir },
      ["database.sql.gz", "keys.enc"],
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
