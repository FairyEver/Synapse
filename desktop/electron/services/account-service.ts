import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { app, safeStorage } from "electron"

import type { SynapseAccountProfile, SynapseAccountState } from "../../src/types/account"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.account")
const CORE_ACCOUNT_NAMESPACE = "core.account"
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const PROD_API_BASE_URL = "https://synapse.d2.pub/api"
const DEV_API_BASE_URL = "http://localhost:3000/api"
const DESKTOP_CLIENT_ID = "synapse-desktop"
const DESKTOP_REDIRECT_URI = "synapse://auth/desktop/callback"
const PKCE_CHALLENGE_METHOD = "S256"
const HTTP_ERROR_BODY_MAX_LENGTH = 200
const SENSITIVE_HTTP_DETAIL_KEY_PATTERN = /password|token|secret|credential|authorization|cookie|apiKey/i

type PersistedAccount = Record<string, unknown> & {
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

type AccountExternalUrlOpener = (url: string) => Promise<void>

type AccountServiceDeps = {
  namespace?: EncryptedJsonNamespace<PersistedAccount>
  fetch?: typeof fetch
  openExternal?: AccountExternalUrlOpener
  isPackaged?: boolean
}

function createState(): string {
  return randomBytes(32).toString("base64url")
}

function createCodeVerifier(): string {
  return randomBytes(32).toString("base64url")
}

function createCodeChallenge(codeVerifier: string): string {
  return createHash("sha256").update(codeVerifier).digest("base64url")
}

function apiBaseUrl(isPackaged: boolean): string {
  return isPackaged ? PROD_API_BASE_URL : DEV_API_BASE_URL
}

function apiMode(isPackaged: boolean): "production" | "development" {
  return isPackaged ? "production" : "development"
}

function dashboardLoginUrl(baseUrl: string, state: string, codeChallenge: string): string {
  const origin = baseUrl.replace(/\/api\/?$/u, "")
  const query = new URLSearchParams({
    client_id: DESKTOP_CLIENT_ID,
    redirect_uri: DESKTOP_REDIRECT_URI,
    response_type: "code",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: PKCE_CHALLENGE_METHOD,
  })
  return `${origin}/dashboard/auth/desktop?${query.toString()}`
}

function authCallbackErrorMessage(errorCode: string): string {
  if (errorCode === "unsupported_account") {
    return "请使用普通用户账号登录。"
  }
  return "登录失败，请重试。"
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

async function unavailableExternalUrlOpener(): Promise<void> {
  throw new Error("Account external opener is unavailable.")
}

export class AccountService {
  private readonly namespace: EncryptedJsonNamespace<PersistedAccount>
  private readonly fetchImpl: typeof fetch
  private openExternal: AccountExternalUrlOpener
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
    this.openExternal = deps.openExternal ?? unavailableExternalUrlOpener
    this.isPackaged = deps.isPackaged ?? app.isPackaged
  }

  setEventBus(eventBus: EventBus): void {
    this.eventBus = eventBus
  }

  setExternalUrlOpener(openExternal: AccountExternalUrlOpener): void {
    this.openExternal = openExternal
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
    const codeVerifier = createCodeVerifier()
    const codeChallenge = createCodeChallenge(codeVerifier)
    const now = new Date()
    const attempt = {
      state,
      codeVerifier,
      apiBaseUrl: baseUrl,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + ATTEMPT_TTL_MS).toISOString(),
    }
    const loginUrl = dashboardLoginUrl(baseUrl, state, codeChallenge)
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
      logger.info("Desktop account login started.", {
        operation: "startLogin",
        status: "success",
        apiMode: apiMode(this.isPackaged),
      })
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

    if (parsed.protocol !== "synapse:" || parsed.hostname !== "auth" || parsed.pathname !== "/desktop/callback") {
      logger.warn("Ignored unknown account auth callback.", {
        protocol: parsed.protocol,
        host: parsed.hostname,
        pathname: parsed.pathname,
      })
      return this.state
    }

    const code = parsed.searchParams.get("code")?.trim()
    const callbackState = parsed.searchParams.get("state")?.trim()
    const callbackError = parsed.searchParams.get("error")?.trim()
    const persisted = await this.readPersisted("Failed to read stored account for auth callback.")
    const attempt = persisted?.activeAttempt

    if (callbackError && callbackState && attempt?.state === callbackState) {
      const keepActiveAttempt = callbackError === "unsupported_account"
      if (!keepActiveAttempt) {
        await this.clearActiveAttemptIfState(callbackState)
      }
      const latest = keepActiveAttempt
        ? persisted
        : await this.readPersisted("Failed to read stored account after account callback error.")
      if (this.hasDifferentActiveAttempt(latest, callbackState)) return this.state
      this.setState({
        status: "error",
        message: authCallbackErrorMessage(callbackError),
        profile: latest?.lastProfile ?? persisted?.lastProfile,
      })
      return this.state
    }

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

    logger.info("Desktop account callback accepted.", {
      operation: "handleAuthCallback",
      status: "accepted",
    })

    let tokens: { accessToken: string; refreshToken: string }
    try {
      tokens = await this.postJson<{ accessToken: string; refreshToken: string }>(
        `${attempt.apiBaseUrl}/auth/desktop/token`,
        { code, state: callbackState, codeVerifier: attempt.codeVerifier },
      )
      logger.info("Desktop account callback exchange succeeded.", {
        operation: "handleAuthCallback",
        status: "exchange-success",
      })
    } catch (error) {
      logger.warn("Desktop account callback exchange failed.", { error })
      this.accessToken = null
      await this.clearActiveAttemptIfState(callbackState)
      const latest = await this.readPersisted("Failed to read stored account after account callback exchange failed.")
      if (this.hasDifferentActiveAttempt(latest, callbackState)) return this.state
      const previousRefreshToken = persisted?.refreshToken
      if (previousRefreshToken && latest?.refreshToken === previousRefreshToken) {
        try {
          const revision = this.authRevision
          const refreshed = await this.refreshWithToken(attempt.apiBaseUrl, previousRefreshToken)
          const committed = await this.writeAccountPatchIfRefreshTokenCurrent(
            revision,
            previousRefreshToken,
            { refreshToken: refreshed.refreshToken, lastProfile: refreshed.profile },
          )
          if (!committed) {
            this.accessToken = null
            return this.state
          }
          if (committed.activeAttempt) return this.state
          this.setState({ status: "authenticated", profile: refreshed.profile })
          logger.info("Desktop account authenticated after callback exchange recovery.", authenticatedLogMeta(
            "handleAuthCallback",
            refreshed.profile,
          ))
          return this.state
        } catch (refreshError) {
          logger.warn("Desktop account callback exchange recovery refresh failed.", { error: refreshError })
          this.accessToken = null
        }
      }
      this.setState({
        status: "error",
        message: "登录失败，请重试。",
        profile: latest?.lastProfile ?? persisted?.lastProfile,
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
      logger.info("Desktop account authenticated.", authenticatedLogMeta("handleAuthCallback", profile))
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
        logger.info("Desktop account authenticated after refresh recovery.", authenticatedLogMeta(
          "handleAuthCallback",
          refreshed.profile,
        ))
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
        if (persisted?.activeAttempt) {
          logger.info("Desktop account refresh skipped.", {
            operation: "refreshFromStorage",
            status: "active-attempt",
          })
          return this.state
        }
        this.setState({ status: "unauthenticated" })
        logger.info("Desktop account refresh skipped.", {
          operation: "refreshFromStorage",
          status: "no-refresh-token",
        })
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
      logger.info("Desktop account refreshed from storage.", authenticatedLogMeta("refreshFromStorage", profile))
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

    try {
      await this.clearStoredAccount()
    } catch {
      this.setState({
        status: "error",
        message: "退出登录失败，请重试。",
        profile: persisted?.lastProfile,
      })
      return this.state
    }
    this.setState({ status: "unauthenticated" })
    logger.info("Desktop account logged out.", {
      operation: "logout",
      status: "success",
      hadRefreshToken: Boolean(persisted?.refreshToken),
    })
    return this.state
  }

  private async loadMe(baseUrl: string): Promise<SynapseAccountProfile> {
    const url = `${baseUrl}/auth/me`
    const response = await this.fetchImpl(url, {
      headers: this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : undefined,
    })
    if (!response.ok) throw await createHttpError("GET", url, response, "账号信息同步失败。")
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
    if (!response.ok) throw await createHttpError("POST", url, response, "请求失败。")
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
    try {
      await this.runStorageMutation(async () => {
        await this.namespace.clearSingleton()
      })
    } catch (error) {
      logger.warn("Failed to clear stored account.", { error })
      throw error
    }
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

function authenticatedLogMeta(
  operation: "handleAuthCallback" | "refreshFromStorage",
  profile: SynapseAccountProfile,
): Record<string, unknown> {
  return {
    operation,
    status: "authenticated",
    userId: profile.user.id,
    teamCount: profile.teams.length,
  }
}

async function createHttpError(method: string, url: string, response: Response, fallbackMessage: string): Promise<Error> {
  const detail = await formatHttpFailureBody(response)
  const detailText = detail ? `: ${detail}` : ""
  return new Error(`${fallbackMessage} (${method} ${endpointPath(url)} HTTP ${response.status})${detailText}`)
}

async function formatHttpFailureBody(response: Response): Promise<string> {
  const text = await response.text().catch(() => "")
  if (!text) return ""

  try {
    return truncateHttpFailureDetail(JSON.stringify(redactHttpFailureDetail(JSON.parse(text))))
  } catch {
    return truncateHttpFailureDetail(text)
  }
}

function redactHttpFailureDetail(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactHttpFailureDetail)
  if (!value || typeof value !== "object") return value

  const result: Record<string, unknown> = {}
  for (const [key, childValue] of Object.entries(value)) {
    result[key] = SENSITIVE_HTTP_DETAIL_KEY_PATTERN.test(key) ? "[REDACTED]" : redactHttpFailureDetail(childValue)
  }
  return result
}

function truncateHttpFailureDetail(value: string): string {
  if (value.length <= HTTP_ERROR_BODY_MAX_LENGTH) return value
  return `${value.slice(0, HTTP_ERROR_BODY_MAX_LENGTH)}...`
}

function endpointPath(url: string): string {
  try {
    return new URL(url).pathname
  } catch {
    return url.split("?")[0] ?? url
  }
}

export const accountService = new AccountService()
