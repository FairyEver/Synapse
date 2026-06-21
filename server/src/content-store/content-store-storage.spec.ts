import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { afterEach, describe, expect, it, vi } from "vitest"

import { LocalContentStoreStorage, shouldUseCosContentStoreStorage } from "./content-store-storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
  roots.length = 0
  vi.unstubAllEnvs()
})

describe("LocalContentStoreStorage", () => {
  it("uses the configured persistent local root when options omit a root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-store-local-env-"))
    roots.push(root)
    stubServerEnv({ SYNAPSE_CONTENT_STORE_LOCAL_ROOT: root })
    const storage = new LocalContentStoreStorage()

    await storage.putObject({
      key: "content-store/drafts/user-1/draft-1/file.txt",
      body: Buffer.from("hello"),
      contentType: "text/plain",
    })

    await expect(readFile(path.join(root, "content-store/drafts/user-1/draft-1/file.txt"), "utf8")).resolves.toBe("hello")
  })

  it("writes and reads objects under the configured root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-store-local-"))
    roots.push(root)
    const storage = new LocalContentStoreStorage({ root })

    await storage.putObject({
      key: "content-store/drafts/user-1/draft-1/file.txt",
      body: Buffer.from("hello"),
      contentType: "text/plain",
    })

    await expect(readFile(path.join(root, "content-store/drafts/user-1/draft-1/file.txt"), "utf8")).resolves.toBe("hello")
    const object = await storage.getObjectStream({ key: "content-store/drafts/user-1/draft-1/file.txt" })

    expect(object.size).toBe(5n)
    expect(object.contentType).toBe("text/plain")
    await expect(streamToText(object.stream)).resolves.toBe("hello")
  })

  it("rejects path traversal keys", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-store-local-"))
    roots.push(root)
    const storage = new LocalContentStoreStorage({ root })

    await expect(storage.putObject({ key: "../escape.txt", body: Buffer.from("escape") })).rejects.toThrow(
      "Invalid content store storage key.",
    )
  })

  it("deletes objects and returns null from headObject", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-content-store-local-"))
    roots.push(root)
    const storage = new LocalContentStoreStorage({ root })

    await storage.putObject({ key: "content-store/packages/content-1/version-1.zip", body: Readable.from(["zip"]) })
    await expect(storage.headObject("content-store/packages/content-1/version-1.zip")).resolves.toMatchObject({
      key: "content-store/packages/content-1/version-1.zip",
      size: 3n,
    })

    await storage.deleteObject("content-store/packages/content-1/version-1.zip")

    await expect(storage.headObject("content-store/packages/content-1/version-1.zip")).resolves.toBeNull()
  })
})

describe("shouldUseCosContentStoreStorage", () => {
  const baseEnv = {
    DATABASE_URL: "postgresql://synapse:secret@localhost:5432/synapse",
    ADMIN_EMAIL: "admin@synapse.com",
    ADMIN_PASSWORD: "admin-password-123",
    ADMIN_JWT_SECRET: "a".repeat(32),
    USER_ACCESS_JWT_SECRET: "b".repeat(32),
    APP_PUBLIC_URL: "http://localhost:3000",
  }

  it("uses COS storage only when Content Store COS is configured", () => {
    expect(shouldUseCosContentStoreStorage({
      ...baseEnv,
      CONTENT_STORE_COS_SECRET_ID: "secret-id",
      CONTENT_STORE_COS_SECRET_KEY: "secret-key",
      CONTENT_STORE_COS_BUCKET: "bucket",
      CONTENT_STORE_COS_REGION: "ap-beijing",
    })).toBe(true)
  })

  it("does not use COS storage for Drive-only settings", () => {
    expect(shouldUseCosContentStoreStorage({
      ...baseEnv,
      DRIVE_COS_SECRET_ID: "secret-id",
      DRIVE_COS_SECRET_KEY: "secret-key",
      DRIVE_COS_BUCKET: "drive-bucket",
      DRIVE_COS_REGION: "ap-guangzhou",
    })).toBe(false)
  })
})

async function streamToText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

function stubServerEnv(overrides: NodeJS.ProcessEnv = {}): void {
  vi.stubEnv("DATABASE_URL", "postgresql://synapse:secret@localhost:5432/synapse")
  vi.stubEnv("ADMIN_EMAIL", "admin@synapse.com")
  vi.stubEnv("ADMIN_PASSWORD", "admin-password-123")
  vi.stubEnv("ADMIN_JWT_SECRET", "a".repeat(32))
  vi.stubEnv("USER_ACCESS_JWT_SECRET", "b".repeat(32))
  for (const [key, value] of Object.entries(overrides)) {
    if (value !== undefined) vi.stubEnv(key, value)
  }
}
