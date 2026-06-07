import { Injectable } from "@nestjs/common"
import COS from "cos-nodejs-sdk-v5"
import { loadEnv } from "../config/env"
import { driveDownloadUrlTtlSeconds, driveUploadUrlTtlSeconds } from "./drive.constants"

export interface DriveStorageObjectInfo {
  readonly key: string
  readonly size: bigint
  readonly etag?: string
}

export interface DriveUploadInstruction {
  readonly method: "PUT"
  readonly url: string
  readonly expiresAt: Date
  readonly headers: Record<string, string>
}

export interface DriveStoragePort {
  createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction>
  createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }>
  headObject(key: string): Promise<DriveStorageObjectInfo | null>
  deleteObject(key: string): Promise<void>
}

@Injectable()
export class CosDriveStorage implements DriveStoragePort {
  private client: {
    readonly cos: COS
    readonly bucket: string
    readonly region: string
  } | null = null

  async createUploadInstruction(input: { readonly key: string; readonly contentType?: string }): Promise<DriveUploadInstruction> {
    const expiresAt = new Date(Date.now() + driveUploadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "put", expires: driveUploadUrlTtlSeconds })
    return {
      method: "PUT",
      url,
      expiresAt,
      headers: input.contentType ? { "Content-Type": input.contentType } : {},
    }
  }

  async createDownloadUrl(input: { readonly key: string; readonly filename: string }): Promise<{ readonly url: string; readonly expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + driveDownloadUrlTtlSeconds * 1000)
    const url = await this.getSignedUrl({ key: input.key, method: "get", expires: driveDownloadUrlTtlSeconds })
    return { url, expiresAt }
  }

  async headObject(key: string): Promise<DriveStorageObjectInfo | null> {
    try {
      const result = await this.headObjectRaw(key)
      const sizeValue = result.headers?.["content-length"]
      return {
        key,
        size: BigInt(typeof sizeValue === "string" ? sizeValue : "0"),
        etag: typeof result.headers?.etag === "string" ? result.headers.etag : undefined,
      }
    } catch (error) {
      if (isCosNotFound(error)) return null
      throw error
    }
  }

  async deleteObject(key: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const client = this.getClient()
      client.cos.deleteObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  private getSignedUrl(input: { readonly key: string; readonly method: "put" | "get"; readonly expires: number }): Promise<string> {
    return new Promise((resolve, reject) => {
      const client = this.getClient()
      client.cos.getObjectUrl({
        Bucket: client.bucket,
        Region: client.region,
        Key: input.key,
        Sign: true,
        Method: input.method,
        Expires: input.expires,
      }, (error, data) => {
        if (error) reject(error)
        else resolve(data.Url)
      })
    })
  }

  private headObjectRaw(key: string): Promise<{ readonly headers?: Record<string, string> }> {
    return new Promise((resolve, reject) => {
      const client = this.getClient()
      client.cos.headObject({ Bucket: client.bucket, Region: client.region, Key: key }, (error, data) => {
        if (error) reject(error)
        else resolve(data)
      })
    })
  }

  private requireConfig(value: string | undefined, key: string): string {
    if (!value) throw new Error(`${key} is required for Synapse Drive storage.`)
    return value
  }

  private getClient(): { readonly cos: COS; readonly bucket: string; readonly region: string } {
    if (this.client) return this.client
    const env = loadEnv(process.env)
    this.client = {
      cos: new COS({
        SecretId: this.requireConfig(env.cosSecretId, "COS_SECRET_ID"),
        SecretKey: this.requireConfig(env.cosSecretKey, "COS_SECRET_KEY"),
      }),
      bucket: this.requireConfig(env.cosBucket, "COS_BUCKET"),
      region: this.requireConfig(env.cosRegion, "COS_REGION"),
    }
    return this.client
  }
}

function isCosNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && ("statusCode" in error)
    && (error as { readonly statusCode?: unknown }).statusCode === 404
}
