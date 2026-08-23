import type {
  DashboardWebhookDto,
  DashboardWebhookSecretResult,
  DriveAnnotationCommentDto,
  DriveAnnotationCommentUpdateInput,
  DriveAnnotationCreateInput,
  DriveAnnotationReplyInput,
  DriveAnnotationThreadDto,
  DriveAccessSettingsInput,
  DriveAccessSettingsUpdateInput,
  DriveBrowserPasswordRequiredDto,
  DriveBrowserSnapshotDto,
  DriveCollaborationCheckpointInput,
  DriveCollaborationCheckpointResultDto,
  DriveDocumentImageImportRequest,
  DriveDocumentImageImportResult,
  DriveDocumentImageSourcesDto,
  DriveFileContentUpdateResult,
  DriveFileTextUpdateInput,
  DriveFileVersionDto,
  DriveFileVersionListPageDto,
  DriveItemDto,
  DriveItemLifecycleStatus,
  DriveItemTreeListInput,
  DriveItemTreeListPageDto,
  DrivePublicAssetDto,
  DrivePublicAssetListPageDto,
  DrivePublicLinksPageInput,
  DriveShareDto,
  DriveShareListPageDto,
  DriveSiteAccessUpdateInput,
  DriveSiteCreateInput,
  DriveSiteDto,
  DriveSiteListInput,
  DriveSiteListPageDto,
  DriveSitePreflightDto,
  DriveTrashListPageDto,
  DriveFolderUploadPrepareDirectoryInput,
  DriveFolderUploadPrepareFileInput,
  DriveFolderUploadPrepareResult,
  DriveUploadPrepareResult,
  DriveUsageDto,
  SkillRepositoryDeleteResultDto,
  SkillRepositoryDetailDto,
  SkillRepositoryFileContentDto,
  SkillRepositoryFileDeleteInput,
  SkillRepositoryFileRenameInput,
  SkillRepositoryForkInput,
  SkillRepositoryForkResultDto,
  SkillRepositoryInstallSessionDto,
  SkillRepositoryItemDto,
  SkillRepositoryListResultDto,
  SkillRepositoryPublicListInput,
  SkillRepositoryPublicPathDto,
  SkillRepositoryStatus,
  SkillRepositoryTextSaveInput,
  SkillRepositoryUpdateInput,
  SkillRepositoryVisibility,
  WebhookDeliveryDto,
  WebhookDeliveryHistoryDto,
} from '@synapse/shared'
import { DRIVE_SHARE_UNLOCK_REQUIRED_ERROR_CODE } from '@synapse/shared'
import { ApiError, readErrorMessage, requestJson } from './api-client'

export { ApiError } from './api-client'

export type DashboardSession = {
  email: string
  handle: string | null
  sessionId: string
}

export type AdminSession = {
  actorLabel: '平台管理员'
  sessionId: string
  expiresAt: string
}

export type SystemOverview = {
  serverTime: string
  counts: {
    auditLogs: number
    users: number
  }
  userStatus: {
    active: number
    disabled: number
  }
  dailyTrend: Array<{
    date: string
    label: string
    users: number
    auditLogs: number
  }>
}

export type PaginatedResponse<T> = {
  data: T[]
  total: number
  page: number
  pageSize: number
}

export type AuditLog = {
  id: string
  actorType: 'user' | 'platform_admin' | 'system' | 'unknown'
  actorId: string | null
  actorLabel: string
  adminSessionId: string | null
  action: string
  targetType: string
  targetId: string
  detail: unknown
  ipAddress: string
  createdAt: string
}

export type ProblemFeedbackRow = {
  id: string
  content: string
  receivedAt: string
}

export type AdminUserRow = {
  id: string
  email: string
  handle: string
  adminNote: string | null
  status: 'active' | 'disabled'
  createdAt: string
  updatedAt: string
}

export type LiveClientRow = {
  userId?: string
  clientInstanceId: string
  status: 'online' | 'stale' | 'offline'
  appVersion: string
  platform: string
  deviceName: string
  connectedAt: string | null
  lastSeenAt: string | null
  disconnectedAt?: string
  disconnectReason?: string
}

export type LiveClientChangedEvent = {
  type: 'live.client.changed'
  client: LiveClientRow
  occurredAt: string
}

export type DashboardDeviceRow = {
  userId?: string
  userEmail?: string
  userHandle?: string | null
  clientInstanceId: string
  displayName: string | null
  deviceName: string
  platform: string
  appVersion: string
  status: 'online' | 'stale' | 'offline'
  connectedAt: string | null
  firstSeenAt: string
  lastSeenAt: string | null
  disconnectedAt?: string
  disconnectReason?: string
}

export type DashboardMe = {
  user: {
    id: string
    email: string
    status: 'active' | 'disabled'
    handle: string
  }
  /** @deprecated Team support has been removed. Kept empty for one compatibility release. */
  teams: []
}

export type DashboardApiKey = {
  id: string
  name: string
  prefix: string
  scopes: string[]
  lastUsedAt: string | null
  createdAt: string
}

export type DashboardApiKeyCapability = {
  scope: string
  name: string
  description: string
  documentationUrl: string
}

export type DashboardApiKeyUsageLog = {
  id: string
  requestId: string
  operation: 'grant_create' | 'download'
  status: 'started' | 'succeeded' | 'failed' | 'aborted'
  httpStatus: number | null
  errorCode: string | null
  sourceType: string | null
  artifactType: string | null
  durationMs: number | null
  responseBytes: string | null
  startedAt: string
  completedAt: string | null
}

export type DashboardApiKeyCreateResult = {
  apiKey: DashboardApiKey
  secret: string
}

export type AdminSkillRepositoryRow = {
  id: string
  name: string
  title: string
  visibility: SkillRepositoryVisibility
  status: SkillRepositoryStatus
  owner: {
    id: string
    handle: string
  }
  updatedAt: string
}

export type AdminSkillRepositoryListQuery = PaginationOptions & {
  status?: SkillRepositoryStatus
  query?: string
}

export type BackupFile = {
  filename: string
  size: number
  createdAt: string
}

export type BackupResult = {
  filename: string
  size: number
  uploadedAt: string
  status: 'success' | 'failed'
  error?: string
}

export type LogFileInfo = {
  name: string
  size: number
  modifiedAt: string
}

export type LogEntry = {
  time: string
  level: string
  msg: string
  req?: { method: string; url: string }
  err?: { message: string; stack: string }
}

export type UserTokenPair = {
  accessToken: string
  refreshToken: string
}

export type UserRegistrationResult = {
  ok: true
}

export type PasswordResetRequestResult = {
  ok: true
  resetUrl?: string
  expiresAt?: string
}

export type DesktopAuthorizeInput = {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
  codeChallengeMethod: 'S256'
}

export type DesktopAuthorizationResult = {
  code: string
  deepLinkUrl: string
  expiresAt: string
}

export type AdminDriveItemRow = {
  id: string
  parentId: string | null
  type: 'file' | 'folder'
  name: string
  size: string
  mimeType: string | null
  storageStatus: 'pending' | 'active' | 'delete_pending' | 'deleted' | 'failed'
  shared: boolean
  activeShareId?: string | null
  createdAt: string
  updatedAt: string
  userId: string
  userEmail?: string | null
  storageDeletePending: boolean
  lifecycleStatus: DriveItemLifecycleStatus
}

export type AdminDrivePublicAssetRow = DrivePublicAssetDto & {
  owner: {
    userId: string
    email: string | null
  }
}

export type AdminDrivePublicAssetAccessLogRow = {
  id: string
  assetId: string
  publicAssetId: string | null
  userId: string | null
  method: string
  statusCode: number
  bytes: string
  ip: string | null
  referer: string | null
  userAgent: string | null
  accessedAt: string
  createdAt: string
}

export type AdminDrivePublicAssetRevisionRow = {
  id: string
  assetId: string
  publicAssetId: string | null
  itemId: string
  name: string
  originalName: string
  size: string
  mimeType: string | null
  etag: string | null
  replacedBy: string | null
  createdAt: string
  replacedAt: string
}

export type AdminDriveStorageSummary = {
  normalDrive: AdminDriveStorageBucket
  publicAssets: AdminDriveStorageBucket
  publicAssetRevisions: {
    count: number
    bytes: string
  }
  total: {
    quotaBytes: string
    adminVisibleBytes: string
  }
}

export type AdminDriveStorageBucket = {
  active: AdminDriveStorageStatus
  trashed: AdminDriveStorageStatus
  hidden: AdminDriveStorageStatus
}

export type AdminDriveStorageStatus = {
  count: number
  bytes: string
}

const consoleApiBasePath = '/api/console'
const legacyDashboardApiBasePath = '/api/dashboard'
const adminApiBasePath = '/api/admin'
const skillRepositoryApiBasePath = '/api/skill-repositories'
const driveApiBasePath = '/api/drive'
const driveBrowserApiBasePath = '/api/drive/browser'
const desktopAuthorizePath = '/api/auth/desktop/authorize'
const userAuthExpiredListeners = new Set<() => void>()
const adminAuthExpiredListeners = new Set<() => void>()

async function request<T>(path: string, options: RequestInit = {}) {
  try {
    return await requestJson<T>(path, options)
  } catch (error) {
    const isAdminUnlockFailure = path === `${adminApiBasePath}/session` && options.method === 'POST'
    if (!isAdminUnlockFailure && error instanceof ApiError && shouldNotifyAuthExpired(path, error.status, error.code)) {
      notifyAuthExpired(path)
    }
    throw error
  }
}

export function subscribeAuthExpired(listener: () => void) {
  userAuthExpiredListeners.add(listener)
  return () => {
    userAuthExpiredListeners.delete(listener)
  }
}

export function subscribeAdminAuthExpired(listener: () => void) {
  adminAuthExpiredListeners.add(listener)
  return () => {
    adminAuthExpiredListeners.delete(listener)
  }
}

function notifyAuthExpired(path: string) {
  const listeners = path.startsWith(adminApiBasePath)
    ? adminAuthExpiredListeners
    : userAuthExpiredListeners
  for (const listener of listeners) {
    listener()
  }
}

export function shouldNotifyAuthExpired(path: string, status: number, errorCode?: string) {
  if (path === desktopAuthorizePath) {
    return status === 401 || status === 403
  }
  if (status !== 401) return false
  if (errorCode === DRIVE_SHARE_UNLOCK_REQUIRED_ERROR_CODE) return false
  if (
    !path.startsWith(adminApiBasePath) &&
    !path.startsWith(consoleApiBasePath) &&
    !path.startsWith(legacyDashboardApiBasePath) &&
    !path.startsWith(skillRepositoryApiBasePath) &&
    !isProtectedDriveApiPath(path)
  ) {
    return false
  }
  const authExemptPaths = [
    `${consoleApiBasePath}/login`,
    `${consoleApiBasePath}/logout`,
    `${consoleApiBasePath}/session`,
    `${legacyDashboardApiBasePath}/login`,
    `${legacyDashboardApiBasePath}/logout`,
    `${legacyDashboardApiBasePath}/session`,
  ]
  return ![
    ...authExemptPaths,
  ].includes(path)
}

function isProtectedDriveApiPath(path: string) {
  if (!path.startsWith(`${driveApiBasePath}/`)) return false
  if (path.startsWith(`${driveBrowserApiBasePath}/shares/`)) {
    return isProtectedDriveShareBrowserPath(path)
  }
  if (path.startsWith(`${driveApiBasePath}/local-upload/`)) return false
  if (path.startsWith(`${driveApiBasePath}/local-download/`)) return false
  return true
}

function isProtectedDriveShareBrowserPath(path: string) {
  return new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/content(?:[?#].*)?$`, 'u').test(path)
    || new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/image-sources(?:/import)?(?:[?#].*)?$`, 'u').test(path)
    || new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/collaboration/checkpoint(?:[?#].*)?$`, 'u').test(path)
    || isProtectedDriveShareAnnotationPath(path)
}

function isProtectedDriveShareAnnotationPath(path: string) {
  return new RegExp(`^${driveBrowserApiBasePath}/shares/[^/?#]+(?:/items/[^/?#]+)?/annotations(?:/[^/?#]+/comments|/comments/[^/?#]+|/[^/?#]+)?(?:[?#].*)?$`, 'u').test(path)
}

type PaginationOptions = {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type AdminDriveListQuery = PaginationOptions & {
  userId?: string
  type?: AdminDriveItemRow['type']
  storageStatus?: AdminDriveItemRow['storageStatus']
  shared?: 'true' | 'false'
  search?: string
}

export type AdminDrivePublicAssetListQuery = PaginationOptions & {
  search?: string
  userId?: string
  lifecycleStatus?: DriveItemLifecycleStatus
}

export type WebhookDeliveryHistoryQuery = PaginationOptions & {
  webhookId?: string
  status?: string
  from?: string
  to?: string
  userId?: string
  user?: string
}

function paginationSuffix(options: PaginationOptions) {
  const query = new URLSearchParams()
  if (options.page) query.set('page', String(options.page))
  if (options.pageSize) query.set('pageSize', String(options.pageSize))
  if (options.sortBy) query.set('sortBy', options.sortBy)
  if (options.sortOrder) query.set('sortOrder', options.sortOrder)
  const value = query.toString()
  return value ? `?${value}` : ''
}

function adminSkillRepositoryQuerySuffix(options: AdminSkillRepositoryListQuery = {}) {
  return querySuffix({
    page: options.page,
    pageSize: options.pageSize,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    status: options.status,
    query: options.query,
  })
}

function adminDriveQuerySuffix(options: AdminDriveListQuery = {}) {
  return querySuffix({
    page: options.page,
    pageSize: options.pageSize,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    userId: options.userId,
    type: options.type,
    storageStatus: options.storageStatus,
    shared: options.shared,
    search: options.search,
  })
}

function adminDrivePublicAssetQuerySuffix(options: AdminDrivePublicAssetListQuery = {}) {
  return querySuffix({
    page: options.page,
    pageSize: options.pageSize,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    search: options.search,
    userId: options.userId,
    lifecycleStatus: options.lifecycleStatus,
  })
}

function querySuffix(options: Record<string, string | number | undefined>) {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined && value !== '') {
      query.set(key, String(value))
    }
  }
  const value = query.toString()
  return value ? `?${value}` : ''
}

function dateQueryValue(value: Date) {
  return value.toISOString().slice(0, 10)
}

function subscribeServerEvents<TEvent>(
  path: string,
  eventType: string,
  onEvent: (event: TEvent) => void,
  onError?: () => void
) {
  const source = new EventSource(path, { withCredentials: true })

  source.addEventListener(eventType, (message) => {
    try {
      onEvent(JSON.parse((message as MessageEvent<string>).data) as TEvent)
    } catch {
      onError?.()
    }
  })
  source.onerror = () => {
    onError?.()
  }

  return () => {
    source.close()
  }
}

async function downloadFile(path: string, filename: string) {
  const response = await fetch(path, { credentials: 'include', method: 'HEAD' })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    if (shouldNotifyAuthExpired(path, response.status)) {
      notifyAuthExpired(path)
    }
    throw new ApiError(message, response.status)
  }

  const link = document.createElement('a')
  link.href = path
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
}

export function getBackupDownloadUrl(filename: string) {
  return `${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`
}

export const dashboardApi = {
  getSession: () => request<DashboardSession>(`${consoleApiBasePath}/session`),
  login: (credentials: { email: string; password: string }) =>
    request<DashboardSession>(`${consoleApiBasePath}/login`, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  logout: () =>
    request<{ ok: true }>(`${consoleApiBasePath}/logout`, { method: 'POST' }),
  getMe: () => request<DashboardMe>(`${consoleApiBasePath}/me`),
  updateMe: (input: { handle: string }) =>
    request<DashboardMe>(`${consoleApiBasePath}/me`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listApiKeys: () =>
    request<DashboardApiKey[]>(`${consoleApiBasePath}/api-keys`),
  listApiKeyCapabilities: () =>
    request<DashboardApiKeyCapability[]>(`${consoleApiBasePath}/api-key-capabilities`),
  createApiKey: (input: { name: string; scopes: string[] }) =>
    request<DashboardApiKeyCreateResult>(`${consoleApiBasePath}/api-keys`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateApiKeyPermissions: (id: string, scopes: string[]) =>
    request<DashboardApiKey>(`${consoleApiBasePath}/api-keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ scopes }),
    }),
  renameApiKey: (id: string, name: string) =>
    request<DashboardApiKey>(`${consoleApiBasePath}/api-keys/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  revokeApiKey: (id: string) =>
    request<{ ok: true }>(
      `${consoleApiBasePath}/api-keys/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  listApiKeyUsageLogs: (id: string, options: PaginationOptions = {}) =>
    request<PaginatedResponse<DashboardApiKeyUsageLog>>(
      `${consoleApiBasePath}/api-keys/${encodeURIComponent(id)}/usage-logs${paginationSuffix({
        ...options,
        sortBy: options.sortBy ?? 'startedAt',
        sortOrder: options.sortOrder ?? 'desc',
      })}`
    ),
  listLiveClients: () =>
    request<LiveClientRow[]>(`${consoleApiBasePath}/live-clients`),
  listDevices: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<DashboardDeviceRow>>(
      `${consoleApiBasePath}/devices${paginationSuffix(options)}`
    ),
  renameDevice: (clientInstanceId: string, input: { displayName: string }) =>
    request<DashboardDeviceRow>(
      `${consoleApiBasePath}/devices/${encodeURIComponent(clientInstanceId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  listWebhooks: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<DashboardWebhookDto>>(
      `${consoleApiBasePath}/webhooks${paginationSuffix(options)}`
    ),
  getWebhook: (id: string) =>
    request<DashboardWebhookDto>(
      `${consoleApiBasePath}/webhooks/${encodeURIComponent(id)}`
    ),
  createWebhook: (input: { name: string }) =>
    request<DashboardWebhookSecretResult>(`${consoleApiBasePath}/webhooks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateWebhook: (
    id: string,
    input: { name?: string; enabled?: boolean }
  ) =>
    request<DashboardWebhookDto>(
      `${consoleApiBasePath}/webhooks/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  deleteWebhook: (id: string) =>
    request<{ ok: true }>(
      `${consoleApiBasePath}/webhooks/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  resetWebhookSecret: (id: string) =>
    request<DashboardWebhookSecretResult>(
      `${consoleApiBasePath}/webhooks/${encodeURIComponent(id)}/reset-secret`,
      { method: 'POST' }
    ),
  listWebhookDeliveries: (id: string) =>
    request<WebhookDeliveryDto[]>(
      `${consoleApiBasePath}/webhooks/${encodeURIComponent(id)}/deliveries`
    ),
  listWebhookDeliveryHistory: (
    options: WebhookDeliveryHistoryQuery = {}
  ) =>
    request<PaginatedResponse<WebhookDeliveryHistoryDto>>(
      `${consoleApiBasePath}/webhook-deliveries${querySuffix(options)}`
    ),
  subscribeLiveClients: (
    onEvent: (event: LiveClientChangedEvent) => void,
    onError?: () => void
  ) =>
    subscribeServerEvents<LiveClientChangedEvent>(
      `${consoleApiBasePath}/live/stream`,
      'live.client.changed',
      onEvent,
      onError
    ),
  authorizeDesktopLogin: (input: DesktopAuthorizeInput) =>
    request<DesktopAuthorizationResult>(desktopAuthorizePath, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listMySkillRepositories: () =>
    request<SkillRepositoryItemDto[]>(`${skillRepositoryApiBasePath}/mine`),
  listPublicSkillRepositories: (options: SkillRepositoryPublicListInput = {}) =>
    request<SkillRepositoryListResultDto>(
      `${skillRepositoryApiBasePath}${querySuffix({
        page: options.page,
        pageSize: options.pageSize,
        query: options.query ?? undefined,
      })}`
    ),
  getSkillRepository: (id: string) =>
    request<SkillRepositoryDetailDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}`
    ),
  getSkillRepositoryByPath: (ownerHandle: string, repositoryName: string) =>
    request<SkillRepositoryPublicPathDto>(
      `${skillRepositoryApiBasePath}/by-path/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(repositoryName)}`
    ),
  updateSkillRepository: (id: string, input: SkillRepositoryUpdateInput) =>
    request<SkillRepositoryDetailDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  deleteSkillRepository: (id: string) =>
    request<SkillRepositoryDeleteResultDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  getSkillRepositoryFileContent: (id: string, path: string) =>
    request<SkillRepositoryFileContentDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files/content?${new URLSearchParams({ path }).toString()}`
    ),
  getSkillRepositoryFileContentByPath: (ownerHandle: string, repositoryName: string, path: string) =>
    request<SkillRepositoryFileContentDto>(
      `${skillRepositoryApiBasePath}/by-path/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(repositoryName)}/files/content?${new URLSearchParams({ path }).toString()}`
    ),
  getSkillRepositoryFileDownloadUrl: (id: string, path: string) =>
    `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files/download?${new URLSearchParams({ path }).toString()}`,
  getSkillRepositoryFileDownloadUrlByPath: (ownerHandle: string, repositoryName: string, path: string) =>
    `${skillRepositoryApiBasePath}/by-path/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(repositoryName)}/files/download?${new URLSearchParams({ path }).toString()}`,
  forkSkillRepository: (id: string, input: SkillRepositoryForkInput = {}) =>
    request<SkillRepositoryForkResultDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/fork`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),
  createSkillRepositoryInstallSession: (id: string) =>
    request<SkillRepositoryInstallSessionDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/install-sessions`,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    ),
  saveSkillRepositoryTextFile: (id: string, input: SkillRepositoryTextSaveInput) =>
    request<SkillRepositoryDetailDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files/text`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      }
    ),
  renameSkillRepositoryFile: (id: string, input: SkillRepositoryFileRenameInput) =>
    request<SkillRepositoryDetailDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files/rename`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  deleteSkillRepositoryFile: (id: string, input: SkillRepositoryFileDeleteInput) =>
    request<SkillRepositoryDetailDto>(
      `${skillRepositoryApiBasePath}/${encodeURIComponent(id)}/files`,
      {
        method: 'DELETE',
        body: JSON.stringify(input),
      }
    ),
}

type DriveBrowserSurface = 'standalone' | 'console'

type DriveBrowserChildrenOptions = {
  childrenOffset?: number
  childrenLimit?: number
}

type DriveChildrenPageOptions = {
  offset?: number
  limit?: number
  search?: string
}

type DriveBrowserShareOptions = DriveBrowserChildrenOptions | string

function normalizeDriveBrowserShareOptions(options: DriveBrowserShareOptions = {}) {
  return typeof options === 'string' ? {} : options
}

function driveBrowserQuerySuffix(
  surface: DriveBrowserSurface = 'standalone',
  options: DriveBrowserChildrenOptions = {}
) {
  const params = new URLSearchParams()
  if (surface === 'console') params.set('surface', 'console')
  if (typeof options.childrenOffset === 'number') {
    params.set('childrenOffset', String(options.childrenOffset))
  }
  if (typeof options.childrenLimit === 'number') {
    params.set('childrenLimit', String(options.childrenLimit))
  }
  const query = params.toString()
  return query ? `?${query}` : ''
}

function driveOffsetQuerySuffix(options: DriveChildrenPageOptions = {}) {
  return querySuffix({
    offset: options.offset,
    limit: options.limit,
    search: options.search,
  })
}

function driveTreeQuerySuffix(options: DriveItemTreeListInput = {}) {
  return querySuffix({
    parentId: options.parentId ?? undefined,
    offset: options.offset,
    limit: options.limit,
  })
}

function driveSiteQuerySuffix(options: DriveSiteListInput = {}) {
  return querySuffix({
    offset: options.offset,
    limit: options.limit,
    search: options.search,
    status: options.status,
  })
}

export const driveApi = {
  getUsage: () =>
    request<DriveUsageDto>(`${driveApiBasePath}/usage`),
  prepareUpload: (input: { readonly parentId?: string | null; readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/uploads/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        parentId: input.parentId ?? null,
        name: input.name,
        size: input.size,
        mimeType: input.mimeType ?? null,
      }),
    }),
  prepareFolderUpload: (input: {
    readonly parentId?: string | null
    readonly folderName: string
    readonly directories?: readonly DriveFolderUploadPrepareDirectoryInput[]
    readonly files: readonly DriveFolderUploadPrepareFileInput[]
  }) =>
    request<DriveFolderUploadPrepareResult>(`${driveApiBasePath}/uploads/folder/prepare`, {
      method: 'POST',
      body: JSON.stringify({
        parentId: input.parentId ?? null,
        folderName: input.folderName,
        directories: input.directories ?? [],
        files: input.files,
      }),
    }),
  completeUpload: (sessionId: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/uploads/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelUpload: (sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/uploads/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  createFolder: (input: { readonly parentId?: string | null; readonly name: string }) =>
    request<DriveItemDto>(`${driveApiBasePath}/folders`, {
      method: 'POST',
      body: JSON.stringify({ parentId: input.parentId ?? null, name: input.name }),
    }),
  renameItem: (itemId: string, name: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  moveItem: (itemId: string, parentId: string | null) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ parentId }),
    }),
  listTree: (options: DriveItemTreeListInput = {}) =>
    request<DriveItemTreeListPageDto>(`${driveApiBasePath}/items/tree${driveTreeQuerySuffix(options)}`),
  deleteItem: (itemId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  listTrash: (options: DriveChildrenPageOptions = {}) =>
    request<DriveTrashListPageDto>(`${driveApiBasePath}/trash${driveOffsetQuerySuffix(options)}`),
  restoreItem: (itemId: string) =>
    request<DriveItemDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}/restore`, { method: 'POST' }),
  deleteTrashItem: (itemId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/trash/${encodeURIComponent(itemId)}`, { method: 'DELETE' }),
  createShare: (itemId: string, settings: DriveAccessSettingsInput | DriveAccessSettingsUpdateInput) =>
    request<DriveShareDto>(`${driveApiBasePath}/items/${encodeURIComponent(itemId)}/share`, {
      method: 'POST',
      body: JSON.stringify(settings),
    }),
  disableShare: (shareId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/shares/${encodeURIComponent(shareId)}`, { method: 'DELETE' }),
  getShare: (shareId: string) =>
    request<DriveShareDto>(`${driveApiBasePath}/shares/${encodeURIComponent(shareId)}`),
  listShares: (options: DrivePublicLinksPageInput = {}) =>
    request<DriveShareListPageDto>(`${driveApiBasePath}/shares${driveOffsetQuerySuffix(options)}`),
  preflightSite: (sourceFolderItemId: string) =>
    request<DriveSitePreflightDto>(`${driveApiBasePath}/sites/preflight?${new URLSearchParams({ sourceFolderItemId }).toString()}`),
  createSite: (input: DriveSiteCreateInput) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites`, { method: 'POST', body: JSON.stringify(input) }),
  listSites: (options: DriveSiteListInput = {}) =>
    request<DriveSiteListPageDto>(`${driveApiBasePath}/sites${driveSiteQuerySuffix(options)}`),
  updateSiteAccess: (siteId: string, input: DriveSiteAccessUpdateInput) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/access`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  disableSite: (siteId: string) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/disable`, { method: 'POST' }),
  enableSite: (siteId: string) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/enable`, { method: 'POST' }),
  republishSite: (siteId: string, input: { readonly entryPath?: string | null }) =>
    request<DriveSiteDto>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}/republish`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteSite: (siteId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/sites/${encodeURIComponent(siteId)}`, { method: 'DELETE' }),
  listPublicAssets: (options: DriveChildrenPageOptions = {}) =>
    request<DrivePublicAssetListPageDto>(`${driveApiBasePath}/public-assets${driveOffsetQuerySuffix(options)}`),
  preparePublicAssetUpload: (input: { readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/public-assets/uploads/prepare`, {
      method: 'POST',
      body: JSON.stringify({ name: input.name, size: input.size, mimeType: input.mimeType ?? null }),
    }),
  completePublicAssetUpload: (sessionId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/uploads/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelPublicAssetUpload: (sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/public-assets/uploads/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  preparePublicAssetReplace: (assetId: string, input: { readonly name: string; readonly size: string; readonly mimeType?: string | null }) =>
    request<DriveUploadPrepareResult>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/prepare`, {
      method: 'POST',
      body: JSON.stringify({ name: input.name, size: input.size, mimeType: input.mimeType ?? null }),
    }),
  completePublicAssetReplace: (assetId: string, sessionId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/complete`, { method: 'POST' }),
  cancelPublicAssetReplace: (assetId: string, sessionId: string) =>
    request<{ ok: true }>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/replace/${encodeURIComponent(sessionId)}/cancel`, { method: 'POST' }),
  renamePublicAsset: (assetId: string, name: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  trashPublicAsset: (assetId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' }),
  restorePublicAsset: (assetId: string) =>
    request<DrivePublicAssetDto>(`${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/restore`, { method: 'POST' }),
  publicAssetDownloadUrl: (assetId: string) =>
    `${driveApiBasePath}/public-assets/${encodeURIComponent(assetId)}/download`,
}

export const driveBrowserApi = {
  getOwnerItem: (
    itemId: string,
    surface: DriveBrowserSurface = 'standalone',
    options: DriveBrowserChildrenOptions = {}
  ) =>
    request<DriveBrowserSnapshotDto>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}${driveBrowserQuerySuffix(surface, options)}`
    ),
  getConsoleRoot: (options: DriveBrowserChildrenOptions = {}) =>
    request<DriveBrowserSnapshotDto>(`${driveBrowserApiBasePath}/owner/root${driveBrowserQuerySuffix('standalone', options)}`),
  updateOwnerText: (itemId: string, input: DriveFileTextUpdateInput) =>
    request<DriveFileContentUpdateResult>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/content`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  checkpointOwner: (itemId: string, input: DriveCollaborationCheckpointInput) =>
    request<DriveCollaborationCheckpointResultDto>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/collaboration/checkpoint`,
      { method: 'POST', body: JSON.stringify(input) }
    ),
  getShareRoot: (shareId: string, options: DriveBrowserShareOptions = {}) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}${driveBrowserQuerySuffix('standalone', normalizeDriveBrowserShareOptions(options))}`
    ),
  getShareItem: (shareId: string, itemId: string, options: DriveBrowserShareOptions = {}) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}${driveBrowserQuerySuffix('standalone', normalizeDriveBrowserShareOptions(options))}`
    ),
  unlockShare: (shareId: string, password: string, itemId?: string, options: DriveBrowserChildrenOptions = {}) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `${itemId
        ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/access`
        : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/access`}${driveBrowserQuerySuffix('standalone', options)}`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    ),
  updateShareText: (shareId: string, itemId: string | null | undefined, input: DriveFileTextUpdateInput) =>
    request<DriveFileContentUpdateResult>(
      itemId
        ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/content`
        : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/content`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  checkpointShare: (shareId: string, itemId: string | null | undefined, input: DriveCollaborationCheckpointInput) =>
    request<DriveCollaborationCheckpointResultDto>(
      itemId
        ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/collaboration/checkpoint`
        : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/collaboration/checkpoint`,
      { method: 'POST', body: JSON.stringify(input) }
    ),
  scanOwnerImageSources: (itemId: string) =>
    request<DriveDocumentImageSourcesDto>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/image-sources`
    ),
  importOwnerImageSources: (itemId: string, input: DriveDocumentImageImportRequest) =>
    request<DriveDocumentImageImportResult>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/image-sources/import`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),
  scanShareImageSources: (shareId: string, itemId?: string | null) =>
    request<DriveDocumentImageSourcesDto>(
      itemId
        ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/image-sources`
        : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/image-sources`
    ),
  importShareImageSources: (shareId: string, itemId: string | null | undefined, input: DriveDocumentImageImportRequest) =>
    request<DriveDocumentImageImportResult>(
      itemId
        ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/image-sources/import`
        : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/image-sources/import`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),
  uploadPublicAssetFile: async (file: File, input: { readonly name: string; readonly mimeType: string }) => {
    const prepared = await request<DriveUploadPrepareResult>(
      `${driveApiBasePath}/public-assets/uploads/prepare`,
      {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          size: String(file.size),
          mimeType: input.mimeType,
        }),
      }
    )
    try {
      const uploadResponse = await fetch(prepared.upload.url, {
        method: prepared.upload.method,
        headers: prepared.upload.headers,
        body: file,
      })
      if (!uploadResponse.ok) {
        throw new ApiError(await readErrorMessage(uploadResponse), uploadResponse.status)
      }
      return await request<DrivePublicAssetDto>(
        `${driveApiBasePath}/public-assets/uploads/${encodeURIComponent(prepared.sessionId)}/complete`,
        { method: 'POST' }
      )
    } catch (error) {
      await driveApi.cancelPublicAssetUpload(prepared.sessionId).catch(() => undefined)
      throw error
    }
  },
}

function ownerAnnotationPath(itemId: string, suffix = '') {
  return `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(itemId)}/annotations${suffix}`
}

function shareAnnotationPath(shareId: string, itemId?: string | null, suffix = '') {
  const base = itemId
    ? `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}/annotations`
    : `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/annotations`
  return `${base}${suffix}`
}

export const driveAnnotationApi = {
  listOwner: (itemId: string) =>
    request<DriveAnnotationThreadDto[]>(ownerAnnotationPath(itemId), { cache: 'no-store' }),
  createOwner: (itemId: string, input: DriveAnnotationCreateInput) =>
    request<DriveAnnotationThreadDto>(ownerAnnotationPath(itemId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replyOwner: (itemId: string, threadId: string, input: DriveAnnotationReplyInput) =>
    request<DriveAnnotationCommentDto>(ownerAnnotationPath(itemId, `/${encodeURIComponent(threadId)}/comments`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateOwnerComment: (itemId: string, commentId: string, input: DriveAnnotationCommentUpdateInput) =>
    request<DriveAnnotationCommentDto>(ownerAnnotationPath(itemId, `/comments/${encodeURIComponent(commentId)}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteOwnerComment: (itemId: string, commentId: string) =>
    request<{ ok: true }>(ownerAnnotationPath(itemId, `/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE' }),
  deleteOwnerThread: (itemId: string, threadId: string) =>
    request<{ ok: true }>(ownerAnnotationPath(itemId, `/${encodeURIComponent(threadId)}`), { method: 'DELETE' }),
  listShare: (shareId: string, itemId?: string | null) =>
    request<DriveAnnotationThreadDto[]>(shareAnnotationPath(shareId, itemId), { cache: 'no-store' }),
  createShare: (shareId: string, itemId: string | null | undefined, input: DriveAnnotationCreateInput) =>
    request<DriveAnnotationThreadDto>(shareAnnotationPath(shareId, itemId), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  replyShare: (shareId: string, itemId: string | null | undefined, threadId: string, input: DriveAnnotationReplyInput) =>
    request<DriveAnnotationCommentDto>(shareAnnotationPath(shareId, itemId, `/${encodeURIComponent(threadId)}/comments`), {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateShareComment: (shareId: string, itemId: string | null | undefined, commentId: string, input: DriveAnnotationCommentUpdateInput) =>
    request<DriveAnnotationCommentDto>(shareAnnotationPath(shareId, itemId, `/comments/${encodeURIComponent(commentId)}`), {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteShareComment: (shareId: string, itemId: string | null | undefined, commentId: string) =>
    request<{ ok: true }>(shareAnnotationPath(shareId, itemId, `/comments/${encodeURIComponent(commentId)}`), { method: 'DELETE' }),
  deleteShareThread: (shareId: string, itemId: string | null | undefined, threadId: string) =>
    request<{ ok: true }>(shareAnnotationPath(shareId, itemId, `/${encodeURIComponent(threadId)}`), { method: 'DELETE' }),
}

type DriveFileVersionListOptions = {
  offset?: number
  limit?: number
}

const driveFileVersionPath = (itemId: string, versionId?: string) => {
  const itemPath = `${driveApiBasePath}/items/${encodeURIComponent(itemId)}/versions`
  return versionId ? `${itemPath}/${encodeURIComponent(versionId)}` : itemPath
}

export const driveFileVersionsApi = {
  list: (itemId: string, options: DriveFileVersionListOptions = {}) =>
    request<DriveFileVersionListPageDto>(
      `${driveFileVersionPath(itemId)}${querySuffix(options)}`
    ),
  restore: (itemId: string, versionId: string) =>
    request<DriveItemDto>(`${driveFileVersionPath(itemId, versionId)}/restore`, {
      method: 'POST',
    }),
  updatePin: (itemId: string, versionId: string, isPinned: boolean) =>
    request<DriveFileVersionDto>(driveFileVersionPath(itemId, versionId), {
      method: 'PATCH',
      body: JSON.stringify({ isPinned }),
    }),
  delete: (itemId: string, versionId: string) =>
    request<{ ok: true; deletePending?: boolean }>(driveFileVersionPath(itemId, versionId), {
      method: 'DELETE',
    }),
  downloadUrl: (itemId: string, versionId: string) =>
    `${driveFileVersionPath(itemId, versionId)}/download`,
}

export const adminApi = {
  getSession: () => request<AdminSession>(`${adminApiBasePath}/session`),
  unlock: (accessSecret: string) =>
    request<AdminSession>(`${adminApiBasePath}/session`, {
      method: 'POST',
      body: JSON.stringify({ accessSecret }),
    }),
  logout: () =>
    request<{ ok: true }>(`${adminApiBasePath}/session`, { method: 'DELETE' }),
  getSystemOverview: () =>
    request<SystemOverview>(`${adminApiBasePath}/system`),
  listProblemFeedback: (page = 1) =>
    request<PaginatedResponse<ProblemFeedbackRow>>(
      `${adminApiBasePath}/problem-feedback?page=${page}`,
      { cache: 'no-store' }
    ),
  deleteProblemFeedback: (id: string) =>
    request<{ success: true }>(
      `${adminApiBasePath}/problem-feedback/${encodeURIComponent(id)}`,
      { method: 'DELETE', cache: 'no-store' }
    ),
  listUsers: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<AdminUserRow>>(
      `${adminApiBasePath}/users${paginationSuffix(options)}`
    ),
  listLiveClients: () =>
    request<LiveClientRow[]>(`${adminApiBasePath}/live-clients`),
  listDevices: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<DashboardDeviceRow>>(
      `${adminApiBasePath}/devices${paginationSuffix(options)}`
    ),
  listUserLiveClients: (id: string) =>
    request<LiveClientRow[]>(
      `${adminApiBasePath}/users/${encodeURIComponent(id)}/live-clients`
    ),
  subscribeLiveClients: (
    onEvent: (event: LiveClientChangedEvent) => void,
    onError?: () => void
  ) =>
    subscribeServerEvents<LiveClientChangedEvent>(
      `${adminApiBasePath}/live/stream`,
      'live.client.changed',
      onEvent,
      onError
    ),
  updateUserStatus: (id: string, status: 'active' | 'disabled') =>
    request<AdminUserRow>(`${adminApiBasePath}/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  updateUserAdminNote: (id: string, adminNote: string | null) =>
    request<AdminUserRow>(
      `${adminApiBasePath}/users/${encodeURIComponent(id)}/admin-note`,
      {
        method: 'PATCH',
        body: JSON.stringify({ adminNote }),
      }
    ),
  listBackups: () => request<BackupFile[]>(`${adminApiBasePath}/backup/list`),
  triggerBackup: () =>
    request<BackupResult>(`${adminApiBasePath}/backup`, { method: 'POST' }),
  downloadBackup: (filename: string) =>
    downloadFile(getBackupDownloadUrl(filename), filename),
  getBackupDownloadUrl,
  deleteBackup: (filename: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/backup/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    ),
  listAuditLogs: (
    options: {
      action?: string
      from?: string
      to?: string
      page?: number
      pageSize?: number
      sortBy?: string
      sortOrder?: 'asc' | 'desc'
    } = {}
  ) =>
    request<PaginatedResponse<AuditLog>>(
      `${adminApiBasePath}/audit-logs${querySuffix(options)}`
    ),
  exportAuditLogs: (
    options: { action?: string; from?: string; to?: string } = {}
  ) =>
    downloadFile(
      `${adminApiBasePath}/audit-logs/export${querySuffix(options)}`,
      'audit-logs.csv'
    ),
  listLogFiles: () => request<LogFileInfo[]>(`${adminApiBasePath}/logs/files`),
  listWebhookDeliveryHistory: (
    options: WebhookDeliveryHistoryQuery = {}
  ) =>
    request<PaginatedResponse<WebhookDeliveryHistoryDto>>(
      `${adminApiBasePath}/webhook-deliveries${querySuffix(options)}`
    ),
  fetchRecentLogs: (
    options: { from?: string; level?: string; limit?: number; to?: string } = {}
  ) =>
    request<LogEntry[]>(
      `${adminApiBasePath}/logs/recent${querySuffix(options)}`
    ),
  downloadLogs: (options: { from?: string; to?: string } = {}) =>
    downloadFile(
      `${adminApiBasePath}/logs/download${querySuffix(options)}`,
      'logs.zip'
    ),
  cleanupLogs: (before: Date) =>
    request<{ deleted: number; failures?: number }>(
      `${adminApiBasePath}/logs/cleanup?${new URLSearchParams({ before: dateQueryValue(before) }).toString()}`,
      { method: 'DELETE' }
    ),
  listDriveItems: (options: AdminDriveListQuery = {}) =>
    request<PaginatedResponse<AdminDriveItemRow>>(
      `${adminApiBasePath}/drive/items${adminDriveQuerySuffix(options)}`
    ),
  deleteDriveItem: (id: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/drive/items/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  downloadDriveItem: (id: string, filename: string) =>
    downloadFile(
      `${adminApiBasePath}/drive/items/${encodeURIComponent(id)}/download`,
      filename
    ),
  restoreDriveItem: (id: string) =>
    request<AdminDriveItemRow>(
      `${adminApiBasePath}/drive/items/${encodeURIComponent(id)}/restore`,
      { method: 'POST' }
    ),
  getDriveStorageSummary: () =>
    request<AdminDriveStorageSummary>(`${adminApiBasePath}/drive/storage-summary`),
  listDrivePublicAssets: (options: AdminDrivePublicAssetListQuery = {}) =>
    request<PaginatedResponse<AdminDrivePublicAssetRow>>(
      `${adminApiBasePath}/drive/public-assets${adminDrivePublicAssetQuerySuffix(options)}`
    ),
  getDrivePublicAsset: (assetId: string) =>
    request<AdminDrivePublicAssetRow>(
      `${adminApiBasePath}/drive/public-assets/${encodeURIComponent(assetId)}`
    ),
  listDrivePublicAssetAccessLogs: (
    assetId: string,
    options: PaginationOptions = {}
  ) =>
    request<PaginatedResponse<AdminDrivePublicAssetAccessLogRow>>(
      `${adminApiBasePath}/drive/public-assets/${encodeURIComponent(assetId)}/access-logs${paginationSuffix(options)}`
    ),
  listDrivePublicAssetRevisions: (
    assetId: string,
    options: PaginationOptions = {}
  ) =>
    request<PaginatedResponse<AdminDrivePublicAssetRevisionRow>>(
      `${adminApiBasePath}/drive/public-assets/${encodeURIComponent(assetId)}/revisions${paginationSuffix(options)}`
    ),
  downloadDrivePublicAssetRevision: (
    assetId: string,
    revisionId: string,
    filename: string
  ) =>
    downloadFile(
      `${adminApiBasePath}/drive/public-assets/${encodeURIComponent(assetId)}/revisions/${encodeURIComponent(revisionId)}/download`,
      filename
    ),
  listSkillRepositories: (options: AdminSkillRepositoryListQuery = {}) =>
    request<PaginatedResponse<AdminSkillRepositoryRow>>(
      `${adminApiBasePath}/skill-repositories${adminSkillRepositoryQuerySuffix(options)}`
    ),
  setSkillRepositoryRemoved: (id: string) =>
    request<AdminSkillRepositoryRow>(
      `${adminApiBasePath}/skill-repositories/${encodeURIComponent(id)}/removed`,
      { method: 'POST' }
    ),
  restoreSkillRepository: (id: string) =>
    request<AdminSkillRepositoryRow>(
      `${adminApiBasePath}/skill-repositories/${encodeURIComponent(id)}/removed`,
      { method: 'DELETE' }
    ),
}

export const userAuthApi = {
  register: (input: { email: string; handle: string; password: string }) =>
    request<UserRegistrationResult>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  requestPasswordReset: (input: { email: string }) =>
    request<PasswordResetRequestResult>('/api/auth/password-reset/request', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  resetPassword: (input: { token: string; password: string }) =>
    request<{ ok: true }>('/api/auth/password-reset/confirm', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
