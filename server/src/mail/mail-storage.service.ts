import { Injectable } from "@nestjs/common"
import COS from "cos-nodejs-sdk-v5"
import { createReadStream } from "node:fs"
import { mkdir, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { loadEnv } from "../config/env"

/** Mail objects have their own lifecycle and prefix; they never inherit Drive sharing. */
@Injectable()
export class MailStorageService {
  private readonly env = loadEnv(process.env)
  private readonly root = this.env.driveLocalRoot ?? path.join(os.tmpdir(), "synapse-mail-storage")
  private readonly bucket = this.env.mailCosBucket ?? this.env.driveCosBucket
  private readonly region = this.env.mailCosRegion ?? this.env.driveCosRegion
  private readonly cos = (this.env.mailCosSecretId && this.env.mailCosSecretKey) || (this.env.driveCosSecretId && this.env.driveCosSecretKey)
    ? new COS({ SecretId: this.env.mailCosSecretId ?? this.env.driveCosSecretId!, SecretKey: this.env.mailCosSecretKey ?? this.env.driveCosSecretKey! })
    : null

  async put(key: string, body: Buffer, mimeType?: string | null): Promise<void> {
    if (this.cos) {
      await new Promise<void>((resolve, reject) => {
        this.cos!.putObject({
          Bucket: this.bucket!, Region: this.region!, Key: key,
          Body: body, ContentType: mimeType ?? undefined,
        }, (error) => error ? reject(error) : resolve())
      })
      return
    }
    const file = this.localPath(key)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, body)
  }

  async open(key: string): Promise<Readable> {
    if (this.cos) {
      return this.cos.getObjectStream({ Bucket: this.bucket!, Region: this.region!, Key: key }) as Readable
    }
    // Fail before sending response headers when a local object has disappeared.
    await stat(this.localPath(key))
    return createReadStream(this.localPath(key))
  }

  async copy(sourceKey: string, targetKey: string, mimeType?: string | null): Promise<void> {
    const chunks: Buffer[] = []
    for await (const chunk of await this.open(sourceKey)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    await this.put(targetKey, Buffer.concat(chunks), mimeType)
  }

  async delete(key: string): Promise<void> {
    if (this.cos) {
      await new Promise<void>((resolve, reject) => {
        this.cos!.deleteObject({ Bucket: this.bucket!, Region: this.region!, Key: key }, (error) => error ? reject(error) : resolve())
      })
      return
    }
    await rm(this.localPath(key), { force: true })
  }

  private localPath(key: string): string {
    if (!/^mail\/attachments\/[a-z0-9-]+$/u.test(key)) throw new Error("Invalid mail storage key")
    return path.join(this.root, key)
  }
}
