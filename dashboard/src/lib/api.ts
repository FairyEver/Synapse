export type AdminSession = {
  email: string
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

export type DesktopLoginCodeIssueResult = {
  code: string
  deepLinkUrl: string
  expiresAt: string
}

type RequestOptions = RequestInit

const dashboardApiBasePath = '/api/dashboard'
const adminApiBasePath = '/api/admin'
const desktopLoginIssueCodePath = '/api/auth/desktop/issue-code'
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

function shouldNotifyAuthExpired(path: string, status: number) {
  if (path === desktopLoginIssueCodePath) {
    return status === 401 || status === 403
  }
  if (status !== 401) return false
  if (
    !path.startsWith(adminApiBasePath) &&
    !path.startsWith(dashboardApiBasePath)
  ) {
    return false
  }
  return ![
    `${dashboardApiBasePath}/login`,
    `${dashboardApiBasePath}/logout`,
    `${dashboardApiBasePath}/session`,
  ].includes(path)
}

function paginationSuffix(options: { page?: number; pageSize?: number }) {
  const query = new URLSearchParams()
  if (options.page) query.set('page', String(options.page))
  if (options.pageSize) query.set('pageSize', String(options.pageSize))
  const value = query.toString()
  return value ? `?${value}` : ''
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

export const dashboardApi = {
  getSession: () => request<AdminSession>(`${dashboardApiBasePath}/session`),
  login: (credentials: { email: string; password: string }) =>
    request<AdminSession>(`${dashboardApiBasePath}/login`, {
      method: 'POST',
      body: JSON.stringify(credentials),
    }),
  logout: () =>
    request<{ ok: true }>(`${dashboardApiBasePath}/logout`, { method: 'POST' }),
  getMe: () => request<DashboardMe>(`${dashboardApiBasePath}/me`),
  issueDesktopLoginCode: (input: { state: string }) =>
    request<DesktopLoginCodeIssueResult>(desktopLoginIssueCodePath, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}

export const adminApi = {
  getSystemOverview: () =>
    request<SystemOverview>(`${adminApiBasePath}/system`),
  listInvitations: (options: { page?: number; pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminInvitationRow>>(
      `${adminApiBasePath}/invitations${paginationSuffix(options)}`
    ),
  deleteInvitation: (id: string) =>
    request<{ ok: true }>(
      `${adminApiBasePath}/invitations/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    ),
  listUsers: (options: { page?: number; pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminUserRow>>(
      `${adminApiBasePath}/users${paginationSuffix(options)}`
    ),
  updateUserStatus: (id: string, status: 'active' | 'disabled') =>
    request<AdminUserRow>(`${adminApiBasePath}/users/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
  listTeams: (options: { page?: number; pageSize?: number } = {}) =>
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
    downloadFile(
      `${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`,
      filename
    ),
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
  cleanupLogs: (before: string) =>
    request<{ deleted: number }>(
      `${adminApiBasePath}/logs/cleanup?${new URLSearchParams({ before }).toString()}`,
      { method: 'DELETE' }
    ),
}

export const userApi = {
  register: (input: { email: string; password: string }) =>
    request<UserTokenPair>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  joinTeam: (input: { token: string }) =>
    request<unknown>('/api/teams/join', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
}
