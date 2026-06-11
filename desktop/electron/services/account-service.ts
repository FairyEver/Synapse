import { createHash, randomBytes } from "node:crypto"
import { createReadStream, type Stats } from "node:fs"
import { stat } from "node:fs/promises"
import path from "node:path"
import { app, safeStorage } from "electron"

import type {
  SynapseAccountOfflineReason,
  SynapseAccountProfile,
  SynapseAccountState,
} from "../../src/types/account"
import type {
  DriveLocalUploadFileItem,
  DriveLocalUploadFolderItem,
  DriveLocalUploadRequest,
  DriveLocalUploadResult,
} from "../../src/types/bridge"
import type {
  DashboardWebhookDto,
  DriveAccessSettingsInput,
  DriveDeleteImpactDto,
  DriveFolderUploadPrepareResult,
  DriveItemDto,
  DrivePublicationDto,
  DriveShareDto,
  DriveShareListItemDto,
  DriveUploadPrepareResult,
  DriveUsageDto,
  ContentStoreDraftDto,
} from "@synapse/shared" with { "resolution-mode": "import" }
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"

const logger = createMainLogger("service.account")
const CORE_ACCOUNT_NAMESPACE = "core.account"
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const ACCOUNT_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000] as const
const HTTP_ERROR_BODY_MAX_LENGTH = 200
const SENSITIVE_HTTP_DETAIL_KEY_PATTERN = /password|token|secret|credential|authorization|cookie|apiKey/i
const UNSAFE_DRIVE_RELATIVE_PATH_PATTERN = /(^|\/)\.\.($|\/)|^\/|^[A-Za-z]:[\\/]/
const sharedUrlsPromise = import("@synapse/shared")

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

type AccountHttpFailureKind = "temporary" | "auth" | "other"

type AccountHttpError = Error & {
  status: number
  url?: string
  method?: string
}

type AccountExternalUrlOpener = (url: string) => Promise<void>

type CreateContentStoreSkillDraftInput = {
  readonly type: "skill"
  readonly title: string
  readonly description?: string | null
  readonly localSourceFingerprint: string
  readonly files: Array<{
    readonly path: string
    readonly contentBase64: string
    readonly mimeType?: string | null
  }>
}

type AccountServiceDeps = {
  namespace?: EncryptedJsonNamespace<PersistedAccount>
  fetch?: typeof fetch
  openExternal?: AccountExternalUrlOpener
  isPackaged?: boolean
}

export class AccountAuthenticationRequiredError extends Error {
  constructor() {
    super("账号未登录。")
    this.name = "AccountAuthenticationRequiredError"
  }
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

function apiBaseUrl(): string {
  return SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.apiBaseUrl
}

function publicAppUrl(): string {
  return SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl
}

export function getAccountApiBaseUrl(): string {
  return apiBaseUrl()
}

function apiMode(): "production" | "development" {
  return isLocalApiBaseUrl(apiBaseUrl()) ? "development" : "production"
}

function toMutableHeadersRecord(headersInit: RequestInit["headers"] | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  if (!headersInit) return headers

  if (headersInit instanceof Headers) {
    headersInit.forEach((value, key) => {
      headers[key] = value
    })
    return headers
  }

  if (Array.isArray(headersInit)) {
    for (const [key, value] of headersInit) {
      headers[key] = value
    }
    return headers
  }

  for (const [key, value] of Object.entries(headersInit) as Array<[string, string]>) {
    headers[key] = value
  }
  return headers
}

async function dashboardLoginUrl(baseUrl: string, state: string, codeChallenge: string): Promise<string> {
  const { buildDesktopDashboardLoginUrl } = await sharedUrlsPromise
  return buildDesktopDashboardLoginUrl({ apiBaseUrl: baseUrl, state, codeChallenge })
}

async function withCurrentDriveShareUrl<T extends {
  readonly shareId: string
  readonly url: string
  readonly urlWithPassword: string
  readonly password: string | null
}>(item: T): Promise<T> {
  const { buildDriveShareUrl, buildDriveUrlWithPassword } = await sharedUrlsPromise
  const url = buildDriveShareUrl({ publicAppUrl: publicAppUrl(), shareId: item.shareId })
  return {
    ...item,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, item.password),
  }
}

async function withCurrentDrivePublicationUrl<T extends DrivePublicationDto>(item: T): Promise<T> {
  const { buildDrivePublicationUrl, buildDriveUrlWithPassword } = await sharedUrlsPromise
  const url = buildDrivePublicationUrl({ publicAppUrl: publicAppUrl(), publishId: item.publishId, type: item.type })
  return {
    ...item,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, item.password),
  }
}

async function currentOwnerDriveBrowserUrl(itemId: string): Promise<string> {
  const { buildOwnerDriveBrowserUrl } = await sharedUrlsPromise
  return `${publicAppUrl().trim().replace(/\/+$/u, "")}${buildOwnerDriveBrowserUrl(itemId)}`
}

function isLocalApiBaseUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  } catch {
    return false
  }
}

function authCallbackErrorMessage(errorCode: string): string {
  if (errorCode === "unsupported_account") {
    return "请使用普通用户账号登录。"
  }
  return "登录失败，请重试。"
}

function retryDelayMs(attempt: number): number {
  return ACCOUNT_RETRY_DELAYS_MS[Math.min(attempt, ACCOUNT_RETRY_DELAYS_MS.length - 1)] ?? 300_000
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
  private accessToken: string | null = null
  private eventBus: EventBus | null = null
  private state: SynapseAccountState = { status: "unauthenticated" }
  private listeners = new Set<(state: SynapseAccountState) => void>()
  private authRevision = 0
  private storageMutationQueue: Promise<void> = Promise.resolve()
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryAttempt = 0

  constructor(deps: AccountServiceDeps = {}) {
    this.namespace = deps.namespace ?? createNamespace()
    this.fetchImpl = deps.fetch ?? globalThis.fetch.bind(globalThis)
    this.openExternal = deps.openExternal ?? unavailableExternalUrlOpener
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

  getAccessTokenForLive(): string | null {
    return this.accessToken
  }

  getApiBaseUrlForLive(): string {
    return apiBaseUrl()
  }

  async fetchAuthenticated(
    pathOrUrl: string,
    init: RequestInit = {},
    errorMessage = "请求失败。",
  ): Promise<Response> {
    const url = pathOrUrl.startsWith("/") ? `${apiBaseUrl()}${pathOrUrl}` : pathOrUrl
    let token = this.accessToken
    if (!token) {
      await this.refreshFromStorage()
      token = this.accessToken
    }
    if (!token) throw new AccountAuthenticationRequiredError()

    const request = () => {
      const headers = toMutableHeadersRecord(init.headers)
      headers.Authorization = `Bearer ${token}`
      return this.fetchImpl(url, { ...init, headers })
    }

    let response = await request()
    if (response.status === 401 || response.status === 403) {
      await this.refreshFromStorage()
      token = this.accessToken
      if (!token) {
        throw await createHttpError(init.method ?? "GET", url, response, errorMessage)
      }
      response = await request()
    }
    if (!response.ok) {
      throw await createHttpError(init.method ?? "GET", url, response, errorMessage)
    }
    return response
  }

  async listWebhooks(): Promise<DashboardWebhookDto[]> {
    return this.getAuthenticatedJson<DashboardWebhookDto[]>(
      `${apiBaseUrl()}/console/webhooks`,
      "Webhook 列表加载失败。",
    )
  }

  async createContentStoreSkillDraft(input: CreateContentStoreSkillDraftInput): Promise<ContentStoreDraftDto> {
    return this.requestAuthenticatedJson<ContentStoreDraftDto>("POST", `${apiBaseUrl()}/content-store/drafts`, {
      type: "skill",
      title: input.title,
      description: input.description ?? null,
      localSourceFingerprint: input.localSourceFingerprint,
      files: input.files.map((file) => ({
        path: file.path,
        contentBase64: file.contentBase64,
        mimeType: file.mimeType ?? null,
      })),
    }, "商店草稿保存失败。")
  }

  async listDriveItems(parentId: string | null): Promise<DriveItemDto[]> {
    const query = parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""
    return this.getAuthenticatedJson<DriveItemDto[]>(`${apiBaseUrl()}/drive/items${query}`, "云盘列表加载失败。")
  }

  async getDriveItemPreviewUrl(itemId: string): Promise<{ readonly url: string }> {
    return { url: await currentOwnerDriveBrowserUrl(itemId) }
  }

  async prepareDriveUpload(input: { parentId?: string | null; name: string; size: string; mimeType?: string | null }): Promise<DriveUploadPrepareResult> {
    return this.requestAuthenticatedJson<DriveUploadPrepareResult>("POST", `${apiBaseUrl()}/drive/uploads/prepare`, {
      parentId: input.parentId ?? null,
      name: input.name,
      size: input.size,
      mimeType: input.mimeType ?? null,
    }, "上传准备失败。")
  }

  async prepareDriveFolderUpload(input: {
    parentId?: string | null
    folderName: string
    files: Array<{ relativePath: string; size: string; mimeType?: string | null }>
  }): Promise<DriveFolderUploadPrepareResult> {
    return this.requestAuthenticatedJson<DriveFolderUploadPrepareResult>("POST", `${apiBaseUrl()}/drive/uploads/folder/prepare`, {
      parentId: input.parentId ?? null,
      folderName: input.folderName,
      files: input.files.map((file) => ({
        relativePath: file.relativePath,
        size: file.size,
        mimeType: file.mimeType ?? null,
      })),
    }, "文件夹上传准备失败。")
  }

  async completeDriveUpload(sessionId: string): Promise<DriveItemDto> {
    return this.requestAuthenticatedJson<DriveItemDto>("POST", `${apiBaseUrl()}/drive/uploads/${encodeURIComponent(sessionId)}/complete`, undefined, "上传确认失败。")
  }

  async uploadDrivePreparedFile(input: { method: "PUT"; url: string; headers: Record<string, string>; body: ArrayBuffer }): Promise<{ ok: true }> {
    const response = await this.fetchImpl(input.url, {
      method: input.method,
      headers: input.headers,
      body: Buffer.from(input.body),
    })
    if (!response.ok) throw await createHttpError(input.method, input.url, response, "上传失败。")
    return { ok: true }
  }

  async uploadDriveLocalItems(input: DriveLocalUploadRequest): Promise<DriveLocalUploadResult> {
    let completed = 0
    let failed = 0
    let skipped = 0
    let firstError: string | undefined

    for (const item of input.items) {
      const result = item.kind === "file"
        ? await this.uploadDriveLocalFile(input.parentId ?? null, item)
        : await this.uploadDriveLocalFolder(input.parentId ?? null, item)
      completed += result.completed
      failed += result.failed
      skipped += result.skipped
      firstError ??= result.message
    }

    return {
      completed,
      failed,
      skipped,
      ...(firstError ? { message: firstError } : {}),
    }
  }

  async cancelDriveUpload(sessionId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("POST", `${apiBaseUrl()}/drive/uploads/${encodeURIComponent(sessionId)}/cancel`, undefined, "上传取消失败。")
  }

  async createDriveFolder(input: { parentId?: string | null; name: string }): Promise<DriveItemDto> {
    return this.requestAuthenticatedJson<DriveItemDto>("POST", `${apiBaseUrl()}/drive/folders`, {
      parentId: input.parentId ?? null,
      name: input.name,
    }, "文件夹创建失败。")
  }

  async renameDriveItem(itemId: string, name: string): Promise<DriveItemDto> {
    return this.requestAuthenticatedJson<DriveItemDto>("PATCH", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, { name }, "重命名失败。")
  }

  async moveDriveItem(itemId: string, parentId: string | null): Promise<DriveItemDto> {
    return this.requestAuthenticatedJson<DriveItemDto>("PATCH", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, { parentId }, "移动失败。")
  }

  async deleteDriveItem(itemId: string, input: { readonly disablePublications?: boolean } = {}): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, input, "删除失败。")
  }

  async shareDriveItem(itemId: string, settings: DriveAccessSettingsInput): Promise<DriveShareDto> {
    const share = await this.requestAuthenticatedJson<DriveShareDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/share`, settings, "分享失败。")
    return withCurrentDriveShareUrl(share)
  }

  async disableDriveShare(shareId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/shares/${encodeURIComponent(shareId)}`, undefined, "取消分享失败。")
  }

  async getDriveUsage(): Promise<DriveUsageDto> {
    return this.getAuthenticatedJson<DriveUsageDto>(`${apiBaseUrl()}/drive/usage`, "云盘用量加载失败。")
  }

  private async uploadDriveLocalFile(
    parentId: string | null,
    item: DriveLocalUploadFileItem,
  ): Promise<DriveLocalUploadResult> {
    const fileStat = await safeLocalFileStat(item.path)
    if (!fileStat?.isFile()) {
      logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFile", reason: "not-file" })
      return { completed: 0, failed: 0, skipped: 1 }
    }

    let prepared: DriveUploadPrepareResult
    try {
      prepared = await this.prepareDriveUpload({
        parentId,
        name: item.name,
        size: String(fileStat.size),
        mimeType: item.mimeType ?? null,
      })
    } catch {
      return { completed: 0, failed: 1, skipped: 0, message: localUploadErrorMessage() }
    }

    try {
      await this.putPreparedUploadFromPath(prepared.upload, item.path, fileStat.size)
      await this.completeDriveUpload(prepared.sessionId)
      return { completed: 1, failed: 0, skipped: 0 }
    } catch {
      await this.cancelPreparedDriveUpload(prepared.sessionId, "uploadDriveLocalFile")
      return { completed: 0, failed: 1, skipped: 0, message: localUploadErrorMessage() }
    }
  }

  private async uploadDriveLocalFolder(
    parentId: string | null,
    item: DriveLocalUploadFolderItem,
  ): Promise<DriveLocalUploadResult> {
    const files: Array<{
      path: string
      relativePath: string
      size: string
      sizeBytes: number
      mimeType: string | null
    }> = []
    const seenRelativePaths = new Set<string>()
    let skipped = 0

    for (const file of item.files) {
      if (!isSafeDriveRelativePath(file.relativePath)) {
        skipped += 1
        logger.warn("Drive local upload skipped.", {
          operation: "uploadDriveLocalFolder",
          reason: "invalid-relative-path",
        })
        continue
      }

      if (seenRelativePaths.has(file.relativePath)) {
        skipped += 1
        logger.warn("Drive local upload skipped.", {
          operation: "uploadDriveLocalFolder",
          reason: "duplicate-relative-path",
        })
        continue
      }
      seenRelativePaths.add(file.relativePath)

      const fileStat = await safeLocalFileStat(file.path)
      if (!fileStat?.isFile()) {
        skipped += 1
        logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFolder", reason: "not-file" })
        continue
      }

      files.push({
        path: file.path,
        relativePath: file.relativePath,
        size: String(fileStat.size),
        sizeBytes: fileStat.size,
        mimeType: file.mimeType ?? null,
      })
    }

    if (files.length === 0) return { completed: 0, failed: 0, skipped }

    let prepared: DriveFolderUploadPrepareResult
    try {
      prepared = await this.prepareDriveFolderUpload({
        parentId,
        folderName: item.folderName,
        files: files.map((file) => ({
          relativePath: file.relativePath,
          size: file.size,
          mimeType: file.mimeType,
        })),
      })
    } catch {
      return { completed: 0, failed: files.length, skipped, message: localUploadErrorMessage() }
    }

    const preparedByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
    let completed = 0
    let failed = 0
    let firstError: string | undefined

    for (const file of files) {
      const preparedEntry = preparedByPath.get(file.relativePath)
      if (!preparedEntry) {
        failed += 1
        firstError ??= localUploadErrorMessage()
        continue
      }

      try {
        await this.putPreparedUploadFromPath(preparedEntry.upload, file.path, file.sizeBytes)
        await this.completeDriveUpload(preparedEntry.sessionId)
        completed += 1
      } catch {
        failed += 1
        firstError ??= localUploadErrorMessage()
        await this.cancelPreparedDriveUpload(preparedEntry.sessionId, "uploadDriveLocalFolder")
      }
    }

    return {
      completed,
      failed,
      skipped,
      ...(firstError ? { message: firstError } : {}),
    }
  }

  private async putPreparedUploadFromPath(
    upload: DriveUploadPrepareResult["upload"],
    filePath: string,
    sizeBytes: number,
  ): Promise<void> {
    const stream = createReadStream(filePath)
    const init: RequestInit & { duplex: "half" } = {
      method: upload.method,
      headers: withContentLengthHeader(upload.headers, sizeBytes),
      body: stream as unknown as RequestInit["body"],
      duplex: "half",
    }

    try {
      const response = await this.fetchImpl(upload.url, init)
      if (!response.ok) throw await createHttpError(upload.method, upload.url, response, "上传失败。")
    } finally {
      stream.destroy()
    }
  }

  private async cancelPreparedDriveUpload(sessionId: string, operation: string): Promise<void> {
    await this.cancelDriveUpload(sessionId).catch((error) => {
      logger.warn("Drive local upload cancel failed.", {
        operation,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
  }

  async listDrivePublications(): Promise<DrivePublicationDto[]> {
    const publications = await this.getAuthenticatedJson<DrivePublicationDto[]>(`${apiBaseUrl()}/drive/publications`, "发布列表加载失败。")
    return Promise.all(publications.map(withCurrentDrivePublicationUrl))
  }

  async publishDrivePage(itemId: string, settings: DriveAccessSettingsInput): Promise<DrivePublicationDto> {
    const publication = await this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/publications/page`, settings, "发布网页失败。")
    return withCurrentDrivePublicationUrl(publication)
  }

  async publishDriveSite(itemId: string, settings: DriveAccessSettingsInput): Promise<DrivePublicationDto> {
    const publication = await this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/publications/site`, settings, "发布站点失败。")
    return withCurrentDrivePublicationUrl(publication)
  }

  async redeployDrivePublication(publicationId: string): Promise<DrivePublicationDto> {
    const publication = await this.requestAuthenticatedJson<DrivePublicationDto>("POST", `${apiBaseUrl()}/drive/publications/${encodeURIComponent(publicationId)}/redeploy`, undefined, "重新发布失败。")
    return withCurrentDrivePublicationUrl(publication)
  }

  async disableDrivePublication(publicationId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/publications/${encodeURIComponent(publicationId)}`, undefined, "取消发布失败。")
  }

  async getDriveDeleteImpact(itemId: string): Promise<DriveDeleteImpactDto> {
    const impact = await this.getAuthenticatedJson<DriveDeleteImpactDto>(`${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/delete-impact`, "删除影响加载失败。")
    return {
      publications: await Promise.all(impact.publications.map(withCurrentDrivePublicationUrl)),
    }
  }

  async listDriveShares(): Promise<DriveShareListItemDto[]> {
    const shares = await this.getAuthenticatedJson<DriveShareListItemDto[]>(`${apiBaseUrl()}/drive/shares`, "分享列表加载失败。")
    return Promise.all(shares.map(withCurrentDriveShareUrl))
  }

  async startLogin(): Promise<{ state: SynapseAccountState; loginUrl: string }> {
    this.cancelOfflineRetry()
    const baseUrl = apiBaseUrl()
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
    const loginUrl = await dashboardLoginUrl(baseUrl, state, codeChallenge)
    const revision = this.bumpAuthRevision()

    try {
      await this.runStorageMutation(async () => {
        if (this.authRevision !== revision) return
        const current = await this.namespace.getSingleton()
        await this.namespace.setSingleton({ ...(current ?? {}), activeAttempt: attempt })
      })
    } catch (error) {
      logger.warn("Failed to start desktop account login.", { error })
      this.setState({ status: "error", message: "无法保存登录状态。" })
      return { state: this.state, loginUrl }
    }

    if (this.authRevision !== revision) return { state: this.state, loginUrl }
    this.setState({ status: "authenticating", loginUrl })

    try {
      await this.openExternal(loginUrl)
      logger.info("Desktop account login started.", {
        operation: "startLogin",
        status: "success",
        apiMode: apiMode(),
      })
    } catch (error) {
      logger.warn("Failed to open desktop account login URL.", { error })
      this.setState({ status: "error", message: "无法打开浏览器，请检查默认浏览器设置后重试。" })
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

    if (!attempt && callbackState && this.state.status === "authenticated") {
      logger.info("Ignored stale account auth callback while already authenticated.", {
        operation: "handleAuthCallback",
        status: "already-authenticated",
      })
      return this.state
    }

    if (!attempt && callbackState && this.state.status === "unauthenticated") {
      logger.info("Ignored account auth callback without an active login attempt.", {
        operation: "handleAuthCallback",
        status: "no-active-attempt",
      })
      return this.state
    }

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
          this.cancelOfflineRetry()
          this.setState({ status: "authenticated", connectivity: "online", profile: refreshed.profile })
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
      this.cancelOfflineRetry()
      this.setState({ status: "authenticated", connectivity: "online", profile })
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
        this.cancelOfflineRetry()
        this.setState({ status: "authenticated", connectivity: "online", profile: refreshed.profile })
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

  async refreshFromStorage(options: { resetRetryBackoff?: boolean } = {}): Promise<SynapseAccountState> {
    const resetRetryBackoff = options.resetRetryBackoff ?? true
    if (resetRetryBackoff) {
      this.cancelOfflineRetry()
    } else {
      this.clearOfflineRetryTimer()
    }
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

      const baseUrl = apiBaseUrl()
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
      this.cancelOfflineRetry()
      this.setState({ status: "authenticated", connectivity: "online", profile })
      logger.info("Desktop account refreshed from storage.", authenticatedLogMeta("refreshFromStorage", profile))
    } catch (error) {
      logger.warn("Account refresh failed.", { error })
      const latest = await this.readPersisted("Failed to read stored account after account refresh failed.")
      if (attemptedRefreshToken && latest?.refreshToken && latest.refreshToken !== attemptedRefreshToken) {
        logger.info("Ignored stale account refresh failure.", {
          operation: "refreshFromStorage",
          status: "stale-refresh-token",
        })
        return this.state
      }
      this.accessToken = null
      if (latest?.activeAttempt) return this.state
      const failureKind = classifyAccountRefreshFailure(error)
      const lastProfile = latest?.lastProfile
      if (failureKind === "temporary" && latest?.refreshToken === attemptedRefreshToken && lastProfile) {
        this.scheduleOfflineRetry(offlineReasonForFailure(error), lastProfile)
        return this.state
      }
      await this.clearStoredCredentialsIfRefreshTokenCurrent(attemptedRefreshToken)
      this.setState({ status: "unauthenticated" })
    }

    return this.state
  }

  async retryOfflineNow(): Promise<SynapseAccountState> {
    if (this.state.status !== "authenticated" || this.state.connectivity !== "offline") {
      return this.state
    }
    this.cancelOfflineRetry()
    return this.refreshFromStorage()
  }

  async logout(): Promise<SynapseAccountState> {
    const persisted = await this.readPersisted("Failed to read stored account before logout.")
    this.bumpAuthRevision()
    this.cancelOfflineRetry()
    this.accessToken = null
    if (persisted?.refreshToken) {
      await this.postJson(`${apiBaseUrl()}/auth/logout`, {
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

  private async getAuthenticatedJson<T>(url: string, errorMessage: string): Promise<T> {
    return this.requestAuthenticatedJson<T>("GET", url, undefined, errorMessage)
  }

  private async requestAuthenticatedJson<T>(method: string, url: string, body: unknown, errorMessage: string): Promise<T> {
    const response = await this.fetchAuthenticated(url, {
      method,
      headers: {
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }, errorMessage)
    const text = await response.text()
    return (text ? JSON.parse(text) : undefined) as T
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

  private async clearStoredCredentialsIfRefreshTokenCurrent(expectedRefreshToken: string | undefined): Promise<void> {
    if (!expectedRefreshToken) return
    await this.runStorageMutation(async () => {
      const persisted = await this.readPersisted("Failed to read stored account before clearing credentials.")
      if (persisted?.refreshToken !== expectedRefreshToken) return
      const nextPersisted: PersistedAccount = { ...persisted }
      delete nextPersisted.refreshToken
      delete nextPersisted.lastProfile
      await this.namespace.setSingleton(nextPersisted)
    }).catch((error) => {
      logger.warn("Failed to clear stored account credentials.", { error })
    })
  }

  private clearOfflineRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private scheduleOfflineRetry(reason: SynapseAccountOfflineReason, profile: SynapseAccountProfile): void {
    if (this.retryTimer) return
    const delayMs = retryDelayMs(this.retryAttempt)
    const nextRetryAt = new Date(Date.now() + delayMs).toISOString()
    this.setState({
      status: "authenticated",
      connectivity: "offline",
      offlineReason: reason,
      profile,
      retry: { attempt: this.retryAttempt, nextRetryAt },
    })
    this.retryTimer = setTimeout(async () => {
      this.retryTimer = null
      this.retryAttempt += 1
      await this.refreshFromStorage({ resetRetryBackoff: false })
    }, delayMs)
    this.retryTimer.unref?.()
  }

  private cancelOfflineRetry(): void {
    this.clearOfflineRetryTimer()
    this.retryAttempt = 0
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

async function createHttpError(
  method: string,
  url: string,
  response: Response,
  fallbackMessage: string,
): Promise<AccountHttpError> {
  const detail = await formatHttpFailureBody(response)
  const detailText = detail ? `: ${detail}` : ""
  const error = new Error(
    `${fallbackMessage} (${method} ${endpointPath(url)} HTTP ${response.status})${detailText}`,
  ) as AccountHttpError
  error.status = response.status
  error.url = url
  error.method = method
  return error
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

async function safeLocalFileStat(filePath: string): Promise<Stats | null> {
  try {
    return await stat(filePath)
  } catch (error) {
    logger.warn("Drive local upload stat failed.", {
      operation: "safeLocalFileStat",
      errorName: error instanceof Error ? error.name : typeof error,
      errorCode: errorCode(error),
    })
    return null
  }
}

function isSafeDriveRelativePath(value: string): boolean {
  if (value.length === 0 || value.includes("\\") || UNSAFE_DRIVE_RELATIVE_PATH_PATTERN.test(value)) {
    return false
  }
  return value.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..")
}

function withContentLengthHeader(headers: Record<string, string>, sizeBytes: number): Record<string, string> {
  if (Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) return headers
  return { ...headers, "Content-Length": String(sizeBytes) }
}

function localUploadErrorMessage(): string {
  return "上传失败。"
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function classifyAccountRefreshFailure(error: unknown): AccountHttpFailureKind {
  if (isAccountHttpError(error)) {
    if (error.status === 401 || error.status === 403) return "auth"
    if (error.status >= 500) return "temporary"
    return "other"
  }
  return "temporary"
}

function offlineReasonForFailure(error: unknown): SynapseAccountOfflineReason {
  if (isAccountHttpError(error) && error.status >= 500) return "server_unavailable"
  return "network_error"
}

function isAccountHttpError(error: unknown): error is AccountHttpError {
  return error instanceof Error && typeof (error as AccountHttpError).status === "number"
}

export const accountService = new AccountService()
