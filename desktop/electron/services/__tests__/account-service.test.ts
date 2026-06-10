import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
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
import type { DriveItemDto, DriveUploadPrepareResult } from "@synapse/shared"
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
    expect(loginUrl.pathname).toBe("/dashboard/auth/desktop")
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
          return jsonResponse({ error: "code expired", token: "secret-response-token" }, 400)
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

  it("lists account webhooks with the authenticated desktop token", async () => {
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
        if (String(url).endsWith("/dashboard/webhooks")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-1" })
          return jsonResponse([{
            id: "webhook-1",
            publicId: "wh_123",
            name: "GitHub",
            enabled: true,
            maskedUrl: "https://synapse.test/webhooks/wh_123/***",
            createdAt: "2026-06-06T10:00:00.000Z",
            updatedAt: "2026-06-06T10:00:00.000Z",
          }])
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
      expectedApiUrl("/dashboard/webhooks"),
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

  it("calls drive publication, share list, and delete impact APIs with the authenticated desktop token", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = []
    const publication = {
      id: "pub-row-1",
      publishId: "pub_public",
      type: "page",
      name: "report.html",
      status: "active",
      sourceItemId: "item-1",
      sourceDeleted: false,
      url: "https://synapse.d2.pub/pages/pub_public",
      urlWithPassword: "https://synapse.d2.pub/pages/pub_public?password=server-secret",
      passwordEnabled: true,
      password: "AbC234xy",
      expiresAt: "2026-06-16T00:00:00.000Z",
      currentDeploymentId: "dep-1",
      createdAt: "2026-06-09T00:00:00.000Z",
      updatedAt: "2026-06-09T00:00:00.000Z",
    }
    const shareResult = {
      id: "share-result-1",
      shareId: "share_direct",
      itemId: "item-1",
      enabled: true,
      url: "https://synapse.d2.pub/files/share_direct",
      urlWithPassword: "https://synapse.d2.pub/files/share_direct?password=server-secret",
      passwordEnabled: true,
      password: "SharePw1",
      expiresAt: "2026-06-16T00:00:00.000Z",
      createdAt: "2026-06-09T00:00:00.000Z",
    }
    const share = {
      id: "share-row-1",
      shareId: "share_public",
      itemId: "item-1",
      itemName: "report.html",
      itemType: "file",
      sourceDeleted: false,
      url: "https://synapse.d2.pub/files/share_public",
      urlWithPassword: "https://synapse.d2.pub/files/share_public?password=server-secret",
      passwordEnabled: true,
      password: "ListPw1",
      expiresAt: "2026-06-16T00:00:00.000Z",
      createdAt: "2026-06-09T00:00:00.000Z",
    }
    const expectedPagePublication = {
      ...publication,
      url: `${expectedPublicAppUrl}/pages/pub_public`,
      urlWithPassword: `${expectedPublicAppUrl}/pages/pub_public?password=AbC234xy`,
    }
    const expectedSitePublication = {
      ...publication,
      type: "site",
      url: `${expectedPublicAppUrl}/sites/pub_public/`,
      urlWithPassword: `${expectedPublicAppUrl}/sites/pub_public/?password=AbC234xy`,
    }
    const expectedShareResult = {
      ...shareResult,
      url: `${expectedPublicAppUrl}/files/share_direct`,
      urlWithPassword: `${expectedPublicAppUrl}/files/share_direct?password=SharePw1`,
    }
    const expectedShare = {
      ...share,
      url: `${expectedPublicAppUrl}/files/share_public`,
      urlWithPassword: `${expectedPublicAppUrl}/files/share_public?password=ListPw1`,
    }
    const shareSettings = { passwordEnabled: true, expiresIn: "30d" } as const
    const pageSettings = { passwordEnabled: true, expiresIn: "1y" } as const
    const siteSettings = { passwordEnabled: false, expiresIn: "forever" } as const
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
        if (String(url).endsWith("/drive/publications")) return jsonResponse([publication])
        if (String(url).endsWith("/drive/items/item-1/share")) return jsonResponse(shareResult)
        if (String(url).endsWith("/drive/items/item-1/publications/page")) return jsonResponse(publication)
        if (String(url).endsWith("/drive/items/folder-1/publications/site")) return jsonResponse({ ...publication, type: "site" })
        if (String(url).endsWith("/drive/publications/pub-row-1/redeploy")) return jsonResponse(publication)
        if (String(url).endsWith("/drive/publications/pub-row-1")) return jsonResponse({ ok: true })
        if (String(url).endsWith("/drive/items/item-1/delete-impact")) return jsonResponse({ publications: [publication] })
        if (String(url).endsWith("/drive/shares")) return jsonResponse([share])
        if (String(url).endsWith("/drive/items/item-1")) return jsonResponse({ ok: true })
        throw new Error(`unexpected url ${String(url)}`)
      }) as typeof fetch,
    })
    await service.startLogin()
    const attempt = (await namespace.getSingleton())?.activeAttempt
    expect(attempt).toBeTruthy()
    await service.handleAuthCallback(`synapse://auth/desktop/callback?code=code-1&state=${attempt!.state}`)

    await expect(service.listDrivePublications()).resolves.toEqual([expectedPagePublication])
    await expect(service.shareDriveItem("item-1", shareSettings)).resolves.toEqual(expectedShareResult)
    await expect(service.publishDrivePage("item-1", pageSettings)).resolves.toEqual(expectedPagePublication)
    await expect(service.publishDriveSite("folder-1", siteSettings)).resolves.toEqual(expectedSitePublication)
    await expect(service.redeployDrivePublication("pub-row-1")).resolves.toEqual(expectedPagePublication)
    await expect(service.disableDrivePublication("pub-row-1")).resolves.toEqual({ ok: true })
    await expect(service.getDriveDeleteImpact("item-1")).resolves.toEqual({ publications: [expectedPagePublication] })
    await expect(service.listDriveShares()).resolves.toEqual([expectedShare])
    await expect(service.deleteDriveItem("item-1", { disablePublications: true })).resolves.toEqual({ ok: true })

    expect(calls).toEqual([
      { url: expectedApiUrl("/auth/desktop/token"), method: "POST", body: expect.any(Object) },
      { url: expectedApiUrl("/auth/me"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/publications"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1/share"), method: "POST", body: shareSettings },
      { url: expectedApiUrl("/drive/items/item-1/publications/page"), method: "POST", body: pageSettings },
      { url: expectedApiUrl("/drive/items/folder-1/publications/site"), method: "POST", body: siteSettings },
      { url: expectedApiUrl("/drive/publications/pub-row-1/redeploy"), method: "POST", body: undefined },
      { url: expectedApiUrl("/drive/publications/pub-row-1"), method: "DELETE", body: undefined },
      { url: expectedApiUrl("/drive/items/item-1/delete-impact"), method: "GET", body: undefined },
      { url: expectedApiUrl("/drive/shares"), method: "GET", body: undefined },
      {
        url: expectedApiUrl("/drive/items/item-1"),
        method: "DELETE",
        body: { disablePublications: true },
      },
    ])
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
        if (String(url).endsWith("/dashboard/webhooks") && calls.filter((item) => item.endsWith("/dashboard/webhooks")).length === 1) {
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
        if (String(url).endsWith("/dashboard/webhooks")) {
          expect(init?.headers).toMatchObject({ Authorization: "Bearer access-new" })
          return jsonResponse([])
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
      expectedApiUrl("/dashboard/webhooks"),
      expectedApiUrl("/auth/refresh"),
      expectedApiUrl("/auth/me"),
      expectedApiUrl("/dashboard/webhooks"),
    ])
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

  it("keeps a newer successful refresh when an older concurrent refresh fails", async () => {
    let rejectFirstRefresh: ((error: Error) => void) | undefined
    let resolveSecondRefresh: ((response: Response) => void) | undefined
    const firstRefresh = new Promise<Response>((_resolve, reject) => {
      rejectFirstRefresh = reject
    })
    const secondRefresh = new Promise<Response>((resolve) => {
      resolveSecondRefresh = resolve
    })
    let refreshCalls = 0
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/refresh")) {
        refreshCalls += 1
        expect(JSON.parse(String(init?.body))).toEqual({ refreshToken: "refresh-old" })
        return refreshCalls === 1 ? firstRefresh : secondRefresh
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
    await vi.waitFor(() => expect(refreshCalls).toBe(2))

    resolveSecondRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    await expect(newerRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })

    rejectFirstRefresh?.(new Error("expired refresh token"))
    await expect(olderRefresh).resolves.toMatchObject({ status: "authenticated", connectivity: "online" })

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
