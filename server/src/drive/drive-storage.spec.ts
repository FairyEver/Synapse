import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Readable } from "node:stream"
import { Test } from "@nestjs/testing"

const cosGetObjectUrlMock = vi.hoisted(() => vi.fn())
const cosConstructorMock = vi.hoisted(() => vi.fn(function MockCos() {
  return { getObjectUrl: cosGetObjectUrlMock }
}))

vi.mock("cos-nodejs-sdk-v5", () => ({
  default: cosConstructorMock,
}))

import { CosDriveStorage, DriveUploadTooLargeError, LOCAL_DRIVE_STORAGE_OPTIONS, LocalDriveStorage, shouldUseCosDriveStorage } from "./drive-storage"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.map((root) => rm(root, { force: true, recursive: true })))
  roots.length = 0
  cosGetObjectUrlMock.mockReset()
  cosConstructorMock.mockClear()
  vi.unstubAllEnvs()
})

describe("LocalDriveStorage", () => {
  it("can be constructed by Nest with explicit local storage options", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)

    const moduleRef = await Test.createTestingModule({
      providers: [
        LocalDriveStorage,
        { provide: LOCAL_DRIVE_STORAGE_OPTIONS, useValue: { publicAppUrl: "http://localhost:3000", root } },
      ],
    }).compile()

    expect(moduleRef.get(LocalDriveStorage)).toBeInstanceOf(LocalDriveStorage)
    await moduleRef.close()
  })

  it("uses the configured persistent local root when options omit a root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-env-"))
    roots.push(root)
    stubServerEnv({ SYNAPSE_DRIVE_LOCAL_ROOT: root })
    const storage = new LocalDriveStorage()

    await storage.putObject({ key: "drive/item-1", body: Buffer.from("hello"), contentType: "text/plain" })

    const objectName = Buffer.from("drive/item-1", "utf8").toString("base64url")
    await expect(readFile(path.join(root, ".objects", objectName), "utf8")).resolves.toBe("hello")
  })

  it("stores uploaded objects on local disk and reports their size", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await storage.acceptUpload(token, Readable.from(["hello"]))

    await expect(streamToText((await storage.getObjectStream({ key: "drive/item-1" })).stream)).resolves.toBe("hello")
    await expect(storage.headObject("drive/item-1")).resolves.toMatchObject({ key: "drive/item-1", size: 5n })
  })

  it("keeps putObject content types after storage restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const firstStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    await firstStorage.putObject({ key: "drive/item-1", body: Buffer.from("hello"), contentType: "text/plain" })

    const restartedStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const object = await restartedStorage.getObjectStream({ key: "drive/item-1" })

    expect(object.contentType).toBe("text/plain")
    await expect(streamToText(object.stream)).resolves.toBe("hello")
  })

  it("recovers local upload tokens from disk after storage restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const firstStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await firstStorage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    const restartedStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    await restartedStorage.acceptUpload(token, Readable.from(["hello"]))

    await expect(streamToText((await restartedStorage.getObjectStream({ key: "drive/item-1" })).stream)).resolves.toBe("hello")
    await expect(restartedStorage.acceptUpload(token, Readable.from(["again"]))).rejects.toThrow("Drive storage token expired.")
  })

  it("keeps accepted upload content types after storage restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const firstStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const upload = await firstStorage.createUploadInstruction({ key: "drive/item-1", contentType: "image/png", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await firstStorage.acceptUpload(token, Readable.from(["hello"]))

    const restartedStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const object = await restartedStorage.getObjectStream({ key: "drive/item-1" })

    expect(object.contentType).toBe("image/png")
    await expect(streamToText(object.stream)).resolves.toBe("hello")
  })

  it("rejects local uploads when content length exceeds the expected size", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")
    const stream = Readable.from(["too-large"]) as Readable & { headers: Record<string, string> }
    stream.headers = { "content-length": "9" }

    await expect(storage.acceptUpload(token, stream)).rejects.toBeInstanceOf(DriveUploadTooLargeError)
    await expect(storage.headObject("drive/item-1")).resolves.toBeNull()
  })

  it("stops chunked local uploads after they exceed the expected size", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await expect(storage.acceptUpload(token, Readable.from(["hello", "world"]))).rejects.toBeInstanceOf(DriveUploadTooLargeError)
    await expect(storage.headObject("drive/item-1")).resolves.toBeNull()
  })

  it("keeps local upload tokens reusable after failed writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await expect(storage.acceptUpload(token, Readable.from(["hello", "world"]))).rejects.toBeInstanceOf(DriveUploadTooLargeError)
    await storage.acceptUpload(token, Readable.from(["hello"]))

    await expect(streamToText((await storage.getObjectStream({ key: "drive/item-1" })).stream)).resolves.toBe("hello")
  })

  it("consumes local upload tokens after successful writes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").pop()
    if (!token) throw new Error("missing upload token")

    await storage.acceptUpload(token, Readable.from(["hello"]))

    await expect(storage.acceptUpload(token, Readable.from(["again"]))).rejects.toThrow("Drive storage token expired.")
    await expect(streamToText((await storage.getObjectStream({ key: "drive/item-1" })).stream)).resolves.toBe("hello")
  })

  it("copies and streams local drive objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/html", expectedSize: 14n })
    const token = upload.url.split("/").at(-1)
    if (!token) throw new Error("missing upload token")

    await storage.acceptUpload(token, Readable.from("<h1>Hello</h1>"))
    await storage.copyObject({ fromKey: "drive/item-1", toKey: "drive-copies/copy-1/index.html", contentType: "text/html" })
    const object = await storage.getObjectStream({ key: "drive-copies/copy-1/index.html" })

    expect(object.size).toBe(14n)
    expect(object.contentType).toBe("text/html")
    await expect(streamToText(object.stream)).resolves.toBe("<h1>Hello</h1>")
  })

  it("keeps copied object content types after storage restart", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const firstStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    await firstStorage.putObject({ key: "drive/source", body: Buffer.from("hello"), contentType: "text/plain" })
    await firstStorage.copyObject({ fromKey: "drive/source", toKey: "drive/inherited" })
    await firstStorage.copyObject({ fromKey: "drive/source", toKey: "drive/overridden", contentType: "text/markdown" })

    const restartedStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })

    await expect(restartedStorage.getObjectStream({ key: "drive/inherited" }))
      .resolves.toMatchObject({ contentType: "text/plain" })
    await expect(restartedStorage.getObjectStream({ key: "drive/overridden" }))
      .resolves.toMatchObject({ contentType: "text/markdown" })
  })

  it("copies item objects into nested version keys without filesystem path collisions", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const token = upload.url.split("/").at(-1)
    if (!token) throw new Error("missing upload token")

    await storage.acceptUpload(token, Readable.from("hello"))
    await storage.copyObject({ fromKey: "drive/item-1", toKey: "drive/item-1/versions/version-1", contentType: "text/plain" })

    await expect(streamToText((await storage.getObjectStream({ key: "drive/item-1/versions/version-1" })).stream)).resolves.toBe("hello")
  })

  it("deletes encoded item objects without failing on legacy version directories", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    await storage.putObject({ key: "drive/item-1", body: Buffer.from("current"), contentType: "text/plain" })
    await mkdir(path.join(root, "drive", "item-1", "versions"), { recursive: true })
    await writeFile(path.join(root, "drive", "item-1", "versions", "version-1"), "legacy-version")

    await expect(storage.deleteObject("drive/item-1")).resolves.toBeUndefined()
    await expect(storage.headObject("drive/item-1")).resolves.toBeNull()
    await expect(streamToText((await storage.getObjectStream({ key: "drive/item-1/versions/version-1" })).stream))
      .resolves.toBe("legacy-version")
  })

  it("removes persisted content types when deleting local objects", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const firstStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    await firstStorage.putObject({ key: "drive/item-1", body: Buffer.from("hello"), contentType: "text/plain" })
    await firstStorage.deleteObject("drive/item-1")

    const restartedStorage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    await restartedStorage.putObject({ key: "drive/item-1", body: Buffer.from("again"), contentType: null })

    const object = await restartedStorage.getObjectStream({ key: "drive/item-1" })
    expect(object.contentType).toBeNull()
    await expect(streamToText(object.stream)).resolves.toBe("again")
  })

  it("continues reading legacy local objects stored directly by key path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    await mkdir(path.join(root, "drive"), { recursive: true })
    await writeFile(path.join(root, "drive/item-legacy"), "legacy")

    await expect(storage.headObject("drive/item-legacy")).resolves.toMatchObject({ key: "drive/item-legacy", size: 6n })
    const object = await storage.getObjectStream({ key: "drive/item-legacy" })
    expect(object.contentType).toBeNull()
    await expect(streamToText(object.stream)).resolves.toBe("legacy")
  })

  it("allows local download tokens to be resolved multiple times before expiry", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const upload = await storage.createUploadInstruction({ key: "drive/item-1", contentType: "text/plain", expectedSize: 5n })
    const uploadToken = upload.url.split("/").at(-1)
    if (!uploadToken) throw new Error("missing upload token")
    await storage.acceptUpload(uploadToken, Readable.from("hello"))
    const download = await storage.createDownloadUrl({ key: "drive/item-1", filename: "brief.txt" })
    const downloadToken = download.url.split("/").at(-1)
    if (!downloadToken) throw new Error("missing download token")

    const first = storage.resolveDownload(downloadToken)
    const second = storage.resolveDownload(downloadToken)

    expect(first.filename).toBe("brief.txt")
    expect(second.filename).toBe("brief.txt")
    await expect(streamToText(first.stream)).resolves.toBe("hello")
    await expect(streamToText(second.stream)).resolves.toBe("hello")
  })

  it("cleans expired unused local tokens before creating new tokens", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-14T00:00:00.000Z"))
    const root = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-"))
    roots.push(root)
    const storage = new LocalDriveStorage({ publicAppUrl: "http://localhost:3000", root })
    const tokenState = storage as unknown as {
      readonly uploadTokens: Map<string, unknown>
      readonly downloadTokens: Map<string, unknown>
    }

    try {
      await storage.createUploadInstruction({ key: "drive/unused-upload", contentType: "text/plain", expectedSize: 1n })
      await storage.createDownloadUrl({ key: "drive/unused-download", filename: "unused.txt" })
      expect(tokenState.uploadTokens.size).toBe(1)
      expect(tokenState.downloadTokens.size).toBe(1)

      vi.setSystemTime(new Date("2026-06-14T00:16:00.000Z"))
      await storage.createUploadInstruction({ key: "drive/new-upload", contentType: "text/plain", expectedSize: 1n })

      expect(tokenState.uploadTokens.size).toBe(1)
      expect(tokenState.downloadTokens.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

async function streamToText(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
  }
  return Buffer.concat(chunks).toString("utf8")
}

describe("shouldUseCosDriveStorage", () => {
  const baseEnv = {
    DATABASE_URL: "postgresql://synapse:secret@localhost:5432/synapse",
    ADMIN_EMAIL: "admin@synapse.com",
    ADMIN_PASSWORD: "admin-password-123",
    ADMIN_JWT_SECRET: "a".repeat(32),
    USER_ACCESS_JWT_SECRET: "b".repeat(32),
    APP_PUBLIC_URL: "http://localhost:3000",
  }

  it("uses COS storage only when Drive COS is configured", () => {
    expect(shouldUseCosDriveStorage({
      ...baseEnv,
      DRIVE_COS_SECRET_ID: "secret-id",
      DRIVE_COS_SECRET_KEY: "secret-key",
      DRIVE_COS_BUCKET: "bucket",
      DRIVE_COS_REGION: "ap-beijing",
    })).toBe(true)
  })

  it("does not use Drive COS storage for Backup-only or legacy COS settings", () => {
    expect(shouldUseCosDriveStorage({
      ...baseEnv,
      BACKUP_COS_SECRET_ID: "secret-id",
      BACKUP_COS_SECRET_KEY: "secret-key",
      BACKUP_COS_BUCKET: "backup-bucket",
      BACKUP_COS_REGION: "ap-guangzhou",
      COS_SECRET_ID: "legacy-secret-id",
      COS_SECRET_KEY: "legacy-secret-key",
      COS_BUCKET: "legacy-bucket",
      COS_REGION: "ap-shanghai",
    })).toBe(false)
  })
})

describe("CosDriveStorage", () => {
  it("requests download urls with the original filename in content disposition", async () => {
    stubServerEnv({
      DRIVE_COS_SECRET_ID: "secret-id",
      DRIVE_COS_SECRET_KEY: "secret-key",
      DRIVE_COS_BUCKET: "drive-bucket",
      DRIVE_COS_REGION: "ap-shanghai",
    })
    cosGetObjectUrlMock.mockImplementation((_params: unknown, callback: (error: unknown, data: { readonly Url: string }) => void) => {
      callback(null, { Url: "https://cos.example/signed-download" })
    })

    const storage = new CosDriveStorage()
    await expect(storage.createDownloadUrl({
      key: "drive/file-1",
      filename: "工作流循环机制调研与头脑风暴.md",
    })).resolves.toMatchObject({ url: "https://cos.example/signed-download" })

    expect(cosGetObjectUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        Bucket: "drive-bucket",
        Region: "ap-shanghai",
        Key: "drive/file-1",
        Method: "get",
        Query: {
          "response-content-disposition": "attachment; filename=\"______________.md\"; filename*=UTF-8''%E5%B7%A5%E4%BD%9C%E6%B5%81%E5%BE%AA%E7%8E%AF%E6%9C%BA%E5%88%B6%E8%B0%83%E7%A0%94%E4%B8%8E%E5%A4%B4%E8%84%91%E9%A3%8E%E6%9A%B4.md",
        },
      }),
      expect.any(Function),
    )
  })
})

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
