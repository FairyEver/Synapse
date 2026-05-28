import { mkdtemp } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

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
  user: { id: "u1", email: "u@example.com", status: "active" },
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
  it("starts login by persisting an attempt and opening the browser", async () => {
    const { namespace, openExternal, service } = await createTestAccountService()
    const result = await service.startLogin()

    expect(result.state.status).toBe("authenticating")
    expect(result.loginUrl).toContain("client=desktop")
    expect(result.loginUrl).toContain("state=")
    expect(openExternal).toHaveBeenCalledWith(result.loginUrl)
    expect(await namespace.getSingleton()).toMatchObject({
      activeAttempt: { state: expect.any(String), apiBaseUrl: "http://localhost:3000/api" },
    })
  })

  it("exchanges protocol callback, stores refresh token, and loads me", async () => {
    const { namespace, service } = await createTestAccountService({
      fetch: (async (url, init) => {
        if (String(url).endsWith("/auth/desktop/exchange")) {
          expect(init?.method).toBe("POST")
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

    const state = await service.handleAuthCallback(`synapse://auth/callback?code=code-1&state=${attempt!.state}`)

    if (state.status !== "authenticated") {
      throw new Error("expected authenticated account state")
    }
    expect(state.profile.user.email).toBe("u@example.com")
    expect((await namespace.getSingleton())?.refreshToken).toBe("refresh-1")
    expect((await namespace.getSingleton())?.activeAttempt).toBeUndefined()
  })

  it("rejects state mismatch without exchanging", async () => {
    const fetch = vi.fn()
    const { service } = await createTestAccountService({ fetch: fetch as typeof fetch })
    await service.startLogin()

    const state = await service.handleAuthCallback("synapse://auth/callback?code=code-1&state=wrong")

    expect(state.status).toBe("error")
    expect(fetch).not.toHaveBeenCalled()
  })

  it("preserves newer login attempts when an older callback arrives", async () => {
    const fetch = vi.fn(async (url, init) => {
      if (String(url).endsWith("/auth/desktop/exchange")) {
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
      `synapse://auth/callback?code=code-1&state=${firstAttempt!.state}`,
    )

    expect(firstState.status).toBe("error")
    expect(fetch).not.toHaveBeenCalled()
    expect((await namespace.getSingleton())?.activeAttempt?.state).toBe(secondAttempt!.state)

    const secondState = await service.handleAuthCallback(
      `synapse://auth/callback?code=code-2&state=${secondAttempt!.state}`,
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
        if (String(url).endsWith("/auth/desktop/exchange")) {
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

    const state = await service.handleAuthCallback(`synapse://auth/callback?code=code-1&state=${attempt!.state}`)

    expect(state.status).toBe("authenticated")
    expect(calls).toEqual([
      "http://localhost:3000/api/auth/desktop/exchange",
      "http://localhost:3000/api/auth/me",
      "http://localhost:3000/api/auth/refresh",
      "http://localhost:3000/api/auth/me",
    ])
    expect(await namespace.getSingleton()).toMatchObject({
      refreshToken: "refresh-2",
      lastProfile: { user: { email: "u@example.com" } },
    })
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
      lastProfile: storedProfile,
    })
    expect(persisted).not.toHaveProperty("refreshToken")
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

    expect(state.status).toBe("authenticated")
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
