import { randomBytes } from "node:crypto"
import path from "node:path"
import { app, safeStorage, shell } from "electron"

import type { SynapseAccountProfile, SynapseAccountState } from "../../src/types/account"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.account")
const CORE_ACCOUNT_NAMESPACE = "core.account"
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const PROD_API_BASE_URL = "https://synapse.d2.pub/api"
const DEV_API_BASE_URL = "http://localhost:3000/api"

type PersistedAccount = Record<string, unknown> & {
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

type AccountServiceDeps = {
  namespace?: EncryptedJsonNamespace<PersistedAccount>
  fetch?: typeof fetch
  openExternal?: (url: string) => Promise<void>
  isPackaged?: boolean
}

function createState(): string {
  return randomBytes(32).toString("base64url")
}

function apiBaseUrl(isPackaged: boolean): string {
  return isPackaged ? PROD_API_BASE_URL : DEV_API_BASE_URL
}

function dashboardLoginUrl(baseUrl: string, state: string): string {
  const origin = baseUrl.replace(/\/api\/?$/u, "")
  const query = new URLSearchParams({ client: "desktop", state })
  return `${origin}/dashboard/login?${query.toString()}`
}

function createNamespace(): EncryptedJsonNamespace<PersistedAccount> {
  return new EncryptedJsonNamespace<PersistedAccount>({
    name: CORE_ACCOUNT_NAMESPACE,
    schemaVersion: 1,
    backend: "encrypted-json",
    filePath: path.join(app.getPath("userData"), "data-v1", `${CORE_ACCOUNT_NAMESPACE}.bin`),
    safeStorage,
  })
}

export class AccountService {
  private readonly namespace: EncryptedJsonNamespace<PersistedAccount>
  private readonly fetchImpl: typeof fetch
  private readonly openExternal: (url: string) => Promise<void>
  private readonly isPackaged: boolean
  private accessToken: string | null = null
  private eventBus: EventBus | null = null
  private state: SynapseAccountState = { status: "unauthenticated" }
  private listeners = new Set<(state: SynapseAccountState) => void>()
  private authRevision = 0
  private storageMutationQueue: Promise<void> = Promise.resolve()

  constructor(deps: AccountServiceDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis)
    this.openExternal = deps.openExternal ?? shell.openExternal
    this.isPackaged = deps.isPackaged ?? app.isPackaged
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  onStateChanged(listener: (state: SynapseAccountState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): SynapseAccountState {
    return this.state
  }

  async startLogin(): Promise<{ state: SynapseAccountState; loginUrl: string }> {
    const baseUrl = apiBaseUrl(this.isPackaged)
    const state = createState()
    const now = new Date()
    const attempt = {
      state,
      apiBaseUrl: baseUrl,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString(),
    }
    const loginUrl = dashboardLoginUrl(baseUrl, state)
    const revision = this.bumpAuthRevision()

    try {
      await this.runStorageMutation(async () => {
        if (this.authRevision !== revision) return
        const current = await this.namespace.getSingleton()
        await this.namespace.setSingleton({ ...(current ?? {}), activeAttempt: attempt })
      })
      if (this.authRevision !== revision) return { state: this.state, loginUrl }
      this.setState({ status: "authenticating", loginUrl })
      await this.openExternal(loginUrl)
    } catch (error) {
      logger.warn("Failed to start desktop account login.", { error })
      this.setState({ status: "error", message: "无法保存登录状态。" })
    }

    return { state: this.state, loginUrl }
  }

  async handleAuthCallback(rawUrl: string): Promise<SynapseAccountState> {
    let parsed: URL
    try {
      parsed = new URL(rawUrl)
    } catch (error) {
      logger.warn("Ignored malformed account auth callback.", { error })
      const persisted = await this.readPersisted("Failed to read stored account for malformed auth callback.")
      if (persisted?.activeAttempt) return this.state
      this.setInvalidCallbackState(persisted)
      return this.state
    }

    if (parsed.protocol !== "synapse:" || parsed.hostname !== "auth" || parsed.pathname !== "/callback") {
      logger.warn("Ignored unknown account auth callback.", {
        protocol: parsed.protocol,
        host: parsed.hostname,
        pathname: parsed.pathname,
      })
      return this.state
    }

    const code = parsed.searchParams.get("code")?.trim()
    const callbackState = parsed.searchParams.get("state")?.trim()
    const persisted = await this.readPersisted("Failed to read stored account for auth callback.")
    const attempt = persisted?.activeAttempt

    if (!code || !callbackState || !attempt || attempt.state !== callbackState) {
      if (callbackState && this.hasDifferentActiveAttempt(persisted, callbackState)) return this.state
      this.setState({
        status: "error",
        message: "登录已失效，请重试。",
        profile: persisted?.lastProfile,
      })
      return this.state
    }

    if (new Date(attempt.expiresAt).getTime() <= Date.now()) {
      await this.clearActiveAttemptIfState(callbackState)
      const latest = await this.readPersisted("Failed to read stored account after clearing expired auth callback.")
      if (this.hasDifferentActiveAttempt(latest, callbackState)) return this.state
      this.setState({
        status: "error",
        message: "登录已失效，请重试。",
        profile: latest?.lastProfile ?? persisted?.lastProfile,
      })
      return this.state
    }

    let tokens: { accessToken: string; refreshToken: string }
    try {
      tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
        `${attempt.apiBaseUrl}/auth/desktop/exchange`,
        { code, state: callbackState },
      )
    } catch (error) {
      logger.warn("Desktop account callback exchange failed.", { error })
      this.accessToken = null
      await this.clearActiveAttemptIfState(callbackState)
      const latest = await this.readPersisted("Failed to read stored account after account callback exchange failed.")
      if (this.hasDifferentActiveAttempt(latest, callbackState)) return this.state
      this.setState({
        status: "error",
        message: "登录失败，请重试。",
        profile: persisted?.lastProfile,
      })
      return this.state
    }

    this.accessToken = tokens.accessToken
    try {
      const currentBeforeProfile = await this.readPersisted(
        "Failed to read stored account before loading callback account profile.",
      )
      if (currentBeforeProfile?.activeAttempt?.state !== callbackState) {
        this.accessToken = null
        return this.state
      }
      const revision = this.authRevision
      const profile = await this.loadMe(attempt.apiBaseUrl)
      const committed = await this.writeAccountPatchIfAttemptCurrent(
        revision,
        callbackState,
        { refreshToken: tokens.refreshToken, lastProfile: profile },
        { clearAttemptState: callbackState },
      )
      if (!committed) {
        this.accessToken = null
        return this.state
      }
      this.setState({ status: "authenticated", profile })
    } catch (error) {
      logger.warn("Desktop account profile load failed after exchange; retrying refresh.", { error })
      this.accessToken = null
      const revision = this.authRevision
      const storedExchangeToken = await this.writeAccountPatchIfAttemptCurrent(
        revision,
        callbackState,
        { refreshToken: tokens.refreshToken },
        { clearAttemptState: callbackState },
      ).catch((writeError) => {
        logger.warn("Failed to store refresh token after account exchange.", { error: writeError })
        return null
      })
      if (!storedExchangeToken) return this.state
      try {
        const refreshed = await this.refreshWithToken(attempt.apiBaseUrl, tokens.refreshToken)
        const committed = await this.writeAccountPatchIfRefreshTokenCurrent(
          revision,
          tokens.refreshToken,
          { refreshToken: refreshed.refreshToken, lastProfile: refreshed.profile },
        )
        if (!committed) {
          this.accessToken = null
          return this.state
        }
        if (committed.activeAttempt) return this.state
        this.setState({ status: "authenticated", profile: refreshed.profile })
      } catch (refreshError) {
        logger.warn("Desktop account callback refresh recovery failed.", { error: refreshError })
        this.accessToken = null
        const beforeClear = await this.readPersisted(
          "Failed to read stored account before clearing failed callback refresh token.",
        )
        await this.clearStoredRefreshTokenIfCurrent(tokens.refreshToken)
        if (beforeClear?.refreshToken !== tokens.refreshToken) return this.state
        const latest = await this.readPersisted("Failed to read stored account after account callback recovery failed.")
        if (this.hasDifferentActiveAttempt(latest, callbackState)) return this.state
        this.setState({
          status: "error",
          message: "登录失败，请重试。",
          profile: latest?.lastProfile ?? persisted?.lastProfile,
        })
      }
    }

    return this.state
  }

  async refreshFromStorage(): Promise<SynapseAccountState> {
    let attemptedRefreshToken: string | undefined
    try {
      const persisted = await this.namespace.getSingleton()
      if (!persisted?.refreshToken) {
        if (persisted?.activeAttempt) return this.state
        this.setState({ status: "unauthenticated" })
        return this.state
      }
      attemptedRefreshToken = persisted.refreshToken
      const revision = this.authRevision

      const baseUrl = apiBaseUrl(this.isPackaged)
      const tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
        `${baseUrl}/auth/refresh`,
        { refreshToken: persisted.refreshToken },
      )
      this.accessToken = tokens.accessToken
      const currentBeforeProfile = await this.readPersisted(
        "Failed to read stored account before loading refreshed account profile.",
      )
      if (currentBeforeProfile?.refreshToken !== attemptedRefreshToken) {
        this.accessToken = null
        return this.state
      }
      const profile = await this.loadMe(baseUrl)
      const committed = await this.writeAccountPatchIfRefreshTokenCurrent(
        revision,
        attemptedRefreshToken,
        {
          refreshToken: tokens.refreshToken,
          lastProfile: profile,
        },
      )
      if (!committed) {
        this.accessToken = null
        return this.state
      }
      if (committed.activeAttempt) return this.state
      this.setState({ status: "authenticated", profile })
    } catch (error) {
      logger.warn("Account refresh failed.", { error })
      this.accessToken = null
      await this.clearStoredRefreshTokenIfCurrent(attemptedRefreshToken)
      const latest = await this.readPersisted("Failed to read stored account after account refresh failed.")
      if (latest?.activeAttempt) return this.state
      this.setState({ status: "unauthenticated" })
    }

    return this.state
  }

  async logout(): Promise<SynapseAccountState> {
    const persisted = await this.readPersisted("Failed to read stored account before logout.")
    this.bumpAuthRevision()
    this.accessToken = null
    if (persisted?.refreshToken) {
      await this.postJson(`${apiBaseUrl(this.isPackaged)}/auth/logout`, {
        refreshToken: persisted.refreshToken,
      }).catch((error) => {
        logger.warn("Remote account logout revoke failed.", { error })
      })
    }

    await this.clearStoredAccount()
    this.setState({ status: "unauthenticated" })
    return this.state
  }

  private async loadMe(baseUrl: string): Promise<SynapseAccountProfile> {
    const response = await this.fetchImpl(`${baseUrl}/auth/me`, {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined,
    })
    if (!response.ok) throw new Error("账号信息同步失败。")
    const payload = await response.json() as Omit<SynapseAccountProfile, "syncedAt">
    return { ...payload, syncedAt: new Date().toISOString() }
  }

  private async refreshWithToken(
    baseUrl: string,
    refreshToken: string,
  ): Promise<{ refreshToken: string; profile: SynapseAccountProfile }> {
    const tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
      `${baseUrl}/auth/refresh`,
      { refreshToken },
    )
    this.accessToken = tokens.accessToken
    const profile = await this.loadMe(baseUrl)
    return { refreshToken: tokens.refreshToken, profile }
  }

  private async postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error("请求失败。")
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
  }

  private async readPersisted(message: string): Promise<PersistedAccount | null> {
    try {
      return await this.namespace.getSingleton()
    } catch (error) {
      logger.warn(message, { error })
      return null
    }
  }

  private async clearActiveAttemptIfState(expectedState: string): Promise<void> {
    await this.runStorageMutation(async () => {
      const persisted = await this.readPersisted("Failed to read stored account before clearing login attempt.")
      if (persisted?.activeAttempt?.state !== expectedState) return
      const nextPersisted: PersistedAccount = { ...persisted }
      delete nextPersisted.activeAttempt
      await this.namespace.setSingleton(nextPersisted)
    }).catch((error) => {
      logger.warn("Failed to clear account login attempt.", { error })
    })
  }

  private async writeAccountPatchIfAttemptCurrent(
    expectedRevision: number,
    expectedState: string,
    patch: PersistedAccount,
    options: { clearAttemptState?: string } = {},
  ): Promise<PersistedAccount | null> {
    return this.runStorageMutation(async () => {
      if (this.authRevision !== expectedRevision) return null
      const current = await this.readPersisted("Failed to read stored account before writing account state.")
      if (current?.activeAttempt?.state !== expectedState) return null
      const nextPersisted: PersistedAccount = { ...(current ?? {}), ...patch }
      if (options.clearAttemptState && nextPersisted.activeAttempt?.state === options.clearAttemptState) {
        delete nextPersisted.activeAttempt
      }
      await this.namespace.setSingleton(nextPersisted)
      if (this.authRevision !== expectedRevision) return null
      return nextPersisted
    })
  }

  private async writeAccountPatchIfRefreshTokenCurrent(
    expectedRevision: number,
    expectedRefreshToken: string,
    patch: PersistedAccount,
  ): Promise<PersistedAccount | null> {
    return this.runStorageMutation(async () => {
      if (this.authRevision !== expectedRevision) return null
      const current = await this.readPersisted("Failed to read stored account before writing account state.")
      if (current?.refreshToken !== expectedRefreshToken) return null
      const nextPersisted: PersistedAccount = { ...current, ...patch }
      await this.namespace.setSingleton(nextPersisted)
      if (this.authRevision !== expectedRevision) return null
      return nextPersisted
    })
  }

  private async clearStoredAccount(): Promise<void> {
    await this.runStorageMutation(async () => {
      await this.namespace.clearSingleton()
    }).catch((error) => {
      logger.warn("Failed to clear stored account.", { error })
    })
  }

  private async clearStoredRefreshTokenIfCurrent(expectedRefreshToken: string | undefined): Promise<void> {
    if (!expectedRefreshToken) return
    await this.runStorageMutation(async () => {
      const persisted = await this.readPersisted("Failed to read stored account before clearing refresh token.")
      if (persisted?.refreshToken !== expectedRefreshToken) return
      const nextPersisted: PersistedAccount = { ...persisted }
      delete nextPersisted.refreshToken
      await this.namespace.setSingleton(nextPersisted)
    }).catch((error) => {
      logger.warn("Failed to clear stored account refresh token.", { error })
    })
  }

  private bumpAuthRevision(): number {
    this.authRevision += 1
    return this.authRevision
  }

  private hasDifferentActiveAttempt(persisted: PersistedAccount | null, expectedState: string): boolean {
    return Boolean(persisted?.activeAttempt && persisted.activeAttempt.state !== expectedState)
  }

  private async runStorageMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.storageMutationQueue
    let release: () => void = () => {}
    this.storageMutationQueue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous.catch((error) => {
      logger.warn("Previous account storage mutation failed.", { error })
    })
    try {
      return await operation()
    } finally {
      release()
    }
  }

  private setInvalidCallbackState(persisted: PersistedAccount | null): void {
    this.setState({
      status: "error",
      message: "登录已失效，请重试。",
      profile: persisted?.lastProfile,
    })
  }

  private setState(nextState: SynapseAccountState): void {
    this.state = nextState
    for (const listener of this.listeners) {
      listener(nextState)
    }
    this.eventBus?.emit({
      domain: "account",
      type: "account.stateChanged",
      payload: { state: nextState },
      timestamp: new Date().toISOString(),
    })
  }
}

export const accountService = new AccountService()
