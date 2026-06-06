import { mkdtemp } from "node:fs/promises"
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
        apiBaseUrl: "http://localhost:3000/api",
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
      apiMode: "development",
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
      "http://localhost:3000/api/auth/desktop/token",
      "http://localhost:3000/api/auth/refresh",
      "http://localhost:3000/api/auth/me",
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
      "http://localhost:3000/api/auth/desktop/token",
      "http://localhost:3000/api/auth/me",
      "http://localhost:3000/api/auth/refresh",
      "http://localhost:3000/api/auth/me",
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
      "http://localhost:3000/api/auth/refresh",
      "http://localhost:3000/api/auth/me",
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
      "http://localhost:3000/api/auth/desktop/token",
      "http://localhost:3000/api/auth/me",
      "http://localhost:3000/api/dashboard/webhooks",
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
      "http://localhost:3000/api/auth/desktop/token",
      "http://localhost:3000/api/auth/me",
      "http://localhost:3000/api/dashboard/webhooks",
      "http://localhost:3000/api/auth/refresh",
      "http://localhost:3000/api/auth/me",
      "http://localhost:3000/api/dashboard/webhooks",
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
        apiBaseUrl: "http://localhost:3000/api",
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
      "http://localhost:3000/api/auth/refresh",
      expect.any(Object),
    ))
    await service.logout()
    resolveRefresh?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    const state = await refresh

    expect(state.status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain("http://localhost:3000/api/auth/me")
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
      "http://localhost:3000/api/auth/desktop/token",
      expect.any(Object),
    ))
    await service.logout()
    resolveExchange?.(jsonResponse({ accessToken: "access-new", refreshToken: "refresh-new" }))
    const state = await callback

    expect(state.status).toBe("unauthenticated")
    expect(await namespace.getSingleton()).toBeNull()
    expect(fetch.mock.calls.map(([url]) => String(url))).not.toContain("http://localhost:3000/api/auth/me")
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
                apiBaseUrl: "http://localhost:3000/api",
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
