import type {
  ContentStoreDetailDto,
  ContentStoreDraftDto,
  ContentStoreInstallSessionDto,
  ContentStoreItemDto,
  ContentStoreModerationStatus,
  ContentStoreType,
  ContentStoreVersionDto,
  ContentStoreVisibility,
  DashboardWebhookDto,
  DashboardWebhookSecretResult,
  DriveBrowserPasswordRequiredDto,
  DriveBrowserSnapshotDto,
  WebhookDeliveryDto,
  WebhookDeliveryHistoryDto,
} from '@synapse/shared'

export type AdminSession = {
  email: string
  displayName: string | null
  modulePermissions: string[]
  role: 'admin' | 'user'
  sessionId: string
}

export type SystemOverview = {
  serverTime: string
  counts: {
    auditLogs: number
    users: number
    teams: number
    invitations: number
    userModulePermissions: number
  }
  userStatus: {
    active: number
    disabled: number
  }
  invitationStatus: {
    pending: number
    used: number
    expired: number
  }
  dailyTrend: Array<{
    date: string
    label: string
    users: number
    teams: number
    invitations: number
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
  adminEmail: string
  action: string
  targetType: string
  targetId: string
  detail: unknown
  ipAddress: string
  createdAt: string
}

export type AdminUserRow = {
  id: string
  email: string
  status: 'active' | 'disabled'
  memberships: Array<{
    id?: string
    role: 'owner' | 'member'
    team: { id: string; name: string }
  }>
  modulePermissions: Array<{ permissionKey: string }>
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
  userDisplayName?: string | null
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

export type AdminTeamRow = {
  id: string
  name: string
  createdByUser: { email: string }
  memberships: Array<{
    id: string
    role: 'owner' | 'member'
    user: { id?: string; email: string }
    createdAt: string
  }>
  createdAt: string
  updatedAt: string
}

export type ModulePermissionDefinition = {
  key: string
  label: string
  group: string
  sortOrder: number
  status: 'active' | 'deprecated'
}

export type DashboardMe = {
  user: {
    id: string
    email: string
    status: 'active' | 'disabled'
    displayName: string | null
  }
  teams: Array<{
    id: string
    name: string
    membershipId: string
    membershipRole: 'owner' | 'member'
  }>
}

export type AdminInvitationRow = {
  id: string
  type: 'team_join'
  inviteUrl: string | null
  expiresAt: string
  usedAt: string | null
  createdByAdmin: { email: string } | null
  createdByUser: { email: string } | null
  team: { name: string } | null
  acceptedByUser: { email: string } | null
  createdAt: string
}

export type AdminInvitationCreateResult = {
  id: string
  token: string
  inviteUrl: string
  expiresAt: string
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
}

type RequestOptions = RequestInit

const consoleApiBasePath = '/api/console'
const legacyDashboardApiBasePath = '/api/dashboard'
const adminApiBasePath = '/api/admin'
const contentStoreApiBasePath = '/api/content-store'
const driveBrowserApiBasePath = '/api/drive/browser'
const desktopAuthorizePath = '/api/auth/desktop/authorize'
const authExpiredListeners = new Set<() => void>()

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function readErrorMessage(response: Response) {
  const fallback = response.statusText || '请求失败'

  try {
    const payload = (await response.json()) as { message?: unknown }

    if (typeof payload.message === 'string') {
      return payload.message
    }

    if (Array.isArray(payload.message)) {
      return (
        payload.message.filter((item) => typeof item === 'string').join('，') ||
        fallback
      )
    }
  } catch {
    return fallback
  }

  return fallback
}

async function request<T>(path: string, options: RequestOptions = {}) {
  const headers =
    options.body === undefined
      ? options.headers
      : {
          'Content-Type': 'application/json',
          ...options.headers,
        }

  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
  })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    if (shouldNotifyAuthExpired(path, response.status)) {
      notifyAuthExpired()
    }
    throw new ApiError(message, response.status)
  }

  return (await response.json()) as T
}

export function subscribeAuthExpired(listener: () => void) {
  authExpiredListeners.add(listener)
  return () => {
    authExpiredListeners.delete(listener)
  }
}

function notifyAuthExpired() {
  for (const listener of authExpiredListeners) {
    listener()
  }
}

export function shouldNotifyAuthExpired(path: string, status: number) {
  if (path === desktopAuthorizePath) {
    return status === 401 || status === 403
  }
  if (status !== 401) return false
  if (
    !path.startsWith(adminApiBasePath) &&
    !path.startsWith(consoleApiBasePath) &&
    !path.startsWith(legacyDashboardApiBasePath) &&
    !path.startsWith(contentStoreApiBasePath)
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

type PaginationOptions = {
  page?: number
  pageSize?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type WebhookDeliveryHistoryQuery = PaginationOptions & {
  webhookId?: string
  status?: string
  from?: string
  to?: string
  userId?: string
  user?: string
}

export type ContentStoreListQuery = PaginationOptions & {
  type?: ContentStoreType
  query?: string
}

export type AdminContentStoreListQuery = ContentStoreListQuery & {
  visibility?: ContentStoreVisibility
  moderationStatus?: ContentStoreModerationStatus
}

export type CreateContentStoreInstallSessionInput = {
  deepLinkBase?: string
}

export type ContentStoreDraftFileInput = {
  path: string
  contentBase64: string
  mimeType?: string | null
}

export type CreateContentStoreDraftInput =
  | {
      type: 'skill'
      title: string
      description?: string | null
      localSourceFingerprint?: string | null
      files: ContentStoreDraftFileInput[]
    }
  | {
      type: 'rule' | 'prompt'
      title: string
      description?: string | null
      body: string
    }

export type SaveContentStoreDraftInput =
  | {
      type: 'skill'
      baseRevision: number
      title: string
      description?: string | null
      files: ContentStoreDraftFileInput[]
    }
  | {
      type: 'rule' | 'prompt'
      baseRevision: number
      title: string
      description?: string | null
      body: string
    }

export type PublishContentStoreDraftInput = {
  baseRevision: number
}

type ContentStoreVisibilityInput = {
  visibility: ContentStoreVisibility
}

type ContentStoreBooleanInput = {
  value: boolean
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

function contentStoreQuerySuffix(options: AdminContentStoreListQuery = {}) {
  return querySuffix({
    page: options.page,
    pageSize: options.pageSize,
    sortBy: options.sortBy,
    sortOrder: options.sortOrder,
    type: options.type,
    query: options.query,
    visibility: options.visibility,
    moderationStatus: options.moderationStatus,
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
  const response = await fetch(path, { credentials: 'include' })

  if (!response.ok) {
    const message = await readErrorMessage(response)
    if (shouldNotifyAuthExpired(path, response.status)) {
      notifyAuthExpired()
    }
    throw new ApiError(message, response.status)
  }

  const objectUrl = URL.createObjectURL(await response.blob())
  try {
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.rel = 'noopener'
    document.body.append(link)
    link.click()
    link.remove()
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function getBackupDownloadUrl(filename: string) {
  return `${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`
}

export const dashboardApi = {
  getSession: () => request<AdminSession>(`${consoleApiBasePath}/session`),
  login: (credentials: { email: string; password: string }) =>
    request<AdminSession>(`${consoleApiBasePath}/login`, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  logout: () =>
    request<{ ok: true }>(`${consoleApiBasePath}/logout`, { method: 'POST' }),
  getMe: () => request<DashboardMe>(`${consoleApiBasePath}/me`),
  updateMe: (input: { displayName: string }) =>
    request<DashboardMe>(`${consoleApiBasePath}/me`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  listLiveClients: () =>
    request<LiveClientRow[]>(`${consoleApiBasePath}/live-clients`),
  listDevices: () =>
    request<DashboardDeviceRow[]>(`${consoleApiBasePath}/devices`),
  renameDevice: (clientInstanceId: string, input: { displayName: string }) =>
    request<DashboardDeviceRow>(
      `${consoleApiBasePath}/devices/${encodeURIComponent(clientInstanceId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(input),
      }
    ),
  listWebhooks: () =>
    request<DashboardWebhookDto[]>(`${consoleApiBasePath}/webhooks`),
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
  listContentStoreItems: (options: ContentStoreListQuery = {}) =>
    request<PaginatedResponse<ContentStoreItemDto>>(
      `${contentStoreApiBasePath}/items${contentStoreQuerySuffix(options)}`
    ),
  listMyContentStoreItems: (options: ContentStoreListQuery = {}) =>
    request<PaginatedResponse<ContentStoreItemDto>>(
      `${contentStoreApiBasePath}/mine${contentStoreQuerySuffix(options)}`
    ),
  getContentStoreDetail: (id: string) =>
    request<ContentStoreDetailDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}`
    ),
  getContentStoreDraft: (id: string) =>
    request<ContentStoreDraftDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/draft`
    ),
  createContentStoreDraft: (input: CreateContentStoreDraftInput) =>
    request<ContentStoreDraftDto>(`${contentStoreApiBasePath}/drafts`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  saveContentStoreDraft: (id: string, input: SaveContentStoreDraftInput) =>
    request<ContentStoreDraftDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/draft`,
      {
        method: 'PUT',
        body: JSON.stringify(input),
      }
    ),
  publishContentStoreDraft: (
    id: string,
    input: PublishContentStoreDraftInput
  ) =>
    request<ContentStoreVersionDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/publish`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),
  copyContentStoreItem: (id: string) =>
    request<ContentStoreItemDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/copy`,
      { method: 'POST' }
    ),
  setContentStoreVisibility: (
    id: string,
    visibility: ContentStoreVisibility
  ) =>
    request<ContentStoreItemDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/visibility`,
      {
        method: 'POST',
        body: JSON.stringify({ visibility } satisfies ContentStoreVisibilityInput),
      }
    ),
  deleteContentStoreItem: (id: string) =>
    request<{ ok: true }>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  createContentStoreInstallSession: (
    id: string,
    input: CreateContentStoreInstallSessionInput = {}
  ) =>
    request<ContentStoreInstallSessionDto>(
      `${contentStoreApiBasePath}/items/${encodeURIComponent(id)}/install-sessions`,
      {
        method: 'POST',
        body: JSON.stringify(input),
      }
    ),
}

type DriveBrowserSurface = 'standalone' | 'console'

function driveBrowserSurfaceSuffix(surface: DriveBrowserSurface = 'standalone') {
  return surface === 'console' ? '?surface=console' : ''
}

export const driveBrowserApi = {
  getOwnerRoot: (
    rootItemId: string,
    surface: DriveBrowserSurface = 'standalone'
  ) =>
    request<DriveBrowserSnapshotDto>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(rootItemId)}${driveBrowserSurfaceSuffix(surface)}`
    ),
  getOwnerChild: (
    rootItemId: string,
    itemId: string,
    surface: DriveBrowserSurface = 'standalone'
  ) =>
    request<DriveBrowserSnapshotDto>(
      `${driveBrowserApiBasePath}/owner/items/${encodeURIComponent(rootItemId)}/items/${encodeURIComponent(itemId)}${driveBrowserSurfaceSuffix(surface)}`
    ),
  getConsoleRoot: () =>
    request<DriveBrowserSnapshotDto>(`${driveBrowserApiBasePath}/owner/root`),
  getShareRoot: (shareId: string) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}`
    ),
  getShareItem: (shareId: string, itemId: string) =>
    request<DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto>(
      `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/items/${encodeURIComponent(itemId)}`
    ),
  unlockShare: (shareId: string, password: string) =>
    request<DriveBrowserSnapshotDto>(
      `${driveBrowserApiBasePath}/shares/${encodeURIComponent(shareId)}/access`,
      {
        method: 'POST',
        body: JSON.stringify({ password }),
      }
    ),
}

export const adminApi = {
  getSystemOverview: () =>
    request<SystemOverview>(`${adminApiBasePath}/system`),
  listInvitations: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<AdminInvitationRow>>(
      `${adminApiBasePath}/invitations${paginationSuffix(options)}`
    ),
  createInvitation: (input: { teamId: string }) =>
    request<AdminInvitationCreateResult>(`${adminApiBasePath}/invitations`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  deleteInvitation: (id: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/invitations/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
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
  listTeams: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<AdminTeamRow>>(
      `${adminApiBasePath}/teams${paginationSuffix(options)}`
    ),
  listModulePermissions: () =>
    request<ModulePermissionDefinition[]>(
      `${adminApiBasePath}/module-permissions`
    ),
  listUserModulePermissions: (id: string) =>
    request<{ permissionKeys: string[] }>(
      `${adminApiBasePath}/users/${encodeURIComponent(id)}/module-permissions`
    ),
  replaceUserModulePermissions: (id: string, permissionKeys: string[]) =>
    request<{ permissionKeys: string[] }>(
      `${adminApiBasePath}/users/${encodeURIComponent(id)}/module-permissions`,
      { method: 'PUT', body: JSON.stringify({ permissionKeys }) }
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
  listDriveItems: (options: PaginationOptions = {}) =>
    request<PaginatedResponse<AdminDriveItemRow>>(
      `${adminApiBasePath}/drive/items${paginationSuffix(options)}`
    ),
  deleteDriveItem: (id: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/drive/items/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  listContentStoreItems: (options: AdminContentStoreListQuery = {}) =>
    request<PaginatedResponse<ContentStoreItemDto>>(
      `${adminApiBasePath}/content-store/items${contentStoreQuerySuffix(options)}`
    ),
  getContentStoreDetail: (id: string) =>
    request<ContentStoreDetailDto>(
      `${adminApiBasePath}/content-store/items/${encodeURIComponent(id)}`
    ),
  setContentStoreFeatured: (id: string, value: boolean) =>
    request<ContentStoreItemDto>(
      `${adminApiBasePath}/content-store/items/${encodeURIComponent(id)}/featured`,
      {
        method: 'POST',
        body: JSON.stringify({ value } satisfies ContentStoreBooleanInput),
      }
    ),
  setContentStoreRemoved: (id: string, value: boolean) =>
    request<ContentStoreItemDto>(
      `${adminApiBasePath}/content-store/items/${encodeURIComponent(id)}/removed`,
      {
        method: 'POST',
        body: JSON.stringify({ value } satisfies ContentStoreBooleanInput),
      }
    ),
}

export const userAuthApi = {
  register: (input: { email: string; password: string }) =>
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

export const userApi = {
  register: userAuthApi.register,
  joinTeam: (input: { token: string }) =>
    request<unknown>('/api/teams/join', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
