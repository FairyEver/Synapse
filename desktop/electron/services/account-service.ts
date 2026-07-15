import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream, type Stats } from "node:fs"
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { app, safeStorage } from "electron"

import type {
  SynapseAccountOfflineReason,
  SynapseAccountProfile,
  SynapseAccountState,
} from "../../src/types/account"
import type {
  DriveLocalUploadFileItem,
  DriveLocalUploadFolderItem,
  DriveDocumentImageImportBridgeRequest,
  DriveDocumentImageSourceContext,
  DrivePublicAssetBinaryUploadRequest,
  DrivePublicAssetLocalFile,
  DrivePublicAssetUploadRequest,
  DrivePublicAssetUploadResult,
  DrivePublicAssetUploadResultItem,
  DriveLocalUploadRequest,
  DriveLocalUploadProgressEvent,
  DriveLocalUploadResult,
} from "../../src/types/bridge"
import type {
  DashboardWebhookDto,
  DriveAccessSettingsUpdateInput,
  DriveBrowserSnapshotDto,
  DriveChangeListInput,
  DriveChangeListPageDto,
  DriveDocumentImageImportResult,
  DriveDocumentImageSourcesDto,
  DriveFileVersionDto,
  DriveFileVersionListInput,
  DriveFileVersionListPageDto,
  DriveFolderUploadPrepareResult,
  DriveFolderPathEnsureInput,
  DriveFolderPathEnsureResultDto,
  DriveItemDto,
  DriveItemListInput,
  DriveItemListPageDto,
  DriveItemTreeListInput,
  DriveItemTreeListPageDto,
  DriveLinkDownloadFileDto,
  DriveLinkDownloadFileInput,
  DriveLinkListDto,
  DriveLinkListInput,
  DriveLinkMaterializeDto,
  DriveLinkMaterializeInput,
  DriveLinkReadTextDto,
  DriveLinkReadTextInput,
  DriveLinkResolveDto,
  DriveLinkResolveInput,
  DrivePublicAssetDto,
  DrivePublicAssetListPageDto,
  DrivePublicLinksPageInput,
  DriveReorganizationApplyInput,
  DriveReorganizationApplyResultDto,
  DriveReorganizationPreviewDto,
  DriveReorganizationPreviewInput,
  DriveSiteAccessUpdateInput,
  DriveSiteCreateInput,
  DriveSiteDto,
  DriveSiteListInput,
  DriveSiteListPageDto,
  DriveSitePreflightDto,
  DriveShareDto,
  DriveShareListPageDto,
  DriveShareListItemDto,
  DriveStatsDto,
  DriveTrashItemDto,
  DriveTrashListPageDto,
  DriveUploadPrepareResult,
  DriveUsageDto,
  SkillRepositoryDetailDto,
  SkillRepositoryForkInput,
  SkillRepositoryForkResultDto,
  SkillRepositoryImportInput,
  SkillRepositoryInstallSessionDto,
  SkillRepositoryItemDto,
  SkillRepositoryUpdateInput,
} from "@synapse/shared" with { "resolution-mode": "import" }
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "../generated/deployment-config.generated"
import { EncryptedJsonNamespace } from "../runtime/data-repo/backends/encrypted-json"
import type { EventBus } from "../runtime/event-bus"
import { createMainLogger } from "./log-store"
import { redactSensitiveText } from "../../src/lib/agent-redaction"

const logger = createMainLogger("service.account")
const CORE_ACCOUNT_NAMESPACE = "core.account"
const ATTEMPT_TTL_MS = 10 * 60 * 1000
const ACCOUNT_RETRY_DELAYS_MS = [10_000, 30_000, 60_000, 120_000, 300_000] as const
const HTTP_ERROR_BODY_MAX_LENGTH = 200
const ACCOUNT_WEBHOOK_PAGE_SIZE = 100
const DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES = 200
const DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES = 50 * 1024 * 1024
const SENSITIVE_HTTP_DETAIL_KEY_PATTERN = /password|token|secret|credential|authorization|cookie|api[-_]?key/i
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

type AccountRefreshReason = "startup" | "api-auth-failure" | "live-auth-failure" | "manual" | "offline-retry"

type AccountRefreshFromStorageOptions = {
  readonly resetRetryBackoff?: boolean
  readonly reason?: AccountRefreshReason
}

type AccountHttpFailureKind = "temporary" | "auth" | "other"

type AccountHttpError = Error & {
  status: number
  url?: string
  method?: string
  code?: string
  retryAfterMs?: number
}

const DRIVE_UPLOAD_COMPLETE_RATE_LIMIT_RETRY_DELAY_MS = 5000

type PaginatedAccountResponse<T> = {
  readonly data: readonly T[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

type AccountExternalUrlOpener = (url: string) => Promise<void>

type AccountServiceDeps = {
  namespace?: EncryptedJsonNamespace<PersistedAccount>
  fetch?: typeof fetch
  openExternal?: AccountExternalUrlOpener
  isPackaged?: boolean
}

type DriveLocalUploadProgressReporter = {
  readonly taskId?: string
  readonly onProgress?: (event: DriveLocalUploadProgressEvent) => void
}

type DriveLocalUploadItemProgressEvent = Exclude<DriveLocalUploadProgressEvent, { readonly type: "task-finished" }>
type DriveLocalUploadProgressEventInput<TEvent extends DriveLocalUploadItemProgressEvent = DriveLocalUploadItemProgressEvent> =
  TEvent extends DriveLocalUploadItemProgressEvent ? Omit<TEvent, "taskId"> : never

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

function drivePublicLinksPageQuery(input?: DrivePublicLinksPageInput): string {
  const params = new URLSearchParams()
  if (input?.offset !== undefined) params.set("offset", String(input.offset))
  if (input?.limit !== undefined) params.set("limit", String(input.limit))
  const query = params.toString()
  return query ? `?${query}` : ""
}

function drivePageQuery(input?: DrivePublicLinksPageInput): string {
  const params = new URLSearchParams()
  if (input?.offset !== undefined) params.set("offset", String(input.offset))
  if (input?.limit !== undefined) params.set("limit", String(input.limit))
  if (input?.search) params.set("search", input.search)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function driveItemListQuery(input?: DriveItemListInput): string {
  const params = new URLSearchParams()
  if (input?.parentId) params.set("parentId", input.parentId)
  if (input?.offset !== undefined) params.set("offset", String(input.offset))
  if (input?.limit !== undefined) params.set("limit", String(input.limit))
  const query = params.toString()
  return query ? `?${query}` : ""
}

function driveSiteListQuery(input?: DriveSiteListInput): string {
  const params = new URLSearchParams()
  if (input?.offset !== undefined) params.set("offset", String(input.offset))
  if (input?.limit !== undefined) params.set("limit", String(input.limit))
  if (input?.search) params.set("search", input.search)
  if (input?.status && input.status !== "all") params.set("status", input.status)
  const query = params.toString()
  return query ? `?${query}` : ""
}

function driveVersionListQuery(input?: DriveFileVersionListInput): string {
  const params = new URLSearchParams()
  if (input?.offset !== undefined) params.set("offset", String(input.offset))
  if (input?.limit !== undefined) params.set("limit", String(input.limit))
  const query = params.toString()
  return query ? `?${query}` : ""
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

async function withCurrentDriveSiteUrl<T extends {
  readonly siteId: string
  readonly url: string
  readonly urlWithPassword: string
  readonly password: string | null
}>(site: T): Promise<T> {
  const { buildDriveSiteUrl, buildDriveUrlWithPassword } = await sharedUrlsPromise
  const url = buildDriveSiteUrl({ publicAppUrl: publicAppUrl(), siteId: site.siteId })
  return {
    ...site,
    url,
    urlWithPassword: buildDriveUrlWithPassword(url, site.password),
  }
}

async function currentOwnerDriveBrowserUrl(itemId: string): Promise<string> {
  const { buildOwnerDriveBrowserUrl } = await sharedUrlsPromise
  return `${publicAppUrl().trim().replace(/\/+$/u, "")}${buildOwnerDriveBrowserUrl(itemId)}`
}

function currentOwnerDriveDownloadUrl(itemId: string): string {
  return `${publicAppUrl().trim().replace(/\/+$/u, "")}/drive/items/${encodeURIComponent(itemId)}/download`
}

function driveDocumentImageSourcesPath(input: DriveDocumentImageSourceContext): string {
  if (input.kind === "owner") {
    return `/drive/items/${encodeURIComponent(input.itemId)}/image-sources`
  }
  const sharePath = `/drive/browser/shares/${encodeURIComponent(input.shareId)}`
  return input.itemId
    ? `${sharePath}/items/${encodeURIComponent(input.itemId)}/image-sources`
    : `${sharePath}/image-sources`
}

type DriveFileContentReadResult = {
  readonly itemId: string
  readonly name: string
  readonly kind: string
  readonly text: string | null
  readonly html: string | null
  readonly truncated: boolean
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
  private refreshInFlight: Promise<SynapseAccountState> | null = null

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
      if (this.state.status === "authenticated" && this.state.connectivity === "offline") {
        throw new AccountAuthenticationRequiredError()
      }
      await this.refreshFromStorage({ reason: "api-auth-failure" })
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
      await this.refreshFromStorage({ reason: "api-auth-failure" })
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
    const webhooks: DashboardWebhookDto[] = []
    for (let page = 1; ; page += 1) {
      const result = await this.getAuthenticatedJson<PaginatedAccountResponse<DashboardWebhookDto>>(
        `${apiBaseUrl()}/console/webhooks?page=${page}&pageSize=${ACCOUNT_WEBHOOK_PAGE_SIZE}`,
        "Webhook 列表加载失败。",
      )
      webhooks.push(...result.data)
      if (webhooks.length >= result.total || result.data.length === 0) {
        return webhooks
      }
    }
  }

  async listSkillRepositories(): Promise<SkillRepositoryItemDto[]> {
    return this.getAuthenticatedJson<SkillRepositoryItemDto[]>(
      `${apiBaseUrl()}/skill-repositories/mine`,
      "Skill 仓库列表加载失败。",
    )
  }

  async getSkillRepository(repositoryId: string): Promise<SkillRepositoryDetailDto> {
    return this.getAuthenticatedJson<SkillRepositoryDetailDto>(
      `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}`,
      "Skill 仓库加载失败。",
    )
  }

  async importSkillRepository(input: SkillRepositoryImportInput): Promise<SkillRepositoryDetailDto> {
    return this.requestAuthenticatedJson<SkillRepositoryDetailDto>(
      "POST",
      `${apiBaseUrl()}/skill-repositories/import`,
      input,
      "Skill 仓库上传失败。",
    )
  }

  async updateSkillRepository(repositoryId: string, input: SkillRepositoryUpdateInput): Promise<SkillRepositoryDetailDto> {
    return this.requestAuthenticatedJson<SkillRepositoryDetailDto>(
      "PATCH",
      `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}`,
      input,
      "Skill 仓库更新失败。",
    )
  }

  async forkSkillRepository(repositoryId: string, input: SkillRepositoryForkInput): Promise<SkillRepositoryForkResultDto> {
    return this.requestAuthenticatedJson<SkillRepositoryForkResultDto>(
      "POST",
      `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}/fork`,
      input,
      "Skill 仓库 Fork 失败。",
    )
  }

  async createSkillRepositoryInstallSession(repositoryId: string): Promise<SkillRepositoryInstallSessionDto> {
    return this.requestAuthenticatedJson<SkillRepositoryInstallSessionDto>(
      "POST",
      `${apiBaseUrl()}/skill-repositories/${encodeURIComponent(repositoryId)}/install-sessions`,
      {},
      "Skill 安装会话创建失败。",
    )
  }

  async listDriveItems(parentId: string | null): Promise<DriveItemDto[]> {
    const page = await this.listDriveItemsPage({ parentId, offset: 0 })
    return [...page.items]
  }

  async listDriveItemsPage(input: DriveItemListInput = {}): Promise<DriveItemListPageDto> {
    const query = driveItemListQuery({ ...input, offset: input.offset ?? 0 })
    return this.getAuthenticatedJson<DriveItemListPageDto>(`${apiBaseUrl()}/drive/items${query}`, "云盘列表加载失败。")
  }

  async getDriveItem(itemId: string): Promise<DriveItemDto> {
    return this.getAuthenticatedJson<DriveItemDto>(`${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, "云盘条目加载失败。")
  }

  async getDriveItemPreviewUrl(itemId: string): Promise<{ readonly url: string }> {
    return { url: await currentOwnerDriveBrowserUrl(itemId) }
  }

  async getDriveItemPreview(input: {
    readonly itemId: string
    readonly surface?: "standalone" | "console"
    readonly childrenOffset?: number
    readonly childrenLimit?: number
  }): Promise<DriveBrowserSnapshotDto> {
    const params = new URLSearchParams()
    params.set("surface", input.surface ?? "standalone")
    if (input.childrenOffset !== undefined) params.set("childrenOffset", String(input.childrenOffset))
    if (input.childrenLimit !== undefined) params.set("childrenLimit", String(input.childrenLimit))
    return this.getAuthenticatedJson<DriveBrowserSnapshotDto>(
      `${apiBaseUrl()}/drive/browser/owner/items/${encodeURIComponent(input.itemId)}?${params.toString()}`,
      "云盘预览加载失败。",
    )
  }

  async readDriveFileContent(input: {
    readonly itemId: string
    readonly maxBytes?: number
  }): Promise<DriveFileContentReadResult> {
    const snapshot = await this.getDriveItemPreview({ itemId: input.itemId, surface: "standalone" })
    if (snapshot.current.type !== "file" || !snapshot.preview) {
      throw new Error("该云盘条目没有可读取的文件预览内容。")
    }
    const text = limitUtf8Preview(snapshot.preview.text, input.maxBytes)
    const html = limitUtf8Preview(snapshot.preview.html, input.maxBytes)
    if (text.value === null && html.value === null) {
      throw new Error("该文件不是可预览的小文本内容，请使用下载工具。")
    }
    return {
      itemId: snapshot.current.id,
      name: snapshot.current.name,
      kind: snapshot.preview.kind,
      text: text.value,
      html: html.value,
      truncated: snapshot.preview.truncated || text.truncated || html.truncated,
    }
  }

  async downloadDriveFile(input: { readonly itemId: string; readonly outputPath: string }): Promise<{ readonly ok: true; readonly path: string }> {
    const response = await this.fetchAuthenticated(currentOwnerDriveDownloadUrl(input.itemId), {}, "文件下载失败。")
    await writeResponseBodyToFile(response, input.outputPath)
    return { ok: true, path: input.outputPath }
  }

  async resolveDriveLink(input: DriveLinkResolveInput): Promise<DriveLinkResolveDto> {
    return this.requestAuthenticatedJson<DriveLinkResolveDto>("POST", `${apiBaseUrl()}/drive/link-intake/resolve`, input, "云盘链接解析失败。")
  }

  async listDriveLink(input: DriveLinkListInput): Promise<DriveLinkListDto> {
    return this.requestAuthenticatedJson<DriveLinkListDto>("POST", `${apiBaseUrl()}/drive/link-intake/list`, input, "云盘链接目录加载失败。")
  }

  async readDriveLinkText(input: DriveLinkReadTextInput): Promise<DriveLinkReadTextDto> {
    return this.requestAuthenticatedJson<DriveLinkReadTextDto>("POST", `${apiBaseUrl()}/drive/link-intake/read-text`, input, "云盘链接正文读取失败。")
  }

  async materializeDriveLink(input: DriveLinkMaterializeInput): Promise<DriveLinkMaterializeDto> {
    const baseInput: DriveLinkListInput = {
      url: input.url,
      password: input.password,
    }
    const root = await createDriveLinkIntakeRunDirectory()
    const files: Array<DriveLinkMaterializeDto["files"][number]> = []
    const skipped: Array<DriveLinkMaterializeDto["skipped"][number]> = []
    const warnings: string[] = []
    const materializedPathKeys = new Map<string, string>()
    let totalBytes = 0
    let materializedFileCount = 0
    const scope = input.scope ?? "text"
    const maxFiles = scope === "entry" ? 1 : input.maxFiles ?? DRIVE_LINK_INTAKE_DEFAULT_MAX_FILES
    const maxBytes = input.maxBytes ?? DRIVE_LINK_INTAKE_DEFAULT_MAX_BYTES
    const queue: Array<{ readonly itemId?: string; readonly path?: string; readonly prefix: string }> = [{ prefix: "" }]
    let maxFilesReached = false
    let listedEntryCount = 0
    const addMaterializedFile = (file: DriveLinkMaterializeDto["files"][number]): void => {
      files.push(file)
      if (file.kind !== "folder") materializedFileCount += 1
    }
    const reserveMaterializedPath = (relativePath: string): void => {
      const key = driveLinkMaterializePathKey(relativePath)
      const existing = materializedPathKeys.get(key)
      if (existing !== undefined) {
        throw new Error(`云盘链接包含重复或大小写冲突路径：${existing} / ${relativePath}`)
      }
      materializedPathKeys.set(key, relativePath)
    }
    const releaseMaterializedPath = (relativePath: string): void => {
      materializedPathKeys.delete(driveLinkMaterializePathKey(relativePath))
    }
    const finish = async (): Promise<DriveLinkMaterializeDto> => {
      if (maxFilesReached) warnings.push("文件数量达到上限，剩余文件未落盘。")
      const entry = files.find((file) => file.kind !== "folder" && file.relativePath.toLowerCase() === "index.html")
        ?? files.find((file) => file.kind !== "folder")
      const entryPath = entry ? path.join(root.contentPath, entry.relativePath) : null
      const manifest = { sourceUrl: driveLinkManifestSourceUrl(input.url), fetchedAt: new Date().toISOString(), scope: input.scope ?? "text", files, skipped, warnings }
      await writeFile(root.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
      return { localRootPath: root.rootPath, manifestPath: root.manifestPath, entryPath, files, skipped, warnings }
    }
    const materializeRootFile = async (): Promise<void> => {
      const resolved = await this.resolveDriveLink(baseInput)
      if (resolved.root.type === "folder") return
      const relativePath = safeDriveLinkOutputPath(resolved.root.name || "download")
      if (materializedFileCount >= maxFiles) {
        skipped.push({ path: relativePath, reason: "max-files" })
        maxFilesReached = true
        return
      }
      const outputPath = path.join(root.contentPath, relativePath)
      if (isDriveLinkTextPreview(resolved.root.previewKind)) {
        reserveMaterializedPath(relativePath)
        const text = await this.readDriveLinkText(baseInput)
        const bytes = Buffer.byteLength(text.text, "utf8")
        if (totalBytes + bytes > maxBytes) {
          releaseMaterializedPath(relativePath)
          skipped.push({ path: relativePath, reason: "max-bytes" })
          return
        }
        await mkdir(path.dirname(outputPath), { recursive: true })
        await writeFile(outputPath, text.text, "utf8")
        totalBytes += bytes
        addMaterializedFile({ relativePath, kind: driveLinkFileKind(text.previewKind, text.mimeType), size: String(bytes) })
        return
      }
      if (scope !== "all" && scope !== "entry") {
        skipped.push({ path: relativePath, reason: "not-text" })
        return
      }
      reserveMaterializedPath(relativePath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      let downloaded: DriveLinkDownloadFileDto
      try {
        downloaded = await this.downloadDriveLinkFile({
          ...baseInput,
          outputPath,
        }, { maxBytes: Math.max(0, maxBytes - totalBytes) })
      } catch (error) {
        if (!isDriveDownloadMaxBytesExceededError(error)) throw error
        await rm(outputPath, { force: true })
        releaseMaterializedPath(relativePath)
        skipped.push({ path: relativePath, reason: "max-bytes" })
        return
      }
      const actualSize = Number(downloaded.size)
      if (Number.isFinite(actualSize) && totalBytes + actualSize > maxBytes) {
        await rm(outputPath, { force: true })
        releaseMaterializedPath(relativePath)
        skipped.push({ path: relativePath, reason: "max-bytes" })
        return
      }
      totalBytes += Number.isFinite(actualSize) ? actualSize : 0
      addMaterializedFile({ relativePath, kind: driveLinkFileKind(resolved.root.previewKind, downloaded.mimeType), size: downloaded.size })
    }

    if (scope === "entry") {
      await materializeRootFile()
      return finish()
    }

    if (isPublicAssetDriveLink(input.url)) {
      const resolved = await this.resolveDriveLink(baseInput)
      const relativePath = safeDriveLinkOutputPath(resolved.root.name || "download")
      if (materializedFileCount >= maxFiles) {
        skipped.push({ path: relativePath, reason: "max-files" })
        maxFilesReached = true
        return finish()
      }
      if (scope !== "all") {
        skipped.push({ path: relativePath, reason: "not-text" })
        return finish()
      }
      reserveMaterializedPath(relativePath)
      const outputPath = path.join(root.contentPath, relativePath)
      await mkdir(path.dirname(outputPath), { recursive: true })
      let downloaded: DriveLinkDownloadFileDto
      try {
        downloaded = await this.downloadDriveLinkFile({
          ...baseInput,
          outputPath,
        }, { maxBytes })
      } catch (error) {
        if (!isDriveDownloadMaxBytesExceededError(error)) throw error
        await rm(outputPath, { force: true })
        releaseMaterializedPath(relativePath)
        skipped.push({ path: relativePath, reason: "max-bytes" })
        return finish()
      }
      const actualSize = Number(downloaded.size)
      if (Number.isFinite(actualSize) && actualSize > maxBytes) {
        await rm(outputPath, { force: true })
        releaseMaterializedPath(relativePath)
        skipped.push({ path: relativePath, reason: "max-bytes" })
        return finish()
      }
      addMaterializedFile({ relativePath, kind: driveLinkFileKind(resolved.root.previewKind, downloaded.mimeType), size: downloaded.size })
      return finish()
    }

    while (queue.length > 0 && !maxFilesReached) {
      const current = queue.shift()!
      let offset: number | undefined
      do {
        const page = await this.listDriveLink({
          ...baseInput,
          itemId: current.itemId,
          path: current.path,
          offset,
        })
        listedEntryCount += page.items.length
        for (const item of page.items) {
          const relativePath = safeDriveLinkOutputPath(joinDriveLinkRelativePath(current.prefix, item.path || item.name))
          if (item.type === "folder") {
            reserveMaterializedPath(relativePath)
            await mkdir(path.join(root.contentPath, relativePath), { recursive: true })
            addMaterializedFile({ relativePath, kind: "folder", size: "0" })
            if (item.itemId) queue.push({ itemId: item.itemId, prefix: relativePath })
            continue
          }
          if (materializedFileCount >= maxFiles) {
            skipped.push({ path: relativePath, reason: "max-files" })
            maxFilesReached = true
            continue
          }
          const outputPath = path.join(root.contentPath, relativePath)
          if (isDriveLinkTextPreview(item.previewKind)) {
            reserveMaterializedPath(relativePath)
            const text = await this.readDriveLinkText({
              ...baseInput,
              itemId: item.itemId ?? undefined,
              path: relativePath,
            })
            const bytes = Buffer.byteLength(text.text, "utf8")
            if (totalBytes + bytes > maxBytes) {
              releaseMaterializedPath(relativePath)
              skipped.push({ path: relativePath, reason: "max-bytes" })
              continue
            }
            await mkdir(path.dirname(outputPath), { recursive: true })
            await writeFile(outputPath, text.text, "utf8")
            totalBytes += bytes
            addMaterializedFile({ relativePath, kind: driveLinkFileKind(text.previewKind, text.mimeType), size: String(bytes) })
            continue
          }
          if (scope !== "all") {
            skipped.push({ path: relativePath, reason: "not-text" })
            continue
          }
          const declaredSize = parseDriveLinkSize(item.size)
          if (declaredSize !== null && totalBytes + declaredSize > maxBytes) {
            skipped.push({ path: relativePath, reason: "max-bytes" })
            continue
          }
          reserveMaterializedPath(relativePath)
          await mkdir(path.dirname(outputPath), { recursive: true })
          let downloaded: DriveLinkDownloadFileDto
          try {
            downloaded = await this.downloadDriveLinkFile({
              ...baseInput,
              itemId: item.itemId ?? undefined,
              path: relativePath,
              outputPath,
            }, { maxBytes: Math.max(0, maxBytes - totalBytes) })
          } catch (error) {
            if (!isDriveDownloadMaxBytesExceededError(error)) throw error
            await rm(outputPath, { force: true })
            releaseMaterializedPath(relativePath)
            skipped.push({ path: relativePath, reason: "max-bytes" })
            continue
          }
          const actualSize = Number(downloaded.size)
          if (Number.isFinite(actualSize) && totalBytes + actualSize > maxBytes) {
            await rm(outputPath, { force: true })
            releaseMaterializedPath(relativePath)
            skipped.push({ path: relativePath, reason: "max-bytes" })
            continue
          }
          totalBytes += Number.isFinite(actualSize) ? actualSize : 0
          addMaterializedFile({ relativePath, kind: driveLinkFileKind(item.previewKind, downloaded.mimeType ?? item.mimeType), size: downloaded.size })
        }
        offset = page.page.hasMore ? page.page.nextOffset ?? undefined : undefined
        if (page.page.hasMore && offset === undefined) warnings.push("目录还有更多文件，本次只处理了可定位的页面。")
      } while (offset !== undefined && !maxFilesReached)
    }

    if (listedEntryCount === 0 && files.length === 0 && skipped.length === 0) {
      await materializeRootFile()
    }

    return finish()
  }

  async downloadDriveLinkFile(input: DriveLinkDownloadFileInput, options: { readonly maxBytes?: number } = {}): Promise<DriveLinkDownloadFileDto> {
    const targetPath = input.outputPath ?? path.join((await createDriveLinkIntakeRunDirectory()).contentPath, "download")
    const { outputPath: _outputPath, ...request } = input
    const response = await this.fetchAuthenticated(`${apiBaseUrl()}/drive/link-intake/download-file`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    }, "云盘链接下载失败。")
    await writeResponseBodyToFile(response, targetPath, options)
    const fileStat = await safeLocalFileStat(targetPath)
    return {
      localPath: targetPath,
      mimeType: response.headers.get("Content-Type"),
      size: response.headers.get("Content-Length") ?? String(fileStat?.size ?? 0),
    }
  }

  async downloadDriveFolderZip(input: { readonly itemId: string; readonly outputPath: string }): Promise<{ readonly ok: true; readonly path: string }> {
    const response = await this.fetchAuthenticated(currentOwnerDriveDownloadUrl(input.itemId), {}, "文件夹下载失败。")
    await writeResponseBodyToFile(response, input.outputPath)
    return { ok: true, path: input.outputPath }
  }

  async listDriveFileVersions(itemId: string, input?: DriveFileVersionListInput): Promise<DriveFileVersionListPageDto> {
    return this.getAuthenticatedJson<DriveFileVersionListPageDto>(
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/versions${driveVersionListQuery(input)}`,
      "历史版本加载失败。",
    )
  }

  async downloadDriveFileVersion(input: {
    readonly itemId: string
    readonly versionId: string
    readonly outputPath: string
  }): Promise<{ readonly ok: true; readonly path: string }> {
    const response = await this.fetchAuthenticated(
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(input.itemId)}/versions/${encodeURIComponent(input.versionId)}/download`,
      {},
      "历史版本下载失败。",
    )
    await writeResponseBodyToFile(response, input.outputPath)
    return { ok: true, path: input.outputPath }
  }

  async restoreDriveFileVersion(itemId: string, versionId: string): Promise<DriveItemDto> {
    return this.requestAuthenticatedJson<DriveItemDto>(
      "POST",
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}/restore`,
      undefined,
      "历史版本恢复失败。",
    )
  }

  async deleteDriveFileVersion(itemId: string, versionId: string): Promise<{ readonly ok: true; readonly deletePending?: boolean }> {
    return this.requestAuthenticatedJson<{ readonly ok: true; readonly deletePending?: boolean }>(
      "DELETE",
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
      undefined,
      "历史版本删除失败。",
    )
  }

  async updateDriveFileVersionPin(itemId: string, versionId: string, isPinned: boolean): Promise<DriveFileVersionDto> {
    return this.requestAuthenticatedJson<DriveFileVersionDto>(
      "PATCH",
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(versionId)}`,
      { isPinned },
      "历史版本保留状态保存失败。",
    )
  }

  async prepareDriveUpload(input: {
    parentId?: string | null
    name: string
    size: string
    mimeType?: string | null
    expectedItemId?: string | null
  }): Promise<DriveUploadPrepareResult> {
    return this.requestAuthenticatedJson<DriveUploadPrepareResult>("POST", `${apiBaseUrl()}/drive/uploads/prepare`, {
      parentId: input.parentId ?? null,
      name: input.name,
      size: input.size,
      mimeType: input.mimeType ?? null,
      ...(input.expectedItemId ? { expectedItemId: input.expectedItemId } : {}),
    }, "上传准备失败。")
  }

  async prepareDriveFolderUpload(input: {
    parentId?: string | null
    folderName: string
    directories?: Array<{ relativePath: string }>
    files: Array<{ relativePath: string; size: string; mimeType?: string | null }>
  }): Promise<DriveFolderUploadPrepareResult> {
    return this.requestAuthenticatedJson<DriveFolderUploadPrepareResult>("POST", `${apiBaseUrl()}/drive/uploads/folder/prepare`, {
      parentId: input.parentId ?? null,
      folderName: input.folderName,
      ...(input.directories ? { directories: input.directories.map((directory) => ({ relativePath: directory.relativePath })) } : {}),
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

  async uploadDriveLocalItems(
    input: DriveLocalUploadRequest,
    options: { readonly onProgress?: (event: DriveLocalUploadProgressEvent) => void } = {},
  ): Promise<DriveLocalUploadResult> {
    let completed = 0
    let completedDirectories = 0
    let failed = 0
    let skipped = 0
    let firstError: string | undefined
    const progress = { taskId: input.taskId, onProgress: options.onProgress }

    for (const [itemIndex, item] of input.items.entries()) {
      const result = item.kind === "file"
        ? await this.uploadDriveLocalFile(input.parentId ?? null, item, progress, driveLocalUploadItemKey(itemIndex))
        : await this.uploadDriveLocalFolder(input.parentId ?? null, item, progress, itemIndex)
      completed += result.completed
      completedDirectories += result.completedDirectories ?? 0
      failed += result.failed
      skipped += result.skipped
      firstError ??= result.message
    }

    return {
      completed,
      ...(completedDirectories > 0 ? { completedDirectories } : {}),
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

  async deleteDriveItem(itemId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}`, undefined, "删除失败。")
  }

  async shareDriveItem(itemId: string, settings?: DriveAccessSettingsUpdateInput): Promise<DriveShareDto> {
    const share = await this.requestAuthenticatedJson<DriveShareDto>("POST", `${apiBaseUrl()}/drive/items/${encodeURIComponent(itemId)}/share`, settings, "分享失败。")
    return withCurrentDriveShareUrl(share)
  }

  async disableDriveShare(shareId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>("DELETE", `${apiBaseUrl()}/drive/shares/${encodeURIComponent(shareId)}`, undefined, "取消分享失败。")
  }

  async getDriveUsage(): Promise<DriveUsageDto> {
    return this.getAuthenticatedJson<DriveUsageDto>(`${apiBaseUrl()}/drive/usage`, "云盘用量加载失败。")
  }

  async getDriveStats(): Promise<DriveStatsDto> {
    return this.getAuthenticatedJson<DriveStatsDto>(`${apiBaseUrl()}/drive/stats`, "云盘统计加载失败。")
  }

  async listDriveChanges(input: DriveChangeListInput = {}): Promise<DriveChangeListPageDto> {
    const params = new URLSearchParams()
    if (input.cursor) params.set("cursor", input.cursor)
    if (input.limit !== undefined) params.set("limit", String(input.limit))
    if (input.rootItemId) params.set("rootItemId", input.rootItemId)
    if (input.rootPathHint) params.set("rootPathHint", input.rootPathHint)
    const query = params.toString()
    return this.getAuthenticatedJson<DriveChangeListPageDto>(
      `${apiBaseUrl()}/drive/changes${query ? `?${query}` : ""}`,
      "云盘变更加载失败。",
    )
  }

  async listDriveItemTree(input: DriveItemTreeListInput): Promise<DriveItemTreeListPageDto> {
    const params = new URLSearchParams()
    if (input.parentId) params.set("parentId", input.parentId)
    if (input.offset !== undefined) params.set("offset", String(input.offset))
    if (input.limit !== undefined) params.set("limit", String(input.limit))
    const query = params.toString()
    return this.getAuthenticatedJson<DriveItemTreeListPageDto>(
      `${apiBaseUrl()}/drive/items/tree${query ? `?${query}` : ""}`,
      "云盘目录树加载失败。",
    )
  }

  async ensureDriveFolderPath(input: DriveFolderPathEnsureInput): Promise<DriveFolderPathEnsureResultDto> {
    return this.requestAuthenticatedJson<DriveFolderPathEnsureResultDto>(
      "POST",
      `${apiBaseUrl()}/drive/folders/ensure-path`,
      { parentId: input.parentId ?? null, segments: input.segments },
      "云盘文件夹路径创建失败。",
    )
  }

  async previewDriveReorganization(input: DriveReorganizationPreviewInput): Promise<DriveReorganizationPreviewDto> {
    return this.requestAuthenticatedJson<DriveReorganizationPreviewDto>(
      "POST",
      `${apiBaseUrl()}/drive/reorganizations/preview`,
      input,
      "云盘整理预检失败。",
    )
  }

  async applyDriveReorganization(input: DriveReorganizationApplyInput): Promise<DriveReorganizationApplyResultDto> {
    return this.requestAuthenticatedJson<DriveReorganizationApplyResultDto>(
      "POST",
      `${apiBaseUrl()}/drive/reorganizations/apply`,
      input,
      "云盘整理应用失败。",
    )
  }

  private async uploadDriveLocalFile(
    parentId: string | null,
    item: DriveLocalUploadFileItem,
    progress: DriveLocalUploadProgressReporter,
    itemKey: string,
  ): Promise<DriveLocalUploadResult> {
    const fileStat = await safeLocalFileStat(item.path)
    if (!fileStat?.isFile()) {
      logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFile", reason: "not-file" })
      emitDriveLocalUploadProgress(progress, { type: "item-skipped", itemKey, message: "本地文件不可读取。" })
      return { completed: 0, failed: 0, skipped: 1 }
    }
    const uploadLimits = await getDriveUploadLimits()
    if (fileStat.size > uploadLimits.maxFileBytes) {
      const message = driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel)
      emitDriveLocalUploadProgress(progress, { type: "item-failed", itemKey, message })
      return { completed: 0, failed: 1, skipped: 0, message }
    }

    let prepared: DriveUploadPrepareResult
    try {
      prepared = await this.prepareDriveUpload({
        parentId,
        name: item.name,
        size: String(fileStat.size),
        mimeType: item.mimeType ?? null,
        expectedItemId: item.expectedItemId ?? null,
      })
    } catch (error) {
      const message = localUploadErrorMessage(error)
      emitDriveLocalUploadProgress(progress, { type: "item-failed", itemKey, message })
      return { completed: 0, failed: 1, skipped: 0, message }
    }

    try {
      emitDriveLocalUploadProgress(progress, { type: "item-started", itemKey })
      await this.putPreparedUploadFromPath(prepared.upload, item.path, fileStat.size, {
        onProgress: (uploadedBytes, totalBytes) => {
          emitDriveLocalUploadProgress(progress, { type: "item-progress", itemKey, uploadedBytes, totalBytes })
        },
      })
      await this.completeDriveUploadWithRetry(prepared.sessionId)
      emitDriveLocalUploadProgress(progress, { type: "item-completed", itemKey })
      return { completed: 1, failed: 0, skipped: 0 }
    } catch (error) {
      await this.cancelPreparedDriveUpload(prepared.sessionId, "uploadDriveLocalFile")
      const message = localUploadErrorMessage(error)
      emitDriveLocalUploadProgress(progress, { type: "item-failed", itemKey, message })
      return { completed: 0, failed: 1, skipped: 0, message }
    }
  }

  private async uploadDriveLocalFolder(
    parentId: string | null,
    item: DriveLocalUploadFolderItem,
    progress: DriveLocalUploadProgressReporter,
    itemIndex: number,
  ): Promise<DriveLocalUploadResult> {
    const files: Array<{
      path: string
      relativePath: string
      size: string
      sizeBytes: number
      mimeType: string | null
      itemKey: string
    }> = []
    const seenRelativePaths = new Set<string>()
    let skipped = 0

    const directories: Array<{ relativePath: string }> = []
    const seenDirectoryPaths = new Set<string>()
    for (const directory of item.directories ?? []) {
      if (!isSafeDriveRelativePath(directory.relativePath)) {
        skipped += 1
        logger.warn("Drive local upload skipped.", {
          operation: "uploadDriveLocalFolder",
          reason: "invalid-directory-relative-path",
        })
        continue
      }
      if (seenDirectoryPaths.has(directory.relativePath)) {
        skipped += 1
        logger.warn("Drive local upload skipped.", {
          operation: "uploadDriveLocalFolder",
          reason: "duplicate-directory-relative-path",
        })
        continue
      }
      seenDirectoryPaths.add(directory.relativePath)
      directories.push({ relativePath: directory.relativePath })
    }

    for (const [fileIndex, file] of item.files.entries()) {
      const itemKey = driveLocalUploadItemKey(itemIndex, fileIndex)
      if (!isSafeDriveRelativePath(file.relativePath)) {
        skipped += 1
        emitDriveLocalUploadProgress(progress, { type: "item-skipped", itemKey, message: "文件路径无效。" })
        logger.warn("Drive local upload skipped.", {
          operation: "uploadDriveLocalFolder",
          reason: "invalid-relative-path",
        })
        continue
      }

      if (seenRelativePaths.has(file.relativePath)) {
        skipped += 1
        emitDriveLocalUploadProgress(progress, { type: "item-skipped", itemKey, message: "文件路径重复。" })
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
        emitDriveLocalUploadProgress(progress, { type: "item-skipped", itemKey, message: "本地文件不可读取。" })
        logger.warn("Drive local upload skipped.", { operation: "uploadDriveLocalFolder", reason: "not-file" })
        continue
      }

      files.push({
        path: file.path,
        relativePath: file.relativePath,
        size: String(fileStat.size),
        sizeBytes: fileStat.size,
        mimeType: file.mimeType ?? null,
        itemKey,
      })
    }

    if (files.length === 0 && item.files.length > 0 && directories.length === 0) return { completed: 0, failed: 0, skipped }
    const uploadLimits = await getDriveUploadLimits()
    if (files.some((file) => file.sizeBytes > uploadLimits.maxFileBytes)) {
      const message = driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel)
      for (const file of files) {
        emitDriveLocalUploadProgress(progress, {
          type: "item-failed",
          itemKey: file.itemKey,
          message,
        })
      }
      return { completed: 0, failed: files.length, skipped, message }
    }

    let prepared: DriveFolderUploadPrepareResult
    try {
      prepared = await this.prepareDriveFolderUpload({
        parentId,
        folderName: item.folderName,
        ...(directories.length > 0 ? { directories } : {}),
        files: files.map((file) => ({
          relativePath: file.relativePath,
          size: file.size,
          mimeType: file.mimeType,
        })),
      })
    } catch (error) {
      const message = localUploadErrorMessage(error)
      for (const file of files) {
        emitDriveLocalUploadProgress(progress, {
          type: "item-failed",
          itemKey: file.itemKey,
          message,
        })
      }
      return { completed: 0, failed: files.length, skipped, message }
    }

    const preparedByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
    let completed = 0
    let failed = 0
    let firstError: string | undefined

    for (const file of files) {
      const itemKey = file.itemKey
      const preparedEntry = preparedByPath.get(file.relativePath)
      if (!preparedEntry) {
        failed += 1
        const message = localUploadErrorMessage()
        firstError ??= message
        emitDriveLocalUploadProgress(progress, { type: "item-failed", itemKey, message })
        continue
      }

      try {
        emitDriveLocalUploadProgress(progress, { type: "item-started", itemKey })
        await this.putPreparedUploadFromPath(preparedEntry.upload, file.path, file.sizeBytes, {
          onProgress: (uploadedBytes, totalBytes) => {
            emitDriveLocalUploadProgress(progress, { type: "item-progress", itemKey, uploadedBytes, totalBytes })
          },
        })
        await this.completeDriveUploadWithRetry(preparedEntry.sessionId)
        emitDriveLocalUploadProgress(progress, { type: "item-completed", itemKey })
        completed += 1
      } catch (error) {
        failed += 1
        const message = localUploadErrorMessage(error)
        firstError ??= message
        emitDriveLocalUploadProgress(progress, { type: "item-failed", itemKey, message })
        await this.cancelPreparedDriveUpload(preparedEntry.sessionId, "uploadDriveLocalFolder")
      }
    }

    if (completed === 0 && failed > 0 && prepared.rootCreated) {
      await this.cleanupFailedFolderUploadRoot(prepared.root.id, {
        failed,
        skipped,
      })
    }

    return {
      completed,
      ...(failed === 0 ? { completedDirectories: 1 + directories.length } : {}),
      failed,
      skipped,
      ...(firstError ? { message: firstError } : {}),
    }
  }

  private async completeDriveUploadWithRetry(sessionId: string): Promise<DriveItemDto> {
    try {
      return await this.completeDriveUpload(sessionId)
    } catch (firstError) {
      if (isAccountHttpError(firstError) && firstError.status === 429) {
        await delay(firstError.retryAfterMs ?? DRIVE_UPLOAD_COMPLETE_RATE_LIMIT_RETRY_DELAY_MS)
      }
      try {
        return await this.completeDriveUpload(sessionId)
      } catch {
        throw firstError
      }
    }
  }

  private async cleanupFailedFolderUploadRoot(
    rootItemId: string,
    input: { readonly failed: number; readonly skipped: number },
  ): Promise<void> {
    try {
      await this.deleteDriveItem(rootItemId)
    } catch (error) {
      logger.warn("Drive local folder upload cleanup failed.", {
        operation: "uploadDriveLocalFolder",
        rootItemId,
        failed: input.failed,
        skipped: input.skipped,
        error,
      })
    }
  }

  private async putPreparedUploadFromPath(
    upload: DriveUploadPrepareResult["upload"],
    filePath: string,
    sizeBytes: number,
    options: { readonly onProgress?: (uploadedBytes: number, totalBytes: number) => void } = {},
  ): Promise<void> {
    const stream = createReadStream(filePath)
    const body = options.onProgress
      ? stream.pipe(createUploadProgressTransform(sizeBytes, options.onProgress))
      : stream
    const init: RequestInit & { duplex: "half" } = {
      method: upload.method,
      headers: withContentLengthHeader(upload.headers, sizeBytes),
      body: body as unknown as RequestInit["body"],
      duplex: "half",
    }

    try {
      const response = await this.fetchImpl(upload.url, init)
      if (!response.ok) throw await createHttpError(upload.method, upload.url, response, "上传失败。")
    } finally {
      stream.destroy()
    }
  }

  private async putPreparedUploadFromBuffer(
    upload: DriveUploadPrepareResult["upload"],
    bytes: Buffer,
  ): Promise<void> {
    const response = await this.fetchImpl(upload.url, {
      method: upload.method,
      headers: withContentLengthHeader(upload.headers, bytes.byteLength),
      body: bytes as unknown as RequestInit["body"],
    })
    if (!response.ok) throw await createHttpError(upload.method, upload.url, response, "上传失败。")
  }

  private async cancelPreparedDriveUpload(sessionId: string, operation: string): Promise<void> {
    await this.cancelDriveUpload(sessionId).catch((error) => {
      logger.warn("Drive local upload cancel failed.", {
        operation,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
  }

  async listDriveShares(input?: DrivePublicLinksPageInput): Promise<DriveShareListPageDto> {
    const result = await this.getAuthenticatedJson<DriveShareListPageDto>(
      `${apiBaseUrl()}/drive/shares${drivePublicLinksPageQuery(input)}`,
      "分享列表加载失败。",
    )
    return {
      ...result,
      items: await Promise.all(result.items.map(withCurrentDriveShareUrl)),
    }
  }

  async getDriveShare(shareId: string): Promise<DriveShareListItemDto> {
    const share = await this.getAuthenticatedJson<DriveShareListItemDto>(
      `${apiBaseUrl()}/drive/shares/${encodeURIComponent(shareId)}`,
      "分享信息加载失败。",
    )
    return withCurrentDriveShareUrl(share)
  }

  async listDrivePublicAssets(input?: DrivePublicLinksPageInput): Promise<DrivePublicAssetListPageDto> {
    return this.getAuthenticatedJson<DrivePublicAssetListPageDto>(
      `${apiBaseUrl()}/drive/public-assets${drivePageQuery(input)}`,
      "公开素材加载失败。",
    )
  }

  async getDrivePublicAsset(assetId: string): Promise<DrivePublicAssetDto> {
    return this.getAuthenticatedJson<DrivePublicAssetDto>(
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}`,
      "公开素材加载失败。",
    )
  }

  async uploadDrivePublicAssets(input: DrivePublicAssetUploadRequest): Promise<DrivePublicAssetUploadResult> {
    const concurrency = 3
    const files = [...input.files]
    const results: DrivePublicAssetUploadResultItem[] = new Array(files.length)
    let nextIndex = 0

    const runNext = async (): Promise<void> => {
      for (;;) {
        const index = nextIndex
        nextIndex += 1
        const file = files[index]
        if (!file) return
        results[index] = await this.uploadDrivePublicAssetFile(file)
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, runNext))
    return { results }
  }

  async uploadDrivePublicAssetBinary(input: DrivePublicAssetBinaryUploadRequest): Promise<DrivePublicAssetDto> {
    const bytes = Buffer.from(input.data)
    const uploadLimits = await getDriveUploadLimits()
    if (bytes.byteLength > uploadLimits.maxFileBytes) {
      throw new Error(driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel))
    }
    const mimeType = await resolveDrivePublicAssetImageMimeType(input.name, input.mimeType)
    const prepared = await this.requestAuthenticatedJson<DriveUploadPrepareResult>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/uploads/prepare`,
      { name: input.name, size: String(bytes.byteLength), mimeType },
      "上传准备失败。",
    )

    try {
      await this.putPreparedUploadFromBuffer(prepared.upload, bytes)
      return await this.completeDrivePublicAssetUploadWithRetry(prepared.sessionId)
    } catch (error) {
      await this.cancelDrivePublicAssetUpload(prepared.sessionId)
      throw error
    }
  }

  async scanDriveDocumentImageSources(input: DriveDocumentImageSourceContext): Promise<DriveDocumentImageSourcesDto> {
    return this.getAuthenticatedJson<DriveDocumentImageSourcesDto>(
      `${apiBaseUrl()}${driveDocumentImageSourcesPath(input)}`,
      "图片来源加载失败。",
    )
  }

  async importDriveDocumentImages(input: DriveDocumentImageImportBridgeRequest): Promise<DriveDocumentImageImportResult> {
    return this.requestAuthenticatedJson<DriveDocumentImageImportResult>(
      "POST",
      `${apiBaseUrl()}${driveDocumentImageSourcesPath(input)}/import`,
      { baseVersionId: input.baseVersionId, sources: input.sources },
      "图片导入失败。",
    )
  }

  async replaceDrivePublicAssetFile(input: { readonly assetId: string } & DrivePublicAssetLocalFile): Promise<DrivePublicAssetDto> {
    const fileStat = await safeLocalFileStat(input.path)
    if (!fileStat?.isFile()) throw new Error("文件不可用。")
    const uploadLimits = await getDriveUploadLimits()
    if (fileStat.size > uploadLimits.maxFileBytes) throw new Error(driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel))
    const mimeType = await resolveDrivePublicAssetImageMimeType(input.name, input.mimeType)

    const prepared = await this.requestAuthenticatedJson<DriveUploadPrepareResult>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(input.assetId)}/replace/prepare`,
      { name: input.name, size: String(fileStat.size), mimeType },
      "替换准备失败。",
    )

    try {
      await this.putPreparedUploadFromPath(prepared.upload, input.path, fileStat.size)
      return await this.completeDrivePublicAssetReplaceWithRetry(input.assetId, prepared.sessionId)
    } catch (error) {
      await this.cancelDrivePublicAssetReplace(input.assetId, prepared.sessionId)
      throw error
    }
  }

  async renameDrivePublicAsset(assetId: string, name: string): Promise<DrivePublicAssetDto> {
    return this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "PATCH",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}`,
      { name },
      "重命名失败。",
    )
  }

  async trashDrivePublicAsset(assetId: string): Promise<DrivePublicAssetDto> {
    return this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "DELETE",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}`,
      undefined,
      "移到回收站失败。",
    )
  }

  async restoreDrivePublicAsset(assetId: string): Promise<DrivePublicAssetDto> {
    return this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}/restore`,
      undefined,
      "恢复失败。",
    )
  }

  async preflightDriveSite(input: { readonly sourceFolderItemId: string }): Promise<DriveSitePreflightDto> {
    const query = new URLSearchParams({ sourceFolderItemId: input.sourceFolderItemId })
    return this.getAuthenticatedJson<DriveSitePreflightDto>(
      `${apiBaseUrl()}/drive/sites/preflight?${query}`,
      "站点预检失败。",
    )
  }

  async createDriveSite(input: DriveSiteCreateInput): Promise<DriveSiteDto> {
    return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>(
      "POST",
      `${apiBaseUrl()}/drive/sites`,
      input,
      "站点发布失败。",
    ))
  }

  async listDriveSites(input?: DriveSiteListInput): Promise<DriveSiteListPageDto> {
    const result = await this.getAuthenticatedJson<DriveSiteListPageDto>(
      `${apiBaseUrl()}/drive/sites${driveSiteListQuery(input)}`,
      "站点列表加载失败。",
    )
    return {
      ...result,
      items: await Promise.all(result.items.map(withCurrentDriveSiteUrl)),
    }
  }

  async updateDriveSiteAccess(input: { readonly siteId: string } & DriveSiteAccessUpdateInput): Promise<DriveSiteDto> {
    return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>(
      "PATCH",
      `${apiBaseUrl()}/drive/sites/${encodeURIComponent(input.siteId)}/access`,
      { accessMode: input.accessMode, ...(input.password === undefined ? {} : { password: input.password }), expiresIn: input.expiresIn },
      "站点访问设置保存失败。",
    ))
  }

  async disableDriveSite(siteId: string): Promise<DriveSiteDto> {
    return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>(
      "POST",
      `${apiBaseUrl()}/drive/sites/${encodeURIComponent(siteId)}/disable`,
      undefined,
      "停用站点失败。",
    ))
  }

  async enableDriveSite(siteId: string): Promise<DriveSiteDto> {
    return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>(
      "POST",
      `${apiBaseUrl()}/drive/sites/${encodeURIComponent(siteId)}/enable`,
      undefined,
      "启用站点失败。",
    ))
  }

  async deleteDriveSite(siteId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>(
      "DELETE",
      `${apiBaseUrl()}/drive/sites/${encodeURIComponent(siteId)}`,
      undefined,
      "删除站点失败。",
    )
  }

  async republishDriveSite(input: { readonly siteId: string; readonly entryPath?: string | null }): Promise<DriveSiteDto> {
    return withCurrentDriveSiteUrl(await this.requestAuthenticatedJson<DriveSiteDto>(
      "POST",
      `${apiBaseUrl()}/drive/sites/${encodeURIComponent(input.siteId)}/republish`,
      { entryPath: input.entryPath },
      "重新发布站点失败。",
    ))
  }

  async listDriveTrash(input?: DrivePublicLinksPageInput): Promise<DriveTrashListPageDto> {
    return this.getAuthenticatedJson<DriveTrashListPageDto>(
      `${apiBaseUrl()}/drive/trash${drivePageQuery(input)}`,
      "回收站加载失败。",
    )
  }

  async restoreDriveTrashItem(input: { readonly itemId: string; readonly kind?: DriveTrashItemDto["kind"]; readonly assetId?: string }): Promise<DriveItemDto | DrivePublicAssetDto> {
    if (input.kind === "public_asset" && input.assetId) {
      return this.restoreDrivePublicAsset(input.assetId)
    }
    return this.requestAuthenticatedJson<DriveItemDto>(
      "POST",
      `${apiBaseUrl()}/drive/items/${encodeURIComponent(input.itemId)}/restore`,
      undefined,
      "恢复失败。",
    )
  }

  async deleteDriveTrashItem(itemId: string): Promise<{ ok: true }> {
    return this.requestAuthenticatedJson<{ ok: true }>(
      "DELETE",
      `${apiBaseUrl()}/drive/trash/${encodeURIComponent(itemId)}`,
      undefined,
      "删除失败。",
    )
  }

  private async uploadDrivePublicAssetFile(file: DrivePublicAssetLocalFile): Promise<DrivePublicAssetUploadResult["results"][number]> {
    const fileStat = await safeLocalFileStat(file.path)
    if (!fileStat?.isFile()) return { status: "rejected", fileName: file.name, message: "文件不可用" }
    const uploadLimits = await getDriveUploadLimits()
    if (fileStat.size > uploadLimits.maxFileBytes) {
      return { status: "rejected", fileName: file.name, message: driveMaxFileSizeMessage(uploadLimits.maxFileSizeLabel) }
    }

    let prepared: DriveUploadPrepareResult
    let mimeType: string
    try {
      mimeType = await resolveDrivePublicAssetImageMimeType(file.name, file.mimeType)
    } catch (error) {
      return {
        status: "rejected",
        fileName: file.name,
        message: error instanceof Error && error.message.trim() ? error.message : localUploadErrorMessage(error),
      }
    }
    try {
      prepared = await this.requestAuthenticatedJson<DriveUploadPrepareResult>(
        "POST",
        `${apiBaseUrl()}/drive/public-assets/uploads/prepare`,
        { name: file.name, size: String(fileStat.size), mimeType },
        "上传准备失败。",
      )
    } catch (error) {
      return { status: "rejected", fileName: file.name, message: localUploadErrorMessage(error) }
    }

    try {
      await this.putPreparedUploadFromPath(prepared.upload, file.path, fileStat.size)
      const asset = await this.completeDrivePublicAssetUploadWithRetry(prepared.sessionId)
      return { status: "fulfilled", fileName: file.name, asset }
    } catch (error) {
      await this.cancelDrivePublicAssetUpload(prepared.sessionId)
      return { status: "rejected", fileName: file.name, message: localUploadErrorMessage(error) }
    }
  }

  private async cancelDrivePublicAssetUpload(sessionId: string): Promise<void> {
    await this.requestAuthenticatedJson<{ ok: true }>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/uploads/${encodeURIComponent(sessionId)}/cancel`,
      undefined,
      "上传取消失败。",
    ).catch((error) => {
      logger.warn("Drive public asset upload cancel failed.", {
        operation: "cancelDrivePublicAssetUpload",
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
  }

  private async completeDrivePublicAssetUpload(sessionId: string): Promise<DrivePublicAssetDto> {
    return this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/uploads/${encodeURIComponent(sessionId)}/complete`,
      undefined,
      "上传确认失败。",
    )
  }

  private async completeDrivePublicAssetUploadWithRetry(sessionId: string): Promise<DrivePublicAssetDto> {
    try {
      return await this.completeDrivePublicAssetUpload(sessionId)
    } catch (firstError) {
      try {
        return await this.completeDrivePublicAssetUpload(sessionId)
      } catch {
        throw firstError
      }
    }
  }

  private async completeDrivePublicAssetReplace(assetId: string, sessionId: string): Promise<DrivePublicAssetDto> {
    return this.requestAuthenticatedJson<DrivePublicAssetDto>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/complete`,
      undefined,
      "替换确认失败。",
    )
  }

  private async completeDrivePublicAssetReplaceWithRetry(assetId: string, sessionId: string): Promise<DrivePublicAssetDto> {
    try {
      return await this.completeDrivePublicAssetReplace(assetId, sessionId)
    } catch (firstError) {
      try {
        return await this.completeDrivePublicAssetReplace(assetId, sessionId)
      } catch {
        throw firstError
      }
    }
  }

  private async cancelDrivePublicAssetReplace(assetId: string, sessionId: string): Promise<void> {
    await this.requestAuthenticatedJson<{ ok: true }>(
      "POST",
      `${apiBaseUrl()}/drive/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/cancel`,
      undefined,
      "替换取消失败。",
    ).catch((error) => {
      logger.warn("Drive public asset replace cancel failed.", {
        operation: "cancelDrivePublicAssetReplace",
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
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

  async refreshFromStorage(options: AccountRefreshFromStorageOptions = {}): Promise<SynapseAccountState> {
    if (this.refreshInFlight) return this.refreshInFlight
    const refresh = this.performRefreshFromStorage(options)
      .finally(() => {
        if (this.refreshInFlight === refresh) {
          this.refreshInFlight = null
        }
      })
    this.refreshInFlight = refresh
    return refresh
  }

  private async performRefreshFromStorage(options: AccountRefreshFromStorageOptions = {}): Promise<SynapseAccountState> {
    const reason = options.reason ?? "manual"
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
            reason,
            status: "active-attempt",
          })
          return this.state
        }
        this.setState({ status: "unauthenticated" })
        logger.info("Desktop account refresh skipped.", {
          operation: "refreshFromStorage",
          reason,
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
      logger.info("Desktop account refreshed from storage.", authenticatedLogMeta("refreshFromStorage", profile, reason))
    } catch (error) {
      logger.warn("Account refresh failed.", {
        operation: "refreshFromStorage",
        reason,
        status: "failed",
        httpStatus: isAccountHttpError(error) ? error.status : undefined,
        code: isAccountHttpError(error) ? error.code : undefined,
        error,
      })
      const latest = await this.readPersisted("Failed to read stored account after account refresh failed.")
      if (attemptedRefreshToken && latest?.refreshToken && latest.refreshToken !== attemptedRefreshToken) {
        logger.info("Ignored stale account refresh failure.", {
          operation: "refreshFromStorage",
          reason,
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
    return this.refreshFromStorage({ reason: "manual" })
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
      await this.refreshFromStorage({ resetRetryBackoff: false, reason: "offline-retry" })
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
  reason?: AccountRefreshReason,
): Record<string, unknown> {
  return {
    operation,
    ...(reason ? { reason } : {}),
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
  const failure = await readHttpFailureBody(response)
  const detailText = failure.detail ? `: ${failure.detail}` : ""
  const error = new Error(
    `${fallbackMessage} (${method} ${endpointPath(url)} HTTP ${response.status})${detailText}`,
  ) as AccountHttpError
  error.status = response.status
  error.url = url
  error.method = method
  error.code = failure.code
  error.retryAfterMs = parseRetryAfterMs(response.headers.get("Retry-After"))
  return error
}

function parseRetryAfterMs(value: string | null): number | undefined {
  const normalized = value?.trim()
  if (!normalized) return undefined
  const seconds = Number(normalized)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000)
  const timestamp = Date.parse(normalized)
  if (Number.isNaN(timestamp)) return undefined
  return Math.max(0, timestamp - Date.now())
}

async function readHttpFailureBody(response: Response): Promise<{ readonly detail: string; readonly code?: string }> {
  const text = await response.text().catch(() => "")
  if (!text) return { detail: "" }

  try {
    const parsed = JSON.parse(text)
    return {
      detail: truncateHttpFailureDetail(JSON.stringify(redactHttpFailureDetail(parsed))),
      code: stableHttpErrorCode(parsed),
    }
  } catch {
    return { detail: truncateHttpFailureDetail(redactSensitiveText(text)) }
  }
}

function stableHttpErrorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("code" in value)) return undefined
  const code = (value as { readonly code?: unknown }).code
  return typeof code === "string" ? code : undefined
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

async function createDriveLinkIntakeRunDirectory(): Promise<{
  readonly rootPath: string
  readonly contentPath: string
  readonly manifestPath: string
}> {
  const rootPath = path.join(app.getPath("userData"), "drive-link-intake", `run_${Date.now()}_${randomBytes(4).toString("hex")}`)
  const contentPath = path.join(rootPath, "content")
  await mkdir(contentPath, { recursive: true })
  return { rootPath, contentPath, manifestPath: path.join(rootPath, "manifest.json") }
}

function safeDriveLinkOutputPath(value: string): string {
  const normalized = value.replace(/\\/gu, "/").split("/").filter(Boolean).join("/")
  if (!isSafeDriveRelativePath(normalized)) {
    throw new Error("云盘链接路径无效。")
  }
  return normalized
}

function driveLinkMaterializePathKey(relativePath: string): string {
  return relativePath
    .split("/")
    .map((segment) => segment.normalize("NFC").toLocaleLowerCase())
    .join("/")
}

function driveLinkFileKind(previewKind: string, mimeType: string | null): "markdown" | "html" | "text" | "image" | "binary" | "folder" {
  if (previewKind === "markdown") return "markdown"
  if (previewKind === "html-source" || mimeType === "text/html") return "html"
  if (previewKind === "image" || mimeType?.startsWith("image/")) return "image"
  if (previewKind === "download-only") return "binary"
  return "text"
}

function isDriveLinkTextPreview(previewKind: string): boolean {
  return previewKind === "markdown" || previewKind === "html-source" || previewKind === "text"
}

function joinDriveLinkRelativePath(prefix: string, childPath: string): string {
  return [prefix, childPath].filter(Boolean).join("/")
}

function isPublicAssetDriveLink(value: string): boolean {
  try {
    return new URL(value).pathname.startsWith("/files/")
  } catch {
    return /(^|\/)files\/[^/?#]+/u.test(value)
  }
}

function parseDriveLinkSize(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function driveLinkManifestSourceUrl(value: string): string {
  try {
    const absolute = /^[a-z][a-z0-9+.-]*:/iu.test(value)
    const parsed = new URL(value, "https://synapse.local")
    for (const key of [...parsed.searchParams.keys()]) {
      if (isSensitiveDriveManifestQueryKey(key)) parsed.searchParams.delete(key)
    }
    return absolute ? parsed.toString() : `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return value.replace(/([?&](?:password|token|access_token|api_?key|signature|sig)=)[^&#]*&?/giu, (match, prefix: string) =>
      prefix.startsWith("?") ? "?" : "",
    ).replace(/[?&]$/u, "")
  }
}

function isSensitiveDriveManifestQueryKey(key: string): boolean {
  return /^(?:password|token|access_token|api_?key|signature|sig)$/iu.test(key)
}

function withContentLengthHeader(headers: Record<string, string>, sizeBytes: number): Record<string, string> {
  if (Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) return headers
  return { ...headers, "Content-Length": String(sizeBytes) }
}

function limitUtf8Preview(value: string | null, maxBytes: number | undefined): { readonly value: string | null; readonly truncated: boolean } {
  if (value === null || maxBytes === undefined) return { value, truncated: false }
  validateUtf8MaxBytes(maxBytes)
  const buffer = Buffer.from(value, "utf8")
  if (buffer.byteLength <= maxBytes) return { value, truncated: false }
  return {
    value: buffer.subarray(0, safeUtf8PrefixLength(buffer, maxBytes)).toString("utf8"),
    truncated: true,
  }
}

function safeUtf8PrefixLength(bytes: Uint8Array, end: number): number {
  if (end <= 0) return 0
  let sequenceStart = end - 1
  while (sequenceStart >= 0 && isUtf8ContinuationByte(bytes[sequenceStart] ?? 0)) {
    sequenceStart -= 1
  }
  if (sequenceStart < 0) return 0
  const expectedLength = utf8SequenceLength(bytes[sequenceStart] ?? 0)
  if (expectedLength === 0) return sequenceStart
  return end - sequenceStart >= expectedLength ? end : sequenceStart
}

function isUtf8ContinuationByte(byte: number): boolean {
  return (byte & 0xc0) === 0x80
}

function utf8SequenceLength(byte: number): number {
  if ((byte & 0x80) === 0) return 1
  if ((byte & 0xe0) === 0xc0) return 2
  if ((byte & 0xf0) === 0xe0) return 3
  if ((byte & 0xf8) === 0xf0) return 4
  return 0
}

function validateUtf8MaxBytes(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error("maxBytes 必须是非负数字。")
}

class DriveDownloadMaxBytesExceededError extends Error {
  constructor(readonly maxBytes: number) {
    super("下载内容超过 maxBytes。")
    this.name = "DriveDownloadMaxBytesExceededError"
  }
}

function isDriveDownloadMaxBytesExceededError(error: unknown): error is DriveDownloadMaxBytesExceededError {
  return error instanceof DriveDownloadMaxBytesExceededError
}

async function writeResponseBodyToFile(
  response: Response,
  outputPath: string,
  options: { readonly maxBytes?: number } = {},
): Promise<void> {
  if (!response.body) throw new Error("下载响应为空。")
  const maxBytes = normalizeDownloadMaxBytes(options.maxBytes)
  const contentLength = parseDownloadContentLength(response.headers.get("Content-Length"))
  if (maxBytes !== undefined && contentLength !== null && contentLength > maxBytes) {
    throw new DriveDownloadMaxBytesExceededError(maxBytes)
  }
  const outputDir = path.dirname(outputPath)
  await mkdir(outputDir, { recursive: true })
  const tempPath = path.join(outputDir, `.${path.basename(outputPath)}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`)
  try {
    const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0])
    if (maxBytes === undefined) {
      await pipeline(source, createWriteStream(tempPath, { flags: "wx" }))
    } else {
      await pipeline(source, createDownloadMaxBytesTransform(maxBytes), createWriteStream(tempPath, { flags: "wx" }))
    }
    await rename(tempPath, outputPath)
  } catch (error) {
    await rm(tempPath, { force: true }).catch((cleanupError) => {
      logger.warn("Drive download temp file cleanup failed.", {
        operation: "writeResponseBodyToFile",
        errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
        errorCode: errorCode(cleanupError),
      })
    })
    throw error
  }
}

function normalizeDownloadMaxBytes(maxBytes: number | undefined): number | undefined {
  if (maxBytes === undefined) return undefined
  if (!Number.isFinite(maxBytes) || maxBytes < 0) throw new Error("maxBytes 必须是非负数字。")
  return Math.floor(maxBytes)
}

function parseDownloadContentLength(value: string | null): number | null {
  if (!value || !/^\d+$/u.test(value)) return null
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function createDownloadMaxBytesTransform(maxBytes: number): Transform {
  let bytes = 0
  return new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      bytes += typeof chunk === "string" ? Buffer.byteLength(chunk, encoding as BufferEncoding) : chunk.byteLength
      if (bytes > maxBytes) {
        callback(new DriveDownloadMaxBytesExceededError(maxBytes))
        return
      }
      callback(null, chunk)
    },
  })
}

function localUploadErrorMessage(error?: unknown): string {
  if (isAccountHttpError(error) && error.message.trim()) return error.message
  return "上传失败。"
}

function driveLocalUploadItemKey(itemIndex: number, fileIndex?: number): string {
  return fileIndex === undefined ? `item:${itemIndex}` : `item:${itemIndex}:${fileIndex}`
}

function emitDriveLocalUploadProgress(
  reporter: DriveLocalUploadProgressReporter,
  event: DriveLocalUploadProgressEventInput,
): void {
  if (!reporter.taskId) return
  reporter.onProgress?.({ ...event, taskId: reporter.taskId })
}

function createUploadProgressTransform(
  totalBytes: number,
  onProgress: (uploadedBytes: number, totalBytes: number) => void,
): Transform {
  let uploadedBytes = 0
  let lastReportedBytes = 0
  let lastReportedAt = Date.now()

  const reportProgress = (force = false): void => {
    if (uploadedBytes === lastReportedBytes) return

    const now = Date.now()
    if (!force && now - lastReportedAt < 100) return

    lastReportedBytes = uploadedBytes
    lastReportedAt = now
    onProgress(uploadedBytes, totalBytes)
  }

  return new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      uploadedBytes += typeof chunk === "string" ? Buffer.byteLength(chunk, encoding as BufferEncoding) : chunk.byteLength
      reportProgress(uploadedBytes >= totalBytes)
      callback(null, chunk)
    },
    flush(callback) {
      reportProgress(true)
      callback()
    },
  })
}

async function getDriveUploadLimits(): Promise<{ readonly maxFileBytes: number; readonly maxFileSizeLabel: string }> {
  const shared = await sharedUrlsPromise
  return {
    maxFileBytes: shared.DRIVE_MAX_FILE_BYTES,
    maxFileSizeLabel: shared.DRIVE_MAX_FILE_SIZE_LABEL,
  }
}

async function resolveDrivePublicAssetMimeType(name: string, mimeType?: string | null): Promise<string | null> {
  const normalized = typeof mimeType === "string" && mimeType.trim() ? mimeType.trim() : null
  if (normalized) return normalized.toLowerCase()
  const shared = await sharedUrlsPromise
  return shared.inferDrivePublicAssetMimeType(name)
}

async function resolveDrivePublicAssetImageMimeType(name: string, mimeType?: string | null): Promise<string> {
  const shared = await sharedUrlsPromise
  const resolved = await resolveDrivePublicAssetMimeType(name, mimeType)
  const supportedMimeTypes = new Set<string>(Object.values(shared.DRIVE_PUBLIC_ASSET_IMAGE_MIME_BY_EXTENSION))
  if (!resolved || !supportedMimeTypes.has(resolved)) {
    throw new Error(shared.DRIVE_PUBLIC_ASSET_UNSUPPORTED_FORMAT_MESSAGE)
  }
  return resolved
}

function driveMaxFileSizeMessage(label: string): string {
  return `文件超过 ${label} 限制。`
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === "string" ? code : undefined
}

function classifyAccountRefreshFailure(error: unknown): AccountHttpFailureKind {
  if (isAccountHttpError(error)) {
    if (isTerminalRefreshFailureCode(error.code)) return "auth"
    if (error.status === 401 || error.status === 403) return "temporary"
    if (error.status === 429) return "temporary"
    if (error.status >= 500) return "temporary"
    return "other"
  }
  return "temporary"
}

function offlineReasonForFailure(error: unknown): SynapseAccountOfflineReason {
  if (isAccountHttpError(error) && (error.status === 401 || error.status === 403 || error.status === 429 || error.status >= 500)) {
    return "server_unavailable"
  }
  return "network_error"
}

function isTerminalRefreshFailureCode(code: string | undefined): boolean {
  return code === "refresh_invalid"
    || code === "refresh_expired"
    || code === "refresh_revoked"
    || code === "account_disabled"
}

function isAccountHttpError(error: unknown): error is AccountHttpError {
  return error instanceof Error && typeof (error as AccountHttpError).status === "number"
}

export const accountService = new AccountService()
