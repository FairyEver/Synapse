import { mkdir, mkdtemp, readFile, readdir, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const accountLogger = vi.hoisted(() => {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
})

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => path.join(os.tmpdir(), `synapse-account-${name}`),
    getAppPath: () => path.join(os.tmpdir(), "synapse-account-app"),
    getName: () => "synapse-test",
    getVersion: () => "0.0.0-test",
    isPackaged: false,
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (plaintext: string) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
  shell: {
    openExternal: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../log-store", () => ({
  createMainLogger: () => accountLogger,
}))

import {
  EncryptedJsonNamespace,
  type SafeStorage,
} from "../../runtime/data-repo/backends/encrypted-json"
import type { SynapseAccountProfile } from "../../../src/types/account"
import { DRIVE_MAX_FILE_BYTES, type DashboardWebhookDto, type DriveDocumentImageImportResult, type DriveDocumentImageSourcesDto, type DriveItemDto, type DrivePublicAssetDto, type DriveSiteDto, type DriveUploadPrepareResult } from "@synapse/shared"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../../generated/deployment-config.generated"
import { AccountService } from "../account-service"

type PersistedAccountForTest = Record<string, unknown> & {
  refreshToken?: string
  accessTokenExpiresAt?: string
  lastProfile?: SynapseAccountProfile
  activeAttempt?: {
    state: string
    codeVerifier: string
    apiBaseUrl: string
    createdAt: string
    expiresAt: string
  }
}

function makeFakeSafeStorage(available = true): SafeStorage {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plaintext) => Buffer.from(plaintext, "utf8"),
    decryptString: (cipher) => cipher.toString("utf8"),
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function textResponse(body: string, status = 500): Response {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  })
}

function httpError(message: string, status = 400): Error & { readonly status: number } {
  return Object.assign(new Error(message), { status })
}

function failingDownloadResponse(): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("partial"))
      controller.error(new Error("download interrupted"))
    },
  })
  return new Response(body)
}

const storedProfile: SynapseAccountProfile = {
  user: { id: "u1", email: "u@example.com", displayName: null, status: "active" },
  teams: [],
  syncedAt: "2026-05-28T00:00:00.000Z",
}

const expectedPublicAppUrl = SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
const expectedApiBaseUrl = SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.apiBaseUrl
const expectedApiMode = new URL(expectedApiBaseUrl).hostname === "localhost" ? "development" : "production"

function expectedApiUrl(path: string): string {
  return `${expectedApiBaseUrl}${path}`
}

function webhookFixture(id: string): DashboardWebhookDto {
  return {
    id,
    publicId: `wh_${id}`,
    name: `Webhook ${id}`,
    enabled: true,
    url: null,
    maskedUrl: `https://synapse.test/webhooks/wh_${id}/***`,
    createdAt: "2026-06-06T10:00:00.000Z",
    updatedAt: "2026-06-06T10:00:00.000Z",
  }
}

async function createTestAccountService(input: {
  fetch?: typeof fetch
  isPackaged?: boolean
  safeStorage?: SafeStorage
} = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-account-test-"))
  const namespace = new EncryptedJsonNamespace<PersistedAccountForTest>({
    name: "core.account",
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(dir, "core.account.bin"),
    safeStorage: input.safeStorage ?? makeFakeSafeStorage(),
  })
  const openExternal = vi.fn().mockResolvedValue(undefined)
  const service = new AccountService({
    namespace,
    fetch: input.fetch ?? vi.fn(),
    openExternal,
    isPackaged: input.isPackaged ?? false,
  })
  return { namespace, openExternal, service }
}

describe("AccountService", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    accountLogger.child.mockReturnValue(accountLogger)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("starts login by persisting an attempt and opening the browser", async () => {
    const { namespace, openExternal, service } = await createTestAccountService()
    const result = await service.startLogin()

    expect(result.state.status).toBe("authenticating")
    const loginUrl = new URL(result.loginUrl)
    expect(loginUrl.pathname).toBe("/console/auth/desktop")
    expect(loginUrl.searchParams.get("client_id")).toBe("synapse-desktop")
    expect(loginUrl.searchParams.get("redirect_uri")).toBe("synapse://auth/desktop/callback")
    expect(loginUrl.searchParams.get("response_type")).toBe("code")
    expect(loginUrl.searchParams.get("state")).toBeTruthy()
    expect(loginUrl.searchParams.get("code_challenge")).toBeTruthy()
    expect(loginUrl.searchParams.get("code_challenge_method")).toBe("S256")
    expect(openExternal).toHaveBeenCalledWith(result.loginUrl)
    expect(await namespace.getSingleton()).toMatchObject({
      activeAttempt: {
        state: expect.any(String),
        codeVerifier: expect.any(String),
        apiBaseUrl: expectedApiBaseUrl,
      },
    })
  })

  it("uploads prepared drive files through the injected fetch implementation", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 200 }))
    const { service } = await createTestAccountService({ fetch: fetch as typeof globalThis.fetch })
    const body = new TextEncoder().encode("hello").buffer

    await expect(service.uploadDrivePreparedFile({
      body,
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
      url: "http://localhost:3000/api/drive/local-upload/token",
    })).resolves.toEqual({ ok: true })

    expect(fetch).toHaveBeenCalledWith("http://localhost:3000/api/drive/local-upload/token", expect.objectContaining({
      body: Buffer.from(body),
      headers: { "Content-Type": "text/plain" },
      method: "PUT",
    }))
  })

  it("uploads local drive files from the main process without ArrayBuffer IPC bodies", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-file-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "hello")

    const fetch = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("PUT")
      expect(init?.headers).toMatchObject({ "Content-Type": "text/plain", "Content-Length": "5" })
      expect(init?.body).not.toBeInstanceOf(ArrayBuffer)
      expect((init as RequestInit & { duplex?: string })?.duplex).toBe("half")
      return new Response(null, { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveUpload").mockResolvedValue({
      item: driveItem({ id: "file-1", name: "report.txt", size: "5" }),
      sessionId: "session-file-1",
      upload: {
        expiresAt: "2026-06-09T00:10:00.000Z",
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        url: "https://upload.example.test/file-1",
      },
    })
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "file-1", name: "report.txt", size: "5" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: "folder-1",
      items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

    expect(service.prepareDriveUpload).toHaveBeenCalledWith({
      parentId: "folder-1",
      name: "report.txt",
      size: "5",
      mimeType: "text/plain",
    })
    expect(service.completeDriveUpload).toHaveBeenCalledWith("session-file-1")
    expect(service.cancelDriveUpload).not.toHaveBeenCalled()
  })

  it("retries completed local drive file sessions before cancelling", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-complete-retry-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "hello")

    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveUpload").mockResolvedValue({
      item: driveItem({ id: "file-1", name: "report.txt", size: "5" }),
      sessionId: "session-file-1",
      upload: {
        expiresAt: "2026-06-09T00:10:00.000Z",
        headers: { "Content-Type": "text/plain" },
        method: "PUT",
        url: "https://upload.example.test/file-1",
      },
    })
    vi.spyOn(service, "completeDriveUpload")
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(driveItem({ id: "file-1", name: "report.txt", size: "5" }))
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: "folder-1",
      items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })

    expect(service.completeDriveUpload).toHaveBeenCalledTimes(2)
    expect(service.completeDriveUpload).toHaveBeenNthCalledWith(1, "session-file-1")
    expect(service.completeDriveUpload).toHaveBeenNthCalledWith(2, "session-file-1")
    expect(service.cancelDriveUpload).not.toHaveBeenCalled()
  })

  it("keeps existing Drive download output when the response stream fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-download-"))
    const outputPath = path.join(dir, "report.txt")
    await writeFile(outputPath, "previous")
    const { service } = await createTestAccountService()
    vi.spyOn(service, "fetchAuthenticated").mockResolvedValue(failingDownloadResponse())

    await expect(service.downloadDriveFile({ itemId: "item-1", outputPath })).rejects.toThrow()

    await expect(readFile(outputPath, "utf8")).resolves.toBe("previous")
    await expect(readdir(dir)).resolves.toEqual(["report.txt"])
  })

  it("posts Drive link resolve requests without leaking password into URL", async () => {
    const { service } = await createTestAccountService()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson").mockResolvedValueOnce({
      ok: true,
      linkType: "share",
      access: { status: "ok", canRead: true, canList: false, canReadText: true, canDownload: true },
      root: { name: "需求说明.md", type: "file", previewKind: "markdown" },
      ref: { kind: "share", shareId: "shr_123", itemId: null, siteId: null, path: null, assetId: null },
    })

    await service.resolveDriveLink({ url: "https://synapse.test/share/shr_123", password: "secret" })

    expect(requestAuthenticatedJson).toHaveBeenCalledWith(
      "POST",
      expectedApiUrl("/drive/link-intake/resolve"),
      { url: "https://synapse.test/share/shr_123", password: "secret" },
      "云盘链接解析失败。",
    )
    expect(String(requestAuthenticatedJson.mock.calls[0]?.[1])).not.toContain("secret")
  })

  it("materializes Drive link text into a local cache manifest", async () => {
    const { service } = await createTestAccountService()
    vi.spyOn(service, "listDriveLink").mockResolvedValueOnce({
      items: [{ path: "需求说明.md", name: "需求说明.md", type: "file", mimeType: "text/markdown", previewKind: "markdown", size: "12", itemId: "item-1" }],
      page: { hasMore: false, nextOffset: null },
    })
    vi.spyOn(service, "readDriveLinkText").mockResolvedValueOnce({
      path: "需求说明.md",
      mimeType: "text/markdown",
      previewKind: "markdown",
      text: "# 需求\n正文",
      truncated: false,
      source: { linkType: "share" },
    })

    const result = await service.materializeDriveLink({ url: "https://synapse.test/share/shr_123", password: "secret", scope: "text" })

    expect(result.localRootPath).toContain(path.join(os.tmpdir(), "synapse-account-userData", "drive-link-intake"))
    expect(result.entryPath).toContain("需求说明.md")
    expect(result.files).toEqual([{ relativePath: "需求说明.md", kind: "markdown", size: "15" }])
    expect(await readFile(result.manifestPath, "utf8")).not.toContain("secret")
  })

  it("downloads Drive link files through the link-intake download endpoint", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-link-download-"))
    const outputPath = path.join(dir, "sample-data.json")
    const { service } = await createTestAccountService()
    const fetchAuthenticated = vi.spyOn(service, "fetchAuthenticated").mockResolvedValueOnce(new Response("{\"ok\":true}", {
      headers: { "Content-Type": "application/json", "Content-Length": "11" },
    }))

    const result = await service.downloadDriveLinkFile({
      url: "https://synapse.test/share/shr_123",
      password: "secret",
      path: "sample-data.json",
      outputPath,
    })

    expect(fetchAuthenticated).toHaveBeenCalledWith(
      expectedApiUrl("/drive/link-intake/download-file"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: "https://synapse.test/share/shr_123",
          password: "secret",
          path: "sample-data.json",
        }),
      },
      "云盘链接下载失败。",
    )
    expect(await readFile(outputPath, "utf8")).toBe("{\"ok\":true}")
    expect(result).toEqual({ localPath: outputPath, mimeType: "application/json", size: "11" })
  })

  it("recursively materializes Drive link text without sending materialize-only fields to list", async () => {
    const { service } = await createTestAccountService()
    const listDriveLink = vi.spyOn(service, "listDriveLink").mockImplementation(async (input) => {
      if (input.itemId === "folder-pages") {
        return {
          items: [
            { path: "create-task.html", name: "create-task.html", type: "file", mimeType: "text/html", previewKind: "html-source", size: "21", itemId: "page-create" },
            { path: "review-task.html", name: "review-task.html", type: "file", mimeType: "text/html", previewKind: "html-source", size: "21", itemId: "page-review" },
          ],
          page: { hasMore: false, nextOffset: null },
        }
      }
      if (input.itemId === "folder-assets") {
        return {
          items: [
            { path: "styles.css", name: "styles.css", type: "file", mimeType: "text/css", previewKind: "text", size: "18", itemId: "asset-css" },
            { path: "logo.png", name: "logo.png", type: "file", mimeType: "image/png", previewKind: "image", size: "12", itemId: "asset-logo" },
          ],
          page: { hasMore: false, nextOffset: null },
        }
      }
      return {
        items: [
          { path: "index.html", name: "index.html", type: "file", mimeType: "text/html", previewKind: "html-source", size: "13", itemId: "index" },
          { path: "pages", name: "pages", type: "folder", mimeType: null, previewKind: "download-only", size: "0", itemId: "folder-pages" },
          { path: "assets", name: "assets", type: "folder", mimeType: null, previewKind: "download-only", size: "0", itemId: "folder-assets" },
        ],
        page: { hasMore: false, nextOffset: null },
      }
    })
    vi.spyOn(service, "readDriveLinkText").mockImplementation(async (input) => ({
      path: input.path ?? "",
      mimeType: input.path?.endsWith(".css") ? "text/css" : "text/html",
      previewKind: input.path?.endsWith(".css") ? "text" : "html-source",
      text: `content:${input.path}`,
      truncated: false,
      source: { linkType: "share" },
    }))

    const result = await service.materializeDriveLink({
      url: "https://synapse.test/share/shr_html",
      password: "secret",
      scope: "text",
      maxFiles: 20,
      maxBytes: 1024 * 1024,
    })

    expect(listDriveLink).toHaveBeenNthCalledWith(1, { url: "https://synapse.test/share/shr_html", password: "secret" })
    expect(result.files.map((file) => file.relativePath)).toEqual([
      "index.html",
      "pages/create-task.html",
      "pages/review-task.html",
      "assets/styles.css",
    ])
    expect(result.skipped).toEqual([{ path: "assets/logo.png", reason: "not-text" }])
    await expect(readFile(path.join(result.localRootPath, "content", "pages", "create-task.html"), "utf8"))
      .resolves.toBe("content:pages/create-task.html")
  })

  it("materializes binary files when Drive link scope is all", async () => {
    const { service } = await createTestAccountService()
    vi.spyOn(service, "listDriveLink").mockResolvedValueOnce({
      items: [{ path: "assets/logo.png", name: "logo.png", type: "file", mimeType: "image/png", previewKind: "image", size: "7", itemId: "asset-logo" }],
      page: { hasMore: false, nextOffset: null },
    })
    vi.spyOn(service, "downloadDriveLinkFile").mockImplementation(async (input) => {
      if (!input.outputPath) throw new Error("outputPath required")
      await writeFile(input.outputPath, "pngdata")
      return { localPath: input.outputPath, mimeType: "image/png", size: "7" }
    })

    const result = await service.materializeDriveLink({
      url: "https://synapse.test/share/shr_html",
      scope: "all",
      maxFiles: 5,
      maxBytes: 1024,
    })

    expect(result.files).toEqual([{ relativePath: "assets/logo.png", kind: "image", size: "7" }])
    await expect(readFile(path.join(result.localRootPath, "content", "assets", "logo.png"), "utf8")).resolves.toBe("pngdata")
  })

  it("rejects local files over the shared single file limit before preparing upload", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-too-large-"))
    const filePath = path.join(dir, "large.bin")
    await writeFile(filePath, "")
    await truncate(filePath, DRIVE_MAX_FILE_BYTES + 1)

    const { service } = await createTestAccountService()
    vi.spyOn(service, "prepareDriveUpload")

    await expect(service.uploadDriveLocalItems({
      parentId: null,
      items: [{ kind: "file", path: filePath, name: "large.bin", mimeType: "application/octet-stream" }],
    })).resolves.toEqual({
      completed: 0,
      failed: 1,
      skipped: 0,
      message: "文件超过 100MB 限制。",
    })

    expect(service.prepareDriveUpload).not.toHaveBeenCalled()
  })

  it("keeps sanitized server upload prepare errors in local upload results", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-prepare-error-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "hello")
    const prepareError = httpError("上传准备失败。 (POST /api/drive/uploads/prepare HTTP 400): 云盘空间不足。")
    const { service } = await createTestAccountService()
    vi.spyOn(service, "prepareDriveUpload").mockRejectedValueOnce(prepareError)

    await expect(service.uploadDriveLocalItems({
      parentId: null,
      items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
    })).resolves.toEqual({
      completed: 0,
      failed: 1,
      skipped: 0,
      message: "上传准备失败。 (POST /api/drive/uploads/prepare HTTP 400): 云盘空间不足。",
    })
  })

  it("keeps sanitized server folder prepare errors in local upload results", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-folder-prepare-error-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "hello")
    const prepareError = httpError("上传准备失败。 (POST /api/drive/uploads/folder/prepare HTTP 400): 云盘空间不足。")
    const { service } = await createTestAccountService()
    vi.spyOn(service, "prepareDriveFolderUpload").mockRejectedValueOnce(prepareError)

    await expect(service.uploadDriveLocalItems({
      parentId: "folder-1",
      items: [{ kind: "folder", folderName: "docs", files: [{ path: filePath, relativePath: "report.txt", mimeType: "text/plain" }] }],
    })).resolves.toEqual({
      completed: 0,
      failed: 1,
      skipped: 0,
      message: "上传准备失败。 (POST /api/drive/uploads/folder/prepare HTTP 400): 云盘空间不足。",
    })
  })

  it("keeps sanitized server public asset prepare errors in local upload results", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-public-asset-prepare-error-"))
    const filePath = path.join(dir, "quota.png")
    await writeFile(filePath, "hello")
    const prepareError = httpError("上传准备失败。 (POST /api/drive/public-assets/uploads/prepare HTTP 400): 云盘空间不足。")
    const { service } = await createTestAccountService()
    vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson").mockRejectedValueOnce(prepareError)

    await expect(service.uploadDrivePublicAssets({
      files: [{ path: filePath, name: "quota.png", mimeType: null }],
    })).resolves.toEqual({
      results: [
        {
          status: "rejected",
          fileName: "quota.png",
          message: "上传准备失败。 (POST /api/drive/public-assets/uploads/prepare HTTP 400): 云盘空间不足。",
        },
      ],
    })
  })

  it("preserves existing prepared upload content-length headers", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-existing-length-"))
    const filePath = path.join(dir, "report.txt")
    await writeFile(filePath, "hello")

    const fetch = vi.fn(async (_url, init) => {
      expect(init?.headers).toMatchObject({
        "Content-Type": "text/plain",
        "content-length": "already-set",
      })
      expect(init?.headers).not.toMatchObject({ "Content-Length": "5" })
      return new Response(null, { status: 200 })
    }) as unknown as typeof globalThis.fetch

    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveUpload").mockResolvedValue({
      item: driveItem({ id: "file-1", name: "report.txt", size: "5" }),
      sessionId: "session-file-1",
      upload: {
        expiresAt: "2026-06-09T00:10:00.000Z",
        headers: { "Content-Type": "text/plain", "content-length": "already-set" },
        method: "PUT",
        url: "https://upload.example.test/file-1",
      },
    })
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "file-1", name: "report.txt", size: "5" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: "folder-1",
      items: [{ kind: "file", path: filePath, name: "report.txt", mimeType: "text/plain" }],
    })).resolves.toEqual({ completed: 1, failed: 0, skipped: 0 })
  })

  it("uploads local drive folders with the selected folder name and relative manifest", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-folder-"))
    const docsDir = path.join(dir, "项目A", "docs")
    await mkdir(docsDir, { recursive: true })
    const firstPath = path.join(dir, "项目A", "a.md")
    const secondPath = path.join(docsDir, "b.md")
    await writeFile(firstPath, "alpha")
    await writeFile(secondPath, "beta")

    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveFolderUpload").mockResolvedValue({
      root: driveItem({ id: "folder-root", name: "项目A", type: "folder", size: "0" }),
      rootCreated: true,
      entries: [
        preparedFolderEntry("a.md", "session-a", "https://upload.example.test/a"),
        preparedFolderEntry("docs/b.md", "session-b", "https://upload.example.test/b"),
      ],
    })
    vi.spyOn(service, "completeDriveUpload")
      .mockResolvedValueOnce(driveItem({ id: "a", name: "a.md", size: "5" }))
      .mockResolvedValueOnce(driveItem({ id: "b", name: "b.md", size: "4" }))
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: firstPath, relativePath: "a.md", mimeType: "text/markdown" },
          { path: secondPath, relativePath: "docs/b.md", mimeType: null },
        ],
      }],
    })).resolves.toEqual({ completed: 2, failed: 0, skipped: 0 })

    expect(service.prepareDriveFolderUpload).toHaveBeenCalledWith({
      parentId: null,
      folderName: "项目A",
      files: [
        { relativePath: "a.md", size: "5", mimeType: "text/markdown" },
        { relativePath: "docs/b.md", size: "4", mimeType: null },
      ],
    })
  })

  it("cleans up a newly prepared folder root when every local folder upload fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-folder-failed-"))
    const firstPath = path.join(dir, "a.md")
    const secondPath = path.join(dir, "b.md")
    await writeFile(firstPath, "alpha")
    await writeFile(secondPath, "beta")

    const { service } = await createTestAccountService()
    vi.spyOn(service, "prepareDriveFolderUpload").mockResolvedValue({
      root: driveItem({ id: "folder-root", name: "项目A", type: "folder", size: "0" }),
      rootCreated: true,
      entries: [
        preparedFolderEntry("a.md", "session-a", "https://upload.example.test/a"),
        preparedFolderEntry("b.md", "session-b", "https://upload.example.test/b"),
      ],
    })
    vi.spyOn(service as unknown as {
      putPreparedUploadFromPath: (...args: unknown[]) => Promise<void>
    }, "putPreparedUploadFromPath").mockRejectedValue(new Error("network down"))
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(driveItem())
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })
    vi.spyOn(service, "deleteDriveItem").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: firstPath, relativePath: "a.md", mimeType: "text/markdown" },
          { path: secondPath, relativePath: "b.md", mimeType: "text/markdown" },
        ],
      }],
    })).resolves.toEqual({ completed: 0, failed: 2, skipped: 0, message: "上传失败。" })

    expect(service.cancelDriveUpload).toHaveBeenCalledWith("session-a")
    expect(service.cancelDriveUpload).toHaveBeenCalledWith("session-b")
    expect(service.deleteDriveItem).toHaveBeenCalledWith("folder-root")
  })

  it("skips non-canonical local drive folder relative paths before prepare", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-folder-safe-paths-"))
    await mkdir(path.join(dir, "safe", "docs"), { recursive: true })
    await mkdir(path.join(dir, "secret"), { recursive: true })
    const validPath = path.join(dir, "safe", "docs", "a.md")
    const doubleSlashPath = path.join(dir, "secret", "double-slash.md")
    const dotSegmentPath = path.join(dir, "secret", "dot-segment.md")
    const trailingSlashPath = path.join(dir, "secret", "trailing-slash.md")
    await writeFile(validPath, "alpha")
    await writeFile(doubleSlashPath, "double")
    await writeFile(dotSegmentPath, "dot")
    await writeFile(trailingSlashPath, "trailing")

    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveFolderUpload").mockResolvedValue({
      root: driveItem({ id: "folder-root", name: "项目A", type: "folder", size: "0" }),
      rootCreated: true,
      entries: [preparedFolderEntry("docs/a.md", "session-a", "https://upload.example.test/a")],
    })
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "a", name: "a.md", size: "5" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    const result = await service.uploadDriveLocalItems({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: validPath, relativePath: "docs/a.md", mimeType: "text/markdown" },
          { path: doubleSlashPath, relativePath: "docs//b.md", mimeType: "text/markdown" },
          { path: dotSegmentPath, relativePath: "docs/./b.md", mimeType: "text/markdown" },
          { path: trailingSlashPath, relativePath: "docs/", mimeType: "text/markdown" },
        ],
      }],
    })

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 3 })
    expect(service.prepareDriveFolderUpload).toHaveBeenCalledWith({
      parentId: null,
      folderName: "项目A",
      files: [{ relativePath: "docs/a.md", size: "5", mimeType: "text/markdown" }],
    })
    const prepareCalls = JSON.stringify(vi.mocked(service.prepareDriveFolderUpload).mock.calls)
    expect(prepareCalls).not.toContain("docs//b.md")
    expect(prepareCalls).not.toContain("docs/./b.md")
    expect(prepareCalls).not.toContain("\"docs/\"")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(doubleSlashPath)
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(dotSegmentPath)
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(trailingSlashPath)
  })

  it("skips duplicate local drive folder relative paths before prepare", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-folder-duplicates-"))
    await mkdir(path.join(dir, "first"), { recursive: true })
    await mkdir(path.join(dir, "second"), { recursive: true })
    const firstPath = path.join(dir, "first", "a.md")
    const duplicatePath = path.join(dir, "second", "a.md")
    await writeFile(firstPath, "alpha")
    await writeFile(duplicatePath, "duplicate")

    const fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveFolderUpload").mockResolvedValue({
      root: driveItem({ id: "folder-root", name: "项目A", type: "folder", size: "0" }),
      rootCreated: true,
      entries: [preparedFolderEntry("docs/a.md", "session-a", "https://upload.example.test/a")],
    })
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "a", name: "a.md", size: "5" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    const result = await service.uploadDriveLocalItems({
      parentId: null,
      items: [{
        kind: "folder",
        folderName: "项目A",
        files: [
          { path: firstPath, relativePath: "docs/a.md", mimeType: "text/markdown" },
          { path: duplicatePath, relativePath: "docs/a.md", mimeType: "text/markdown" },
        ],
      }],
    })

    expect(result).toEqual({ completed: 1, failed: 0, skipped: 1 })
    expect(service.prepareDriveFolderUpload).toHaveBeenCalledWith({
      parentId: null,
      folderName: "项目A",
      files: [{ relativePath: "docs/a.md", size: "5", mimeType: "text/markdown" }],
    })
    const warnings = JSON.stringify(accountLogger.warn.mock.calls)
    expect(warnings).toContain("duplicate-relative-path")
    expect(warnings).not.toContain(duplicatePath)
    expect(warnings).not.toContain("docs/a.md")
  })

  it("continues local drive uploads after one file fails and cancels the failed session", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-drive-local-partial-"))
    const firstPath = path.join(dir, "first.txt")
    const secondPath = path.join(dir, "second.txt")
    await writeFile(firstPath, "first")
    await writeFile(secondPath, "second")

    const fetch = vi.fn(async (url) => (
      String(url).includes("first")
        ? new Response("nope", { status: 500 })
        : new Response(null, { status: 200 })
    )) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    vi.spyOn(service, "prepareDriveUpload")
      .mockResolvedValueOnce(preparedFile("session-first", "https://upload.example.test/first"))
      .mockResolvedValueOnce(preparedFile("session-second", "https://upload.example.test/second"))
    vi.spyOn(service, "completeDriveUpload").mockResolvedValue(
      driveItem({ id: "second", name: "second.txt", size: "6" }),
    )
    vi.spyOn(service, "cancelDriveUpload").mockResolvedValue({ ok: true })

    await expect(service.uploadDriveLocalItems({
      parentId: null,
      items: [
        { kind: "file", path: firstPath, name: "first.txt", mimeType: null },
        { kind: "file", path: secondPath, name: "second.txt", mimeType: null },
      ],
    })).resolves.toMatchObject({ completed: 1, failed: 1, skipped: 0 })

    expect(service.cancelDriveUpload).toHaveBeenCalledWith("session-first")
    expect(service.completeDriveUpload).toHaveBeenCalledWith("session-second")
  })

  it("infers public asset MIME types before upload and replace prepare requests", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-public-asset-local-"))
    const uploadPath = path.join(dir, "logo.png")
    const replacePath = path.join(dir, "banner.webp")
    await writeFile(uploadPath, "hello")
    await writeFile(replacePath, "banner")
    const asset = drivePublicAsset()
    const { service } = await createTestAccountService()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson")
      .mockResolvedValueOnce(preparedFile("upload-session", "https://upload.example.test/public-asset-upload"))
      .mockResolvedValueOnce(asset)
      .mockResolvedValueOnce(preparedFile("replace-session", "https://upload.example.test/public-asset-replace"))
      .mockResolvedValueOnce(asset)
    vi.spyOn(service as unknown as {
      putPreparedUploadFromPath: (...args: unknown[]) => Promise<void>
    }, "putPreparedUploadFromPath").mockResolvedValue(undefined)

    await expect(service.uploadDrivePublicAssets({
      files: [{ path: uploadPath, name: "logo.png", mimeType: null }],
    })).resolves.toEqual({ results: [{ status: "fulfilled", fileName: "logo.png", asset }] })
    await expect(service.replaceDrivePublicAssetFile({
      assetId: asset.assetId,
      path: replacePath,
      name: "banner.webp",
      mimeType: null,
    })).resolves.toEqual(asset)

    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      "POST",
      expectedApiUrl("/drive/public-assets/uploads/prepare"),
      { name: "logo.png", size: "5", mimeType: "image/png" },
      "上传准备失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      3,
      "POST",
      expectedApiUrl(`/drive/public-assets/${encodeURIComponent(asset.assetId)}/replace/prepare`),
      { name: "banner.webp", size: "6", mimeType: "image/webp" },
      "替换准备失败。",
    )
  })

  it("uploads binary public assets through prepare, PUT, and complete", async () => {
    const bytes = new TextEncoder().encode("hello").buffer
    const asset = drivePublicAsset({ name: "logo.png", size: "5", mimeType: "image/png" })
    const fetch = vi.fn(async (_url, init) => {
      expect(init?.method).toBe("PUT")
      expect(init?.headers).toMatchObject({ "Content-Length": "5" })
      expect(init?.body).toEqual(Buffer.from(bytes))
      return new Response(null, { status: 200 })
    }) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson")
      .mockResolvedValueOnce(preparedFile("upload-session", "https://upload.example.test/public-asset-binary"))
      .mockResolvedValueOnce(asset)

    await expect(service.uploadDrivePublicAssetBinary({
      name: "logo.png",
      mimeType: "",
      data: bytes,
    })).resolves.toEqual(asset)

    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      "POST",
      expectedApiUrl("/drive/public-assets/uploads/prepare"),
      { name: "logo.png", size: "5", mimeType: "image/png" },
      "上传准备失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      "POST",
      expectedApiUrl("/drive/public-assets/uploads/upload-session/complete"),
      undefined,
      "上传确认失败。",
    )
  })

  it("rejects unsupported binary public asset uploads before prepare", async () => {
    const bytes = new TextEncoder().encode("plain text").buffer
    const { service } = await createTestAccountService()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson")

    await expect(service.uploadDrivePublicAssetBinary({
      name: "note.txt",
      mimeType: "text/plain",
      data: bytes,
    })).rejects.toThrow("格式不支持。")

    expect(requestAuthenticatedJson).not.toHaveBeenCalled()
  })

  it("cancels binary public asset uploads when PUT fails after prepare", async () => {
    const bytes = new TextEncoder().encode("hello").buffer
    const fetch = vi.fn(async () => textResponse("upload failed", 500)) as unknown as typeof globalThis.fetch
    const { service } = await createTestAccountService({ fetch })
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson")
      .mockResolvedValueOnce(preparedFile("upload-session", "https://upload.example.test/public-asset-binary"))
      .mockResolvedValueOnce({ ok: true })

    await expect(service.uploadDrivePublicAssetBinary({
      name: "logo.png",
      mimeType: "image/png",
      data: bytes,
    })).rejects.toThrow("上传失败")

    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      "POST",
      expectedApiUrl("/drive/public-assets/uploads/upload-session/cancel"),
      undefined,
      "上传取消失败。",
    )
  })

  it("builds owner and share URLs for document image source scans", async () => {
    const { service } = await createTestAccountService()
    const imageSources = driveDocumentImageSources()
    const getAuthenticatedJson = vi.spyOn(service as unknown as {
      getAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "getAuthenticatedJson").mockResolvedValue(imageSources)

    await expect(service.scanDriveDocumentImageSources({ kind: "owner", itemId: "item-1" }))
      .resolves.toEqual(imageSources)
    await expect(service.scanDriveDocumentImageSources({ kind: "share", shareId: "share-1" }))
      .resolves.toEqual(imageSources)
    await expect(service.scanDriveDocumentImageSources({ kind: "share", shareId: "share-1", itemId: "item-2" }))
      .resolves.toEqual(imageSources)

    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      expectedApiUrl("/drive/items/item-1/image-sources"),
      "图片来源加载失败。",
    )
    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      expectedApiUrl("/drive/browser/shares/share-1/image-sources"),
      "图片来源加载失败。",
    )
    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      3,
      expectedApiUrl("/drive/browser/shares/share-1/items/item-2/image-sources"),
      "图片来源加载失败。",
    )
  })

  it("builds owner and share URLs and POST bodies for document image imports", async () => {
    const { service } = await createTestAccountService()
    const result = driveDocumentImageImportResult()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson").mockResolvedValue(result)
    const sources = [{ src: "https://example.test/logo.png" }]

    await expect(service.importDriveDocumentImages({
      kind: "owner",
      itemId: "item-1",
      baseVersionId: "version-1",
      sources,
    })).resolves.toEqual(result)
    await expect(service.importDriveDocumentImages({
      kind: "share",
      shareId: "share-1",
      baseVersionId: "version-1",
      sources,
    })).resolves.toEqual(result)
    await expect(service.importDriveDocumentImages({
      kind: "share",
      shareId: "share-1",
      itemId: "item-2",
      baseVersionId: "version-1",
      sources,
    })).resolves.toEqual(result)

    const body = { baseVersionId: "version-1", sources }
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      "POST",
      expectedApiUrl("/drive/items/item-1/image-sources/import"),
      body,
      "图片导入失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      "POST",
      expectedApiUrl("/drive/browser/shares/share-1/image-sources/import"),
      body,
      "图片导入失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      3,
      "POST",
      expectedApiUrl("/drive/browser/shares/share-1/items/item-2/image-sources/import"),
      body,
      "图片导入失败。",
    )
  })

  it("lists public assets and trash with pagination-only query parameters", async () => {
    const { service } = await createTestAccountService()
    const page = { items: [], total: 0, page: { offset: 0, limit: 50, hasMore: false, nextOffset: null } }
    const getAuthenticatedJson = vi.spyOn(service as unknown as {
      getAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "getAuthenticatedJson").mockResolvedValue(page)

    await expect(service.listDrivePublicAssets({ offset: 0, limit: 50 })).resolves.toEqual(page)
    await expect(service.listDriveTrash({ offset: 50, limit: 50 })).resolves.toEqual(page)

    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      expectedApiUrl("/drive/public-assets?offset=0&limit=50"),
      "公开素材加载失败。",
    )
    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      expectedApiUrl("/drive/trash?offset=50&limit=50"),
      "回收站加载失败。",
    )
  })

  it("calls Drive site APIs and rewrites URLs to the configured public app URL", async () => {
    const { service } = await createTestAccountService()
    const site = driveSite({ siteId: "site_abc", url: "https://server.example/sites/site_abc/" })
    const protectedSite = driveSite({
      siteId: "site_abc",
      url: "https://server.example/sites/site_abc/",
      urlWithPassword: "https://server.example/sites/site_abc/?password=server-secret",
      passwordEnabled: true,
      password: "SitePw1",
      accessMode: "password",
      expiresAt: "2026-06-26T00:00:00.000Z",
    })
    const page = { items: [site], total: 1, page: { offset: 0, limit: 50, hasMore: false, nextOffset: null } }
    const preflight = {
      sourceFolderItemId: "folder-1",
      sourceFolderName: "产品原型",
      htmlFiles: ["index.html"],
      defaultEntryPath: "index.html",
      fileCount: 3,
      totalBytes: "128",
      includesJavaScript: true,
    }
    const getAuthenticatedJson = vi.spyOn(service as unknown as {
      getAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "getAuthenticatedJson")
      .mockResolvedValueOnce(preflight)
      .mockResolvedValueOnce(page)
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson")
      .mockResolvedValueOnce(site)
      .mockResolvedValueOnce(protectedSite)
      .mockResolvedValueOnce(site)
      .mockResolvedValueOnce(site)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(site)

    await expect(service.preflightDriveSite({ sourceFolderItemId: "folder-1" })).resolves.toEqual(preflight)
    await expect(service.createDriveSite({
      sourceFolderItemId: "folder-1",
      name: "产品原型",
      entryPath: null,
      accessMode: "public",
      expiresIn: "forever",
    })).resolves.toMatchObject({ siteId: "site_abc", url: `${expectedPublicAppUrl}/sites/site_abc/` })
    await expect(service.listDriveSites({ offset: 0, limit: 50, search: "原型", status: "active" }))
      .resolves.toMatchObject({ items: [{ siteId: "site_abc", url: `${expectedPublicAppUrl}/sites/site_abc/` }] })
    await expect(service.updateDriveSiteAccess({
      siteId: "site_abc",
      accessMode: "password",
      expiresIn: "7d",
    })).resolves.toMatchObject({
      siteId: "site_abc",
      url: `${expectedPublicAppUrl}/sites/site_abc/`,
      urlWithPassword: `${expectedPublicAppUrl}/sites/site_abc/?password=SitePw1`,
      password: "SitePw1",
    })
    await expect(service.disableDriveSite("site_abc")).resolves.toMatchObject({ siteId: "site_abc" })
    await expect(service.enableDriveSite("site_abc")).resolves.toMatchObject({ siteId: "site_abc" })
    await expect(service.deleteDriveSite("site_abc")).resolves.toEqual({ ok: true })
    await expect(service.republishDriveSite({ siteId: "site_abc", entryPath: "index.html" })).resolves.toMatchObject({ siteId: "site_abc" })

    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      expectedApiUrl("/drive/sites/preflight?sourceFolderItemId=folder-1"),
      "站点预检失败。",
    )
    expect(getAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      expectedApiUrl("/drive/sites?offset=0&limit=50&search=%E5%8E%9F%E5%9E%8B&status=active"),
      "站点列表加载失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      1,
      "POST",
      expectedApiUrl("/drive/sites"),
      { sourceFolderItemId: "folder-1", name: "产品原型", entryPath: null, accessMode: "public", expiresIn: "forever" },
      "站点发布失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      2,
      "PATCH",
      expectedApiUrl("/drive/sites/site_abc/access"),
      { accessMode: "password", expiresIn: "7d" },
      "站点访问设置保存失败。",
    )
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(3, "POST", expectedApiUrl("/drive/sites/site_abc/disable"), undefined, "停用站点失败。")
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(4, "POST", expectedApiUrl("/drive/sites/site_abc/enable"), undefined, "启用站点失败。")
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(5, "DELETE", expectedApiUrl("/drive/sites/site_abc"), undefined, "删除站点失败。")
    expect(requestAuthenticatedJson).toHaveBeenNthCalledWith(
      6,
      "POST",
      expectedApiUrl("/drive/sites/site_abc/republish"),
      { entryPath: "index.html" },
      "重新发布站点失败。",
    )
  })

  it("keeps ordered public asset upload results and cancels failed sessions", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-public-asset-batch-"))
    const okPath = path.join(dir, "ok.png")
    const failedPath = path.join(dir, "failed.png")
    await writeFile(okPath, "ok")
    await writeFile(failedPath, "failed")
    const okAsset = drivePublicAsset({ assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ", name: "ok.png" })
    const { service } = await createTestAccountService()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson").mockImplementation(async (method, url, body) => {
      const urlText = String(url)
      if (urlText.endsWith("/drive/public-assets/uploads/prepare") && (body as { readonly name?: string }).name === "ok.png") {
        return preparedFile("public-upload-ok", "https://upload.example.test/public-ok")
      }
      if (urlText.endsWith("/drive/public-assets/uploads/prepare") && (body as { readonly name?: string }).name === "failed.png") {
        return preparedFile("public-upload-failed", "https://upload.example.test/public-failed")
      }
      if (urlText.endsWith("/drive/public-assets/uploads/public-upload-ok/complete")) return okAsset
      if (urlText.endsWith("/drive/public-assets/uploads/public-upload-failed/cancel")) return { ok: true }
      throw new Error(`unexpected ${String(method)} ${urlText}`)
    })
    vi.spyOn(service as unknown as {
      putPreparedUploadFromPath: (upload: DriveUploadPrepareResult["upload"], filePath: string, size: number) => Promise<void>
    }, "putPreparedUploadFromPath").mockImplementation(async (upload) => {
      if (upload.url.includes("public-failed")) throw new Error("network down")
    })

    await expect(service.uploadDrivePublicAssets({
      files: [
        { path: okPath, name: "ok.png", mimeType: null },
        { path: failedPath, name: "failed.png", mimeType: null },
      ],
    })).resolves.toEqual({
      results: [
        { status: "fulfilled", fileName: "ok.png", asset: okAsset },
        { status: "rejected", fileName: "failed.png", message: "上传失败。" },
      ],
    })

    expect(requestAuthenticatedJson).toHaveBeenCalledWith(
      "POST",
      expectedApiUrl("/drive/public-assets/uploads/public-upload-failed/cancel"),
      undefined,
      "上传取消失败。",
    )
  })

  it("cancels public asset replacement sessions when local upload fails", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "synapse-public-asset-replace-"))
    const replacePath = path.join(dir, "replacement.png")
    await writeFile(replacePath, "replacement")
    const asset = drivePublicAsset()
    const { service } = await createTestAccountService()
    const requestAuthenticatedJson = vi.spyOn(service as unknown as {
      requestAuthenticatedJson: (...args: unknown[]) => Promise<unknown>
    }, "requestAuthenticatedJson").mockImplementation(async (method, url) => {
      const urlText = String(url)
      if (urlText.endsWith(`/drive/public-assets/${encodeURIComponent(asset.assetId)}/replace/prepare`)) {
        return preparedFile("public-replace-failed", "https://upload.example.test/public-replace")
      }
      if (urlText.endsWith(`/drive/public-assets/${encodeURIComponent(asset.assetId)}/replace/public-replace-failed/cancel`)) {
        return { ok: true }
      }
      throw new Error(`unexpected ${String(method)} ${urlText}`)
    })
    vi.spyOn(service as unknown as {
      putPreparedUploadFromPath: (...args: unknown[]) => Promise<void>
    }, "putPreparedUploadFromPath").mockRejectedValue(new Error("upload failed"))

    await expect(service.replaceDrivePublicAssetFile({
      assetId: asset.assetId,
      path: replacePath,
      name: "replacement.png",
      mimeType: null,
    })).rejects.toThrow("upload failed")

    expect(requestAuthenticatedJson).toHaveBeenCalledWith(
      "POST",
      expectedApiUrl(`/drive/public-assets/${encodeURIComponent(asset.assetId)}/replace/public-replace-failed/cancel`),
      undefined,
      "替换取消失败。",
    )
  })

  it("does not leak local paths in local upload summaries or logs", async () => {
    const missingPath = "/tmp/synapse-secret-folder/secret-token.txt"
    const { service } = await createTestAccountService()

    const result = await service.uploadDriveLocalItems({
      parentId: null,
      items: [{ kind: "file", path: missingPath, name: "secret-token.txt", mimeType: null }],
    })

    expect(result).toMatchObject({ completed: 0, failed: 0, skipped: 1 })
    expect(JSON.stringify(result)).not.toContain(missingPath)
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(missingPath)
  })

  it("uses the generated API base URL instead of switching by package mode", async () => {
    const { namespace, service } = await createTestAccountService({ isPackaged: true })

    expect(service.getApiBaseUrlForLive()).toBe(expectedApiBaseUrl)

    const result = await service.startLogin()
    expect(new URL(result.loginUrl).origin).toBe(new URL(expectedPublicAppUrl).origin)
    expect(await namespace.getSingleton()).toMatchObject({
      activeAttempt: {
        apiBaseUrl: expectedApiBaseUrl,
      },
    })
  })

  it("reports browser open failures without blaming account storage", async () => {
    const { namespace, openExternal, service } = await createTestAccountService()
    openExternal.mockRejectedValueOnce(new Error("browser unavailable"))

    const result = await service.startLogin()

    expect(result.state).toEqual({
      status: "error",
      message: "无法打开浏览器，请检查默认浏览器设置后重试。",
    })
    expect(await namespace.getSingleton()).toMatchObject({
      activeAttempt: {
        state: expect.any(String),
        codeVerifier: expect.any(String),
        apiBaseUrl: expectedApiBaseUrl,
      },
    })
  })

  it("logs login start success without leaking the login state", async () => {
    const { service } = await createTestAccountService()

    const result = await service.startLogin()
    const loginUrl = new URL(result.loginUrl)

    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account login started.", {
      operation: "startLogin",
      status: "success",
      apiMode: expectedApiMode,
    })
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain(loginUrl.searchParams.get("state"))
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain(loginUrl.searchParams.get("code_challenge"))
  })

  it("exchanges protocol callback, stores refresh token, and loads me", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          expect(init?.method).toBe("POST")
          expect(JSON.parse(String(init?.body))).toMatchObject({
            code: "code-1",
            state: expect.any(String),
            codeVerifier: expect.any(String),
          })
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    if (state.status !== "authenticated") {
      throw new Error("expected authenticated account state")
    }
    expect(state.profile.user.email).toBe("u@example.com")
    expect((await namespace.getSingleton())?.refreshToken).toBe("refresh-1")
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()
  })

  it("ignores stale auth callbacks after the user is already authenticated", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/desktop/token")) {
        expect(init?.method).toBe("POST")
        return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch
    const { namespace, service } = await createTestAccountService({ fetch: fetchMock })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    const authenticatedState = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`,
    )
    expect(authenticatedState.status).toBe("authenticated")
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()

    const staleState = await service.handleAuthCallback(
      "synapse://auth/desktop/callback?code=old-code&state=old-state",
    )

    expect(staleState).toEqual(authenticatedState)
    expect(service.getState()).toEqual(authenticatedState)
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-1",
      lastProfile: { user: { email: "u@example.com" } },
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(accountLogger.info).toHaveBeenCalledWith("Ignored stale account auth callback while already authenticated.", {
      operation: "handleAuthCallback",
      status: "already-authenticated",
    })
  })

  it("logs successful callback exchange and authentication without leaking credentials", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          expect(JSON.parse(String(init?.body))).toMatchObject({
            code: "secret-code",
            state: expect.any(String),
            codeVerifier: expect.any(String),
          })
          return jsonResponse({ accessToken: "secret-access", refreshToken: "secret-refresh" })
        }
        if (String(url).endsWith("/auth/me")) {
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=secret-code&state=${attempt!.state}`,
    )

    expect(state.status).toBe("authenticated")
    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account callback accepted.", {
      operation: "handleAuthCallback",
      status: "accepted",
    })
    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account callback exchange succeeded.", {
      operation: "handleAuthCallback",
      status: "exchange-success",
    })
    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account authenticated.", {
      operation: "handleAuthCallback",
      status: "authenticated",
      userId: "u1",
      teamCount: 0,
    })
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-code")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-access")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-refresh")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain(attempt!.state)
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain(attempt!.codeVerifier)
  })

  it("logs HTTP details for callback exchange failures without leaking response secrets", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({
            error: "code expired",
            token: "secret-response-token",
            api_key: "secret-api-key",
            "api-key": "secret-dash-api-key",
            access_token: "secret-access-token",
            refresh_token: "secret-refresh-token",
            nested: { api_key: "secret-nested-api-key" },
          }, 400)
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=secret-code&state=${attempt!.state}`,
    )

    expect(state.status).toBe("error")
    const warning = accountLogger.warn.mock.calls.find(
      ([message]) => message === "Desktop account callback exchange failed.",
    )
    const error = warning?.[1]?.error as Error | undefined
    expect(error?.message).toContain("POST /api/auth/desktop/token")
    expect(error?.message).toContain("HTTP 400")
    expect(error?.message).toContain("code expired")
    expect(error?.message).not.toContain("secret-response-token")
    expect(error?.message).not.toContain("secret-api-key")
    expect(error?.message).not.toContain("secret-dash-api-key")
    expect(error?.message).not.toContain("secret-access-token")
    expect(error?.message).not.toContain("secret-refresh-token")
    expect(error?.message).not.toContain("secret-nested-api-key")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-api-key")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-dash-api-key")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-access-token")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-refresh-token")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-nested-api-key")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-code")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(attempt!.state)
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(attempt!.codeVerifier)
  })

  it("redacts plaintext HTTP failure bodies before logging account errors", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          return textResponse(
            "proxy failed Authorization: Bearer secret-response-token token=plain-secret Cookie: session=secret-cookie",
            502,
          )
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=secret-code&state=${attempt!.state}`,
    )

    expect(state.status).toBe("error")
    const warning = accountLogger.warn.mock.calls.find(
      ([message]) => message === "Desktop account callback exchange failed.",
    )
    const error = warning?.[1]?.error as Error | undefined
    expect(error?.message).toContain("POST /api/auth/desktop/token")
    expect(error?.message).toContain("HTTP 502")
    expect(error?.message).toContain("proxy failed")
    expect(error?.message).toContain("[redacted]")
    expect(error?.message).not.toContain("secret-response-token")
    expect(error?.message).not.toContain("plain-secret")
    expect(error?.message).not.toContain("secret-cookie")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-code")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(attempt!.state)
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain(attempt!.codeVerifier)
  })

  it("recovers from a callback exchange failure with the existing refresh token", async () => {
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ error: "server unavailable", token: "secret-response-token" }, 503)
        }
        if (String(url).endsWith("/auth/refresh")) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
          return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=secret-code&state=${attempt!.state}`,
    )

    expect(state.status).toBe("authenticated")
    expect(calls).toEqual([
      expectedApiUrl("/auth/desktop/token"),
      expectedApiUrl("/auth/refresh"),
      expectedApiUrl("/auth/me"),
    ])
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-new",
      lastProfile: { user: { email: "u@example.com" } },
    })
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-code")
    expect(JSON.stringify(accountLogger.warn.mock.calls)).not.toContain("secret-response-token")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("refresh-old")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("refresh-new")
  })

  it("preserves active login state on callback state mismatch", async () => {
    const fetch = vi.fn()
    const { service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()

    const state = await service.handleAuthCallback("synapse://auth/desktop/callback?code=code-1&state=wrong")

    expect(state.status).toBe("authenticating")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps active login state when the browser reports an unsupported account so switch-account can recover", async () => {
    const fetchMock = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/desktop/token")) {
        expect(init?.method).toBe("POST")
        return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    }) as typeof fetch
    const { namespace, service } = await createTestAccountService({ fetch: fetchMock })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?error=unsupported_account&state=${attempt!.state}`,
    )

    expect(state).toMatchObject({
      status: "error",
      message: "请使用普通用户账号登录。",
    })
    expect((await namespace.getSingleton())?.activeAttempt?.state).toBe(attempt!.state)
    expect(fetchMock).not.toHaveBeenCalled()

    const recoveredState = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`,
    )

    expect(recoveredState.status).toBe("authenticated")
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect((await namespace.getSingleton())?.refreshToken).toBe("refresh-1")
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()
  })

  it("preserves newer login attempts when an older callback arrives", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/desktop/token")) {
        expect(init?.method).toBe("POST")
        return jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2" })
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-2" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()
    const firstAttempt = (await namespace.getSingleton())?.activeAttempt
    expect(firstAttempt).toBeTruthy()
    await service.startLogin()
    const secondAttempt = (await namespace.getSingleton())?.activeAttempt
    expect(secondAttempt).toBeTruthy()
    expect(secondAttempt!.state).not.toBe(firstAttempt!.state)

    const firstState = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=code-1&state=${firstAttempt!.state}`,
    )

    expect(firstState.status).toBe("authenticating")
    expect(fetch).not.toHaveBeenCalled()
    expect((await namespace.getSingleton())?.activeAttempt?.state).toBe(secondAttempt!.state)

    const secondState = await service.handleAuthCallback(
      `synapse://auth/desktop/callback?code=code-2&state=${secondAttempt!.state}`,
    )

    expect(secondState.status).toBe("authenticated")
    expect(fetch).toHaveBeenCalledTimes(2)
    expect((await namespace.getSingleton())?.refreshToken).toBe("refresh-2")
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()
  })

  it("reports malformed callback URLs as errors without exchanging", async () => {
    const fetch = vi.fn()
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ lastProfile: storedProfile })

    const state = await service.handleAuthCallback("not a url")

    expect(state).toMatchObject({
      status: "error",
      message: "登录已失效，请重试。",
      profile: storedProfile,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps active login state when malformed callback arrives during login", async () => {
    const fetch = vi.fn()
    const { service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    const started = await service.startLogin()

    const state = await service.handleAuthCallback("not a url")

    expect(state).toEqual(started.state)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("ignores unknown protocol routes without exchanging", async () => {
    const fetch = vi.fn()
    const { service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()
    const before = service.getState()

    const state = await service.handleAuthCallback("synapse://other/path?code=code-1&state=state-1")

    expect(state).toEqual(before)
    expect(fetch).not.toHaveBeenCalled()
  })

  it("recovers when me fails after exchange by refreshing the new token", async () => {
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me") && calls.filter((item) => item.endsWith("/auth/me")).length === 1) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ error: "stale access" }, 401)
        }
        if (String(url).endsWith("/auth/refresh")) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-1" })
          return jsonResponse({ accessToken: "access-2", refreshToken: "refresh-2" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-2" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const state = await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    expect(state.status).toBe("authenticated")
    expect(calls).toEqual([
      expectedApiUrl("/auth/desktop/token"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/auth/refresh"),
      expectedApiUrl("/auth/me"),
    ])
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-2",
      lastProfile: { user: { email: "u@example.com" } },
    })
  })

  it("logs HTTP details when profile loading fails after callback exchange", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          return jsonResponse({ error: "access denied" }, 401)
        }
        if (String(url).endsWith("/auth/refresh")) {
          return jsonResponse({ error: "refresh denied" }, 401)
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    const warning = accountLogger.warn.mock.calls.find(
      ([message]) => message === "Desktop account profile load failed after exchange; retrying refresh.",
    )
    const error = warning?.[1]?.error as Error | undefined
    expect(error?.message).toContain("GET /api/auth/me")
    expect(error?.message).toContain("HTTP 401")
    expect(error?.message).toContain("access denied")
  })

  it("refreshes from stored refresh token and keeps access token in memory only", async () => {
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/refresh")) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
          return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old" })

    const state = await service.refreshFromStorage()

    expect(state.status).toBe("authenticated")
    expect(calls).toEqual([
      expectedApiUrl("/auth/refresh"),
      expectedApiUrl("/auth/me"),
    ])
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-new",
      lastProfile: { user: { email: "u@example.com" } },
    })
    expect(await namespace.getSingleton()).not.toHaveProperty("accessToken")
  })

  it("lists account webhooks from the paginated console endpoint with the authenticated desktop token", async () => {
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/console/webhooks?page=1&pageSize=100")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({
            data: [{ ...webhookFixture("123"), name: "GitHub" }],
            total: 1,
            page: 1,
            pageSize: 100,
          })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    const webhooks = await service.listWebhooks()

    expect(webhooks).toEqual([expect.objectContaining({ publicId: "wh_123", name: "GitHub" })])
    expect(calls).toEqual([
      expectedApiUrl("/auth/desktop/token"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/console/webhooks?page=1&pageSize=100"),
    ])
  })

  it("loads every account webhook page for the desktop selector", async () => {
    const calls: string[] = []
    const firstPage = Array.from({ length: 100 }, (_, index) => webhookFixture(String(index + 1)))
    const secondPage = [webhookFixture("101")]
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/console/webhooks?page=1&pageSize=100")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ data: firstPage, total: 101, page: 1, pageSize: 100 })
        }
        if (String(url).endsWith("/console/webhooks?page=2&pageSize=100")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ data: secondPage, total: 101, page: 2, pageSize: 100 })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    const webhooks = await service.listWebhooks()

    expect(webhooks).toHaveLength(101)
    expect(webhooks.at(-1)).toMatchObject({ publicId: "wh_101" })
    expect(calls).toEqual([
      expectedApiUrl("/auth/desktop/token"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/console/webhooks?page=1&pageSize=100"),
      expectedApiUrl("/console/webhooks?page=2&pageSize=100"),
    ])
  })

  it("creates content store skill drafts with the authenticated desktop token", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push({
          url: String(url),
          method: init?.method ?? "GET",
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/content-store/drafts")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({
            id: "draft-1",
            itemId: "item-1",
            baseVersionId: null,
            revision: 1,
            title: "Local Skill",
            description: null,
            body: null,
            files: [],
            updatedAt: "2026-06-10T00:00:00.000Z",
          })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    await expect(service.createContentStoreSkillDraft({
      type: "skill",
      title: "Local Skill",
      description: null,
      localSourceFingerprint: "f".repeat(64),
      files: [{ path: "SKILL.md", contentBase64: "aGVsbG8=", mimeType: "text/markdown" }],
    })).resolves.toMatchObject({ id: "draft-1", itemId: "item-1", revision: 1 })

    expect(calls).toEqual([
      { url: expectedApiUrl("/auth/desktop/token"), method: "POST", body: expect.any(Object) },
      { url: expectedApiUrl("/auth/me"), method: "GET", body: undefined },
      {
        url: expectedApiUrl("/content-store/drafts"),
        method: "POST",
        body: {
          type: "skill",
          title: "Local Skill",
          description: null,
          localSourceFingerprint: "f".repeat(64),
          files: [{ path: "SKILL.md", contentBase64: "aGVsbG8=", mimeType: "text/markdown" }],
        },
      },
    ])
  })

  it("rejects content store skill draft creation when unauthenticated", async () => {
    const fetch = vi.fn()
    const { service } = await createTestAccountService({ fetch: fetch as typeof fetch })

    await expect(service.createContentStoreSkillDraft({
      type: "skill",
      title: "Local Skill",
      localSourceFingerprint: "f".repeat(64),
      files: [{ path: "SKILL.md", contentBase64: "aGVsbG8=" }],
    })).rejects.toThrow("账号未登录。")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("passes through content store draft validation messages", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/content-store/drafts")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ message: "SKILL.md 是必需文件。", token: "secret-token" }, 400)
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    await expect(service.createContentStoreSkillDraft({
      type: "skill",
      title: "Local Skill",
      localSourceFingerprint: "f".repeat(64),
      files: [{ path: "README.md", contentBase64: "aGVsbG8=" }],
    })).rejects.toThrow(/SKILL\.md 是必需文件/)
  })

  it("calls drive share and preview APIs with the authenticated desktop token", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const shareResult = {
      id: "share-result-1",
      shareId: "share_direct",
      itemId: "item-1",
      enabled: true,
      url: "https://synapse.d2.pub/share/share_direct",
      urlWithPassword: "https://synapse.d2.pub/share/share_direct?password=server-secret",
      passwordEnabled: true,
      password: "SharePw1",
      expiresAt: "2026-06-16T00:00:00.000Z",
      accessMode: "link_read",
      editorEmails: [],
      createdAt: "2026-06-09T00:00:00.000Z",
    }
    const share = {
      id: "share-row-1",
      shareId: "share_public",
      itemId: "item-1",
      itemName: "report.html",
      itemType: "file",
      sourceDeleted: false,
      url: "https://synapse.d2.pub/share/share_public",
      urlWithPassword: "https://synapse.d2.pub/share/share_public?password=server-secret",
      passwordEnabled: true,
      password: "ListPw1",
      expiresAt: "2026-06-16T00:00:00.000Z",
      accessMode: "link_read",
      editorEmails: [],
      createdAt: "2026-06-09T00:00:00.000Z",
    }
    const expectedShareResult = {
      ...shareResult,
      url: `${expectedPublicAppUrl}/share/share_direct`,
      urlWithPassword: `${expectedPublicAppUrl}/share/share_direct?password=SharePw1`,
    }
    const expectedShare = {
      ...share,
      url: `${expectedPublicAppUrl}/share/share_public`,
      urlWithPassword: `${expectedPublicAppUrl}/share/share_public?password=ListPw1`,
    }
    const shareSettings = { passwordEnabled: true, expiresIn: "30d" } as const
    const driveItemDto = driveItem({ id: "item-1", name: "report.html", mimeType: "text/html" })
    const fileVersion = {
      id: "version-1",
      itemId: "item-1",
      versionNumber: 1,
      size: "12",
      mimeType: "text/html",
      source: "upload",
      isCurrent: true,
      isPinned: false,
      deletePending: false,
      restoredFromVersionId: null,
      createdAt: "2026-06-09T00:00:00.000Z",
      createdBy: "user-1",
    }
    const previewSnapshot = {
      context: "owner",
      surface: "standalone",
      current: {
        id: "item-1",
        name: "report.html",
        type: "file",
        size: "12",
        mimeType: "text/html",
        updatedAt: "2026-06-09T00:00:00.000Z",
        previewKind: "html-source",
        browserUrl: `${expectedPublicAppUrl}/drive/items/item-1`,
        downloadUrl: `${expectedPublicAppUrl}/drive/items/item-1/download`,
      },
      breadcrumbs: [],
      children: [],
      childrenPage: { offset: 0, limit: 100, hasMore: false, nextOffset: null },
      preview: {
        kind: "html-source",
        text: "<h1>Report</h1>",
        html: null,
        outline: null,
        truncated: false,
        imageUrl: null,
        visitUrl: `${expectedPublicAppUrl}/drive/items/item-1/render`,
      },
      edit: null,
      canDownload: true,
      canZip: false,
    }
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        const method = init?.method ?? "GET"
        calls.push({
          url: String(url),
          method,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        })
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-1", refreshToken: "refresh-1" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
        if (String(url).endsWith("/drive/items/item-1") && method === "GET") return jsonResponse(driveItemDto)
        if (String(url).endsWith("/drive/browser/owner/items/item-1?surface=standalone")) return jsonResponse(previewSnapshot)
        if (String(url).endsWith("/drive/items/item-1/versions?offset=10&limit=5")) {
          return jsonResponse({
            items: [fileVersion],
            total: 1,
            page: { offset: 10, limit: 5, hasMore: false, nextOffset: null },
          })
        }
        if (String(url).endsWith("/drive/items/item-1/versions/version-1/restore")) return jsonResponse(driveItemDto)
        if (String(url).endsWith("/drive/items/item-1/versions/version-1") && method === "PATCH") {
          return jsonResponse({ ...fileVersion, isPinned: true })
        }
        if (String(url).endsWith("/drive/items/item-1/versions/version-1") && method === "DELETE") return jsonResponse({ ok: true })
        if (String(url).endsWith("/drive/items/item-1/share")) return jsonResponse(shareResult)
        if (String(url).endsWith("/drive/shares")) {
          return jsonResponse({
            items: [share],
            page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
          })
        }
        if (String(url).endsWith("/drive/shares/share-row-1")) return jsonResponse(share)
        if (String(url).endsWith("/drive/items/item-1")) return jsonResponse({ ok: true })
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    await expect(service.getDriveItem("item-1")).resolves.toEqual(driveItemDto)
    await expect(service.getDriveItemPreview({ itemId: "item-1" })).resolves.toEqual(previewSnapshot)
    await expect(service.readDriveFileContent({ itemId: "item-1", maxBytes: 8 })).resolves.toEqual({
      itemId: "item-1",
      name: "report.html",
      kind: "html-source",
      text: "<h1>Repo",
      html: null,
      truncated: true,
    })
    await expect(service.shareDriveItem("item-1", shareSettings)).resolves.toEqual(expectedShareResult)
    await expect(service.listDriveFileVersions("item-1", { offset: 10, limit: 5 })).resolves.toEqual({
      items: [fileVersion],
      total: 1,
      page: { offset: 10, limit: 5, hasMore: false, nextOffset: null },
    })
    await expect(service.restoreDriveFileVersion("item-1", "version-1")).resolves.toEqual(driveItemDto)
    await expect(service.updateDriveFileVersionPin("item-1", "version-1", true)).resolves.toEqual({
      ...fileVersion,
      isPinned: true,
    })
    await expect(service.deleteDriveFileVersion("item-1", "version-1")).resolves.toEqual({ ok: true })
    await expect(service.listDriveShares()).resolves.toEqual({
      items: [expectedShare],
      page: { offset: 0, limit: 20, hasMore: false, nextOffset: null },
    })
    await expect(service.getDriveShare("share-row-1")).resolves.toEqual(expectedShare)
    await expect(service.deleteDriveItem("item-1")).resolves.toEqual({ ok: true })

    expect(calls).toEqual([
      { url: expectedApiUrl("/auth/desktop/token"), method: "POST", body: expect.any(Object) },
      { url: expectedApiUrl("/auth/me"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/browser/owner/items/item-1?surface=standalone"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/browser/owner/items/item-1?surface=standalone"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1/share"), method: "POST", body: shareSettings },
      { url: expectedApiUrl("/drive/items/item-1/versions?offset=10&limit=5"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1/versions/version-1/restore"), method: "POST", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1/versions/version-1"), method: "PATCH", body: { isPinned: true } },
      { url: expectedApiUrl("/drive/items/item-1/versions/version-1"), method: "DELETE", body: undefined },
      { url: expectedApiUrl("/drive/shares"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/shares/share-row-1"), method: "GET", body: undefined },
      {
        url: expectedApiUrl("/drive/items/item-1"),
        method: "DELETE",
        body: undefined,
      },
    ])
  })

  it("builds owner drive item preview URLs from the desktop public app URL", async () => {
    const { service } = await createTestAccountService()

    expect(await service.getDriveItemPreviewUrl("folder/a b")).toEqual({
      url: `${expectedPublicAppUrl.replace(/\/+$/u, "")}/drive/items/folder%2Fa%20b`,
    })
  })

  it("refreshes and retries account webhook list when the access token expires", async () => {
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/desktop/token")) {
          return jsonResponse({ accessToken: "access-old", refreshToken: "refresh-old" })
        }
        if (String(url).endsWith("/auth/me") && calls.filter((item) => item.endsWith("/auth/me")).length === 1) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-old" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/console/webhooks?page=1&pageSize=100") && calls.filter((item) => item.includes("/console/webhooks")).length === 1) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-old" })
          return jsonResponse({ error: "stale access" }, 401)
        }
        if (String(url).endsWith("/auth/refresh")) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
          return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/console/webhooks?page=1&pageSize=100")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse({ data: [], total: 0, page: 1, pageSize: 100 })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    await expect(service.listWebhooks()).resolves.toEqual([])

    expect(calls).toEqual([
      expectedApiUrl("/auth/desktop/token"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/console/webhooks?page=1&pageSize=100"),
      expectedApiUrl("/auth/refresh"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/console/webhooks?page=1&pageSize=100"),
    ])
    expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-new" })
  })

  it("coalesces concurrent stored refreshes into a single token rotation", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return refreshResponse
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const firstRefresh = service.refreshFromStorage()
    const secondRefresh = service.refreshFromStorage()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))

    resolveRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))

    await expect(firstRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })
    await expect(secondRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith("/auth/refresh"))).toHaveLength(1)
    expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-new" })
  })

  it("coalesces concurrent account API refreshes before retrying each request", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const calls: string[] = []
    const fetch = vi.fn(async (url, init) => {
      calls.push(String(url))
      if (String(url).endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return refreshResponse
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      if (String(url).endsWith("/drive/items")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse([driveItem({ id: "drive-1" })])
      }
      if (String(url).endsWith("/drive/usage")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse({ usedBytes: "1", reservedBytes: "0", quotaBytes: "100" })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const items = service.listDriveItems(null)
    const usage = service.getDriveUsage()
    await vi.waitFor(() => {
      expect(calls.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(1)
    })

    resolveRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))

    await expect(items).resolves.toEqual([driveItem({ id: "drive-1" })])
    await expect(usage).resolves.toEqual({ usedBytes: "1", reservedBytes: "0", quotaBytes: "100" })
    expect(calls.filter((url) => url.endsWith("/auth/refresh"))).toHaveLength(1)
    expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-new" })
  })

  it("keeps stored credentials and enters offline when refresh has a network error", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async () => {
        throw new Error("connect ECONNREFUSED")
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const state = await service.refreshFromStorage()

    expect(state).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      offlineReason: "network_error",
      profile: storedProfile,
    })
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-old",
      lastProfile: storedProfile,
    })
  })

  it("keeps stored credentials and enters offline when refresh returns 503", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/auth/refresh")) return jsonResponse({ error: "deploying" }, 503)
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const state = await service.refreshFromStorage()

    expect(state).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      offlineReason: "server_unavailable",
      profile: storedProfile,
    })
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-old",
      lastProfile: storedProfile,
    })
  })

  it("keeps stored credentials and enters offline when refresh is rate limited", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/auth/refresh")) return jsonResponse({ error: "rate limited" }, 429)
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const state = await service.refreshFromStorage()

    expect(state).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      offlineReason: "server_unavailable",
      profile: storedProfile,
    })
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-old",
      lastProfile: storedProfile,
    })
  })

  it("clears stored credentials when refresh returns 401", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/auth/refresh")) return jsonResponse({ message: "expired" }, 401)
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const state = await service.refreshFromStorage()

    expect(state).toEqual({ status: "unauthenticated" })
    expect(await namespace.getSingleton()).not.toHaveProperty("refreshToken")
    expect(await namespace.getSingleton()).not.toHaveProperty("lastProfile")
  })

  it("automatically retries offline refresh and returns online when the server recovers", async () => {
    vi.useFakeTimers()
    const calls: string[] = []
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url, init) => {
        calls.push(String(url))
        if (String(url).endsWith("/auth/refresh") && calls.length === 1) {
          return jsonResponse({ error: "deploying" }, 503)
        }
        if (String(url).endsWith("/auth/refresh")) {
          expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
          return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const offline = await service.refreshFromStorage()
    expect(offline).toMatchObject({ status: "authenticated", connectivity: "offline" })

    await vi.advanceTimersByTimeAsync(10_000)

    await vi.waitFor(() => {
      expect(service.getState()).toMatchObject({ status: "authenticated", connectivity: "online" })
    })
    expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-new" })
  })

  it("clears credentials when offline retry receives an auth failure", async () => {
    vi.useFakeTimers()
    let refreshCount = 0
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          refreshCount += 1
          return refreshCount === 1
            ? jsonResponse({ error: "deploying" }, 503)
            : jsonResponse({ message: "expired" }, 401)
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    await service.refreshFromStorage()
    await vi.advanceTimersByTimeAsync(10_000)

    await vi.waitFor(() => {
      expect(service.getState()).toEqual({ status: "unauthenticated" })
    })
    expect(await namespace.getSingleton()).not.toHaveProperty("refreshToken")
    expect(await namespace.getSingleton()).not.toHaveProperty("lastProfile")
  })

  it("backs off consecutive temporary offline retry failures", async () => {
    vi.useFakeTimers()
    const { namespace, service } = await createTestAccountService({
      fetch: vi.fn(async (url) => {
        if (String(url).endsWith("/auth/refresh")) return jsonResponse({ error: "deploying" }, 503)
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const first = await service.refreshFromStorage()
    expect(first).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      retry: { attempt: 0 },
    })

    await vi.advanceTimersByTimeAsync(10_000)
    expect(service.getState()).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      retry: { attempt: 1 },
    })

    await vi.advanceTimersByTimeAsync(29_999)
    expect((service.getState() as { retry?: { attempt: number } }).retry?.attempt).toBe(1)

    await vi.advanceTimersByTimeAsync(1)
    expect(service.getState()).toMatchObject({
      status: "authenticated",
      connectivity: "offline",
      retry: { attempt: 2 },
    })
  })

  it("logs refresh and logout success without leaking tokens", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          return jsonResponse({ accessToken: "secret-access", refreshToken: "secret-refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        if (String(url).endsWith("/auth/logout")) return jsonResponse({})
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "secret-refresh-old" })

    await service.refreshFromStorage()
    await service.logout()

    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account refreshed from storage.", {
      operation: "refreshFromStorage",
      status: "authenticated",
      userId: "u1",
      teamCount: 0,
    })
    expect(accountLogger.info).toHaveBeenCalledWith("Desktop account logged out.", {
      operation: "logout",
      status: "success",
      hadRefreshToken: true,
    })
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-access")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-refresh-old")
    expect(JSON.stringify(accountLogger.info.mock.calls)).not.toContain("secret-refresh-new")
  })

  it("does not report logged out when local credential cleanup fails", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/logout")) return jsonResponse({})
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })
    vi.spyOn(namespace, "clearSingleton").mockRejectedValueOnce(new Error("disk locked"))

    const state = await service.logout()

    expect(state).toEqual({
      status: "error",
      message: "退出登录失败，请重试。",
      profile: storedProfile,
    })
    expect(await namespace.getSingleton()).toMatchObject({ refreshToken: "refresh-old" })
    expect(accountLogger.warn).toHaveBeenCalledWith("Failed to clear stored account.", {
      error: expect.any(Error),
    })
    expect(accountLogger.info).not.toHaveBeenCalledWith("Desktop account logged out.", expect.anything())
  })

  it("clears an active login attempt when logout cancels browser authentication", async () => {
    const { namespace, service } = await createTestAccountService()

    const started = await service.startLogin()
    expect(started.state.status).toBe("authenticating")
    expect((await namespace.getSingleton())?.activeAttempt).toBeTruthy()

    const state = await service.logout()

    expect(state).toEqual({ status: "unauthenticated" })
    expect(await namespace.getSingleton()).toBeNull()
  })

  it("ignores callbacks for a login attempt cancelled by logout", async () => {
    const fetch = vi.fn()
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.logout()

    const state = await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    expect(state).toEqual({ status: "unauthenticated" })
    expect(service.getState()).toEqual({ status: "unauthenticated" })
    expect(await namespace.getSingleton()).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it("keeps active login state when refresh finds an attempt without a token", async () => {
    const { service } = await createTestAccountService()

    const started = await service.startLogin()
    const state = await service.refreshFromStorage()

    expect(started.state.status).toBe("authenticating")
    expect(state).toEqual(started.state)
  })

  it("keeps newer login attempts when stored refresh fails", async () => {
    let rejectRefresh: ((error: Error) => void) | undefined
    const refreshResponse = new Promise<Response>((_resolve, reject) => {
      rejectRefresh = reject
    })
    const fetch = vi.fn((url) => {
      if (String(url).endsWith("/auth/refresh")) return refreshResponse
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const refresh = service.refreshFromStorage()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    rejectRefresh?.(new Error("expired refresh token"))
    const state = await refresh

    expect(state.status).toBe("authenticating")
    const persisted = await namespace.getSingleton()
    expect(persisted).toMatchObject({
      activeAttempt: { state: attempt!.state },
      refreshToken: "refresh-old",
      lastProfile: storedProfile,
    })
  })

  it("shares a single in-flight refresh between concurrent refresh callers", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    let refreshCalls = 0
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCalls += 1
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return refreshResponse
      }
      if (String(url).endsWith("/auth/me")) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const olderRefresh = service.refreshFromStorage()
    await vi.waitFor(() => expect(refreshCalls).toBe(1))
    const newerRefresh = service.refreshFromStorage()

    resolveRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    await expect(newerRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })
    await expect(olderRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })

    expect(refreshCalls).toBe(1)
    expect(service.getState()).toMatchObject({ status: "authenticated", connectivity: "online" })
    expect(service.getAccessTokenForLive()).toBe("access-new")
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-new",
      lastProfile: { user: { email: "u@example.com" } },
    })
  })

  it("keeps newer login state after an expired callback and queued new login overlap", async () => {
    const fetch = vi.fn()
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    const originalSetSingleton = namespace.setSingleton.bind(namespace)
    let resolveClearStarted: (() => void) | undefined
    let resolveClear: (() => void) | undefined
    const clearStarted = new Promise<void>((resolve) => {
      resolveClearStarted = resolve
    })
    const clearGate = new Promise<void>((resolve) => {
      resolveClear = resolve
    })
    await namespace.setSingleton({
      activeAttempt: {
        state: "expired-state",
        codeVerifier: "expired-code-verifier",
        apiBaseUrl: expectedApiBaseUrl,
        createdAt: "2026-05-28T00:00:00.000Z",
        expiresAt: "2026-05-28T00:00:01.000Z",
      },
    })
    vi.spyOn(namespace, "setSingleton").mockImplementation(async (value) => {
      if (!value?.activeAttempt) {
        resolveClearStarted?.()
        await clearGate
      }
      return originalSetSingleton(value)
    })

    const expiredCallback = service.handleAuthCallback("synapse://auth/desktop/callback?code=code-1&state=expired-state")
    await clearStarted
    const started = service.startLogin()
    resolveClear?.()
    await expiredCallback
    const loginResult = await started

    expect(service.getState()).toEqual(loginResult.state)
    expect(loginResult.state.status).toBe("authenticating")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("does not restore credentials when logout wins an in-flight refresh", async () => {
    let resolveRefresh: ((response: Response) => void) | undefined
    const refreshResponse = new Promise<Response>((resolve) => {
      resolveRefresh = resolve
    })
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/auth/refresh")) return refreshResponse
      if (String(url).endsWith("/auth/logout")) return jsonResponse({})
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const refresh = service.refreshFromStorage()
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expectedApiUrl("/auth/refresh"),
      expect.any(Object),
    ))
    await service.logout()
    resolveRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    const state = await refresh

    expect(state.status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(expectedApiUrl("/auth/me"))
  })

  it("does not restore credentials when logout happens during the refresh commit", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
      }
      if (String(url).endsWith("/auth/logout")) return jsonResponse({})
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    const originalSetSingleton = namespace.setSingleton.bind(namespace)
    let resolveCommitStarted: (() => void) | undefined
    let resolveCommit: (() => void) | undefined
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    const commitGate = new Promise<void>((resolve) => {
      resolveCommit = resolve
    })
    vi.spyOn(namespace, "setSingleton").mockImplementation(async (value) => {
      if (value?.refreshToken === "refresh-new") {
        resolveCommitStarted?.()
        await commitGate
      }
      return originalSetSingleton(value)
    })
    await namespace.setSingleton({ refreshToken: "refresh-old", lastProfile: storedProfile })

    const refresh = service.refreshFromStorage()
    await commitStarted
    const logout = service.logout()
    resolveCommit?.()
    await Promise.all([refresh, logout])

    expect(service.getState().status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
  })

  it("does not restore credentials when logout wins an in-flight callback", async () => {
    let resolveExchange: ((response: Response) => void) | undefined
    const exchangeResponse = new Promise<Response>((resolve) => {
      resolveExchange = resolve
    })
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/auth/desktop/token")) return exchangeResponse
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const callback = service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith(
      expectedApiUrl("/auth/desktop/token"),
      expect.any(Object),
    ))
    await service.logout()
    resolveExchange?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    const state = await callback

    expect(state.status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain(expectedApiUrl("/auth/me"))
  })

  it("does not restore credentials when logout happens during the callback commit", async () => {
    const fetch = vi.fn(async (url) => {
      if (String(url).endsWith("/auth/desktop/token")) {
        return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
      }
      if (String(url).endsWith("/auth/logout")) return jsonResponse({})
      if (String(url).endsWith("/auth/me")) {
        return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
      }
      throw new Error(`unexpected url ${String(url)}`)
    })
    const { namespace, service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    const originalSetSingleton = namespace.setSingleton.bind(namespace)
    let resolveCommitStarted: (() => void) | undefined
    let resolveCommit: (() => void) | undefined
    const commitStarted = new Promise<void>((resolve) => {
      resolveCommitStarted = resolve
    })
    const commitGate = new Promise<void>((resolve) => {
      resolveCommit = resolve
    })
    vi.spyOn(namespace, "setSingleton").mockImplementation(async (value) => {
      if (value?.refreshToken === "refresh-new") {
        resolveCommitStarted?.()
        await commitGate
      }
      return originalSetSingleton(value)
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()

    const callback = service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)
    await commitStarted
    const logout = service.logout()
    resolveCommit?.()
    await Promise.all([callback, logout])

    expect(service.getState().status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
  })

  it("merges refreshed account data with newer persisted fields", async () => {
    let namespaceUpdatedDuringRefresh = false
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url) => {
        if (String(url).endsWith("/auth/refresh")) {
          return jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" })
        }
        if (String(url).endsWith("/auth/me")) {
          if (!namespaceUpdatedDuringRefresh) {
            namespaceUpdatedDuringRefresh = true
            await namespace.setSingleton({
              refreshToken: "refresh-old",
              activeAttempt: {
                state: "newer-state",
                codeVerifier: "newer-code-verifier",
                apiBaseUrl: expectedApiBaseUrl,
                createdAt: "2026-05-28T00:00:00.000Z",
                expiresAt: "2026-05-28T00:10:00.000Z",
              },
            })
          }
          return jsonResponse({ user: { id: "u1", email: "u@example.com", status: "active" }, teams: [] })
        }
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await namespace.setSingleton({ refreshToken: "refresh-old" })

    const state = await service.refreshFromStorage()

    expect(state.status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-new",
      activeAttempt: { state: "newer-state" },
      lastProfile: { user: { email: "u@example.com" } },
    })
  })

  it("returns unauthenticated when encryption is unavailable", async () => {
    const { service } = await createTestAccountService({
      safeStorage: makeFakeSafeStorage(false),
    })

    const state = await service.refreshFromStorage()

    expect(state).toEqual({ status: "unauthenticated" })
  })
})

function driveItem(overrides: Partial<DriveItemDto> = {}): DriveItemDto {
  return {
    id: overrides.id ?? "item-1",
    parentId: overrides.parentId ?? null,
    type: overrides.type ?? "file",
    name: overrides.name ?? "report.txt",
    size: overrides.size ?? "0",
    mimeType: overrides.mimeType ?? null,
    storageStatus: overrides.storageStatus ?? "active",
    shared: overrides.shared ?? false,
    activeShareId: overrides.activeShareId ?? null,
    createdAt: overrides.createdAt ?? "2026-06-09T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-09T00:00:00.000Z",
  }
}

function drivePublicAsset(overrides: Partial<DrivePublicAssetDto> = {}): DrivePublicAssetDto {
  return {
    assetId: overrides.assetId ?? "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
    itemId: overrides.itemId ?? "item-public-asset-1",
    name: overrides.name ?? "logo.png",
    size: overrides.size ?? "5",
    mimeType: overrides.mimeType ?? "image/png",
    url: overrides.url ?? `${expectedPublicAppUrl}/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ`,
    lifecycleStatus: overrides.lifecycleStatus ?? "active",
    accessCount: overrides.accessCount ?? "0",
    responseBytes: overrides.responseBytes ?? "0",
    lastAccessedAt: overrides.lastAccessedAt ?? null,
    createdAt: overrides.createdAt ?? "2026-06-09T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-09T00:00:00.000Z",
  }
}

function driveDocumentImageSources(overrides: Partial<DriveDocumentImageSourcesDto> = {}): DriveDocumentImageSourcesDto {
  return {
    itemId: overrides.itemId ?? "item-1",
    versionId: overrides.versionId ?? "version-1",
    canImport: overrides.canImport ?? true,
    sources: overrides.sources ?? [{
      id: "source-1",
      imageKey: "external:https://example.test/logo.png",
      src: "https://example.test/logo.png",
      kind: "external",
      occurrenceCount: 1,
      canImport: true,
      status: "ready",
    }],
    summary: overrides.summary ?? {
      total: 1,
      ownerAsset: 0,
      collaboratorAsset: 0,
      external: 1,
      invalid: 0,
      unsupported: 0,
      importable: 1,
    },
  }
}

function driveDocumentImageImportResult(overrides: Partial<DriveDocumentImageImportResult> = {}): DriveDocumentImageImportResult {
  return {
    itemId: overrides.itemId ?? "item-1",
    versionId: overrides.versionId ?? "version-2",
    imported: overrides.imported ?? [{
      previousSrc: "https://example.test/logo.png",
      nextSrc: `${expectedPublicAppUrl}/files/asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ`,
      assetId: "asset_4Fz8kQ2mNv7RbP6xAa91Lc0Dm7Tn5YuZ",
      size: "5",
    }],
    failed: overrides.failed ?? [],
    summary: overrides.summary ?? {
      importedCount: 1,
      failedCount: 0,
      replacedOccurrenceCount: 1,
    },
  }
}

function driveSite(overrides: Partial<DriveSiteDto> = {}): DriveSiteDto {
  return {
    id: overrides.id ?? "site-row-1",
    siteId: overrides.siteId ?? "site_abc",
    name: overrides.name ?? "产品原型",
    status: overrides.status ?? "active",
    accessMode: overrides.accessMode ?? "public",
    url: overrides.url ?? `${expectedPublicAppUrl}/sites/site_abc/`,
    urlWithPassword: overrides.urlWithPassword ?? `${expectedPublicAppUrl}/sites/site_abc/`,
    passwordEnabled: overrides.passwordEnabled ?? false,
    password: overrides.password ?? null,
    expiresAt: overrides.expiresAt ?? null,
    sourceFolderItemId: overrides.sourceFolderItemId ?? "folder-1",
    sourceFolderName: overrides.sourceFolderName ?? "产品原型",
    entryPath: overrides.entryPath ?? "index.html",
    fileCount: overrides.fileCount ?? 3,
    totalBytes: overrides.totalBytes ?? "128",
    createdAt: overrides.createdAt ?? "2026-06-23T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-06-23T00:00:00.000Z",
    lastPublishedAt: overrides.lastPublishedAt ?? "2026-06-23T00:00:00.000Z",
  }
}

function preparedFile(sessionId: string, url: string): DriveUploadPrepareResult {
  return {
    item: driveItem({ id: sessionId, name: `${sessionId}.txt`, size: "1" }),
    sessionId,
    upload: {
      expiresAt: "2026-06-09T00:10:00.000Z",
      headers: {},
      method: "PUT",
      url,
    },
  }
}

function preparedFolderEntry(relativePath: string, sessionId: string, url: string) {
  return {
    relativePath,
    sessionId,
    item: driveItem({ id: sessionId, name: path.basename(relativePath), size: "1" }),
    upload: {
      expiresAt: "2026-06-09T00:10:00.000Z",
      headers: {},
      method: "PUT" as const,
      url,
    },
  }
}
