export interface AdminSession {
  readonly email: string
  readonly role: "admin" | "user"
}

export interface SystemOverview {
  readonly serverTime: string
  readonly counts: {
    readonly auditLogs: number
    readonly users: number
    readonly teams: number
    readonly invitations: number
    readonly teamEntitlements: number
    readonly teamAccessRoles: number
    readonly teamAccessRolePermissions: number
    readonly teamMemberAccessRoles: number
  }
}

export interface PaginatedResponse<T> {
  readonly data: T[]
  readonly total: number
  readonly page: number
  readonly pageSize: number
}

export interface AuditLog {
  readonly id: string
  readonly adminEmail: string
  readonly action: string
  readonly targetType: string
  readonly targetId: string
  readonly detail: unknown
  readonly ipAddress: string
  readonly createdAt: string
}

export interface AdminUserRow {
  readonly id: string
  readonly email: string
  readonly status: "active" | "disabled"
  readonly memberships: Array<{
    readonly role: "owner" | "member"
    readonly team: { readonly id: string; readonly name: string }
  }>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AdminTeamRow {
  readonly id: string
  readonly name: string
  readonly createdByUser: { readonly email: string }
  readonly memberships: Array<{
    readonly role: "owner" | "member"
    readonly user: { readonly email: string }
    readonly createdAt: string
  }>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface PermissionDefinition {
  readonly key: string
  readonly label: string
  readonly description?: string
  readonly group: string
  readonly level: "module" | "action" | "management"
  readonly status: "active" | "deprecated"
  readonly clientVisibility: "visible" | "hidden"
}

export interface TeamEntitlementsResponse {
  readonly permissionKeys: string[]
}

export interface TeamAccessRoleRow {
  readonly id: string
  readonly name: string
  readonly description: string | null
  readonly kind: "system" | "custom"
  readonly locked: boolean
  readonly sortOrder: number
  readonly permissionKeys: string[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface AdminInvitationRow {
  readonly id: string
  readonly type: "user_signup" | "team_join"
  readonly inviteUrl: string | null
  readonly expiresAt: string
  readonly usedAt: string | null
  readonly createdByAdmin: { readonly email: string } | null
  readonly createdByUser: { readonly email: string } | null
  readonly team: { readonly name: string } | null
  readonly acceptedByUser: { readonly email: string } | null
  readonly createdAt: string
}

export interface CreateSignupInvitationResponse {
  readonly id: string
  readonly token: string
  readonly inviteUrl: string
  readonly expiresAt: string
}

export interface BackupFile {
  readonly filename: string
  readonly size: number
  readonly createdAt: string
}

export interface UserRegisterInput {
  readonly invitationToken: string
  readonly email: string
  readonly password: string
}

export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
}

export interface TeamUser {
  readonly id: string
  readonly email: string
  readonly status: "active" | "disabled"
}

export interface TeamMember {
  readonly id: string
  readonly userId: string
  readonly teamId: string
  readonly role: "owner" | "member"
  readonly createdAt: string
  readonly user: TeamUser
}

export interface MyTeam {
  readonly id: string
  readonly teamId: string
  readonly userId: string
  readonly role: "owner" | "member"
  readonly team: {
    readonly id: string
    readonly name: string
    readonly createdByUserId: string
    readonly memberships: TeamMember[]
  }
}

export interface TeamSummary {
  readonly id: string
  readonly name: string
  readonly createdByUserId: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface TeamInvitationResponse {
  readonly id: string
  readonly token: string
  readonly inviteUrl: string
  readonly expiresAt: string
}

export interface LogFileInfo {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface LogEntry {
  time: string;
  level: string;
  msg: string;
  req?: { method: string; url: string };
  err?: { message: string; stack: string };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const adminApiBasePath = "/api/admin"

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
    },
  })
  const contentType = response.headers.get("content-type")
  const body = contentType?.includes("application/json") ? await response.json() : null
  if (!response.ok) {
    throw new ApiError(readErrorMessage(body), response.status)
  }
  return body as T
}

function readErrorMessage(body: unknown): string {
  if (body && typeof body === "object" && "message" in body) {
    const value = (body as { message: unknown }).message
    if (Array.isArray(value)) return value.join("；")
    if (typeof value === "string") return value
  }
  return "请求失败"
}

function paginationSuffix(options: { readonly page?: number; readonly pageSize?: number }): string {
  const query = new URLSearchParams()
  if (options.page) query.set("page", String(options.page))
  if (options.pageSize) query.set("pageSize", String(options.pageSize))
  const value = query.toString()
  return value ? `?${value}` : ""
}

function startDownload(url: string, filename: string): void {
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.rel = "noopener"
  document.body.append(link)
  link.click()
  link.remove()
}

export const adminApi = {
  getSession: () => request<AdminSession>(`${adminApiBasePath}/session`),
  login: (input: { email: string; password: string }) =>
    request<AdminSession>(`${adminApiBasePath}/login`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () =>
    request<{ ok: true }>(`${adminApiBasePath}/logout`, {
      method: "POST",
    }),
  getSystemOverview: () => request<SystemOverview>(`${adminApiBasePath}/system`),
  createSignupInvitation: () =>
    request<CreateSignupInvitationResponse>(`${adminApiBasePath}/invitations`, { method: "POST" }),
  listInvitations: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminInvitationRow>>(`${adminApiBasePath}/invitations${paginationSuffix(options)}`),
  deleteInvitation: (id: string) =>
    request<{ ok: true }>(`${adminApiBasePath}/invitations/${encodeURIComponent(id)}`, { method: "DELETE" }),
  deleteInvitations: (ids: readonly string[]) =>
    request<{ ok: true; count: number }>(`${adminApiBasePath}/invitations`, {
      method: "DELETE",
      body: JSON.stringify({ ids }),
    }),
  listUsers: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminUserRow>>(`${adminApiBasePath}/users${paginationSuffix(options)}`),
  updateUserStatus: (id: string, status: "active" | "disabled") =>
    request<AdminUserRow>(`${adminApiBasePath}/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listPermissions: () => request<PermissionDefinition[]>(`${adminApiBasePath}/permissions`),
  listTeams: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminTeamRow>>(`${adminApiBasePath}/teams${paginationSuffix(options)}`),
  listTeamEntitlements: (teamId: string) =>
    request<TeamEntitlementsResponse>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/entitlements`),
  replaceTeamEntitlements: (teamId: string, permissionKeys: readonly string[]) =>
    request<TeamEntitlementsResponse>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/entitlements`, {
      method: "PUT",
      body: JSON.stringify({ permissionKeys }),
    }),
  listTeamAccessRoles: (teamId: string) =>
    request<TeamAccessRoleRow[]>(`${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/access-roles`),
  replaceTeamRolePermissions: (teamId: string, roleId: string, permissionKeys: readonly string[]) =>
    request<TeamEntitlementsResponse>(
      `${adminApiBasePath}/teams/${encodeURIComponent(teamId)}/access-roles/${encodeURIComponent(roleId)}/permissions`,
      {
        method: "PUT",
        body: JSON.stringify({ permissionKeys }),
      },
    ),
  listBackups: () => request<BackupFile[]>(`${adminApiBasePath}/backup/list`),
  triggerBackup: () =>
    request<void>(`${adminApiBasePath}/backup`, {
      method: "POST",
    }),
  downloadBackup: (filename: string) => {
    startDownload(`${adminApiBasePath}/backup/download/${encodeURIComponent(filename)}`, filename)
  },
  deleteBackup: (filename: string) =>
    request<{ ok: true }>(`${adminApiBasePath}/backup/${encodeURIComponent(filename)}`, {
      method: "DELETE",
    }),
  listAuditLogs: (options: {
    readonly action?: string
    readonly from?: string
    readonly to?: string
    readonly page?: number
    readonly pageSize?: number
  } = {}) => {
    const query = new URLSearchParams()
    if (options.action) query.set("action", options.action)
    if (options.from) query.set("from", options.from)
    if (options.to) query.set("to", options.to)
    if (options.page) query.set("page", String(options.page))
    if (options.pageSize) query.set("pageSize", String(options.pageSize))
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    return request<PaginatedResponse<AuditLog>>(`${adminApiBasePath}/audit-logs${suffix}`)
  },
  exportAuditLogs: (options: {
    readonly action?: string
    readonly from?: string
    readonly to?: string
  } = {}) => {
    const query = new URLSearchParams()
    if (options.action) query.set("action", options.action)
    if (options.from) query.set("from", options.from)
    if (options.to) query.set("to", options.to)
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    startDownload(`${adminApiBasePath}/audit-logs/export${suffix}`, "audit-logs.csv")
  },
  async listLogFiles(): Promise<LogFileInfo[]> {
    return request<LogFileInfo[]>(`${adminApiBasePath}/logs/files`);
  },
  async fetchRecentLogs(opts?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.level) params.set("level", opts.level);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<LogEntry[]>(`${adminApiBasePath}/logs/recent${qs ? `?${qs}` : ""}`);
  },
  downloadLogs(opts?: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    const qs = params.toString();
    startDownload(`${adminApiBasePath}/logs/download${qs ? `?${qs}` : ""}`, "logs.zip");
  },
  cleanupLogs(before: string) {
    const params = new URLSearchParams({ before });
    return request<{ deleted: number }>(`${adminApiBasePath}/logs/cleanup?${params.toString()}`, {
      method: "DELETE",
    });
  },
}

export const userAuthApi = {
  register: (input: UserRegisterInput) =>
    request<UserTokenPair>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
}

export const userDashboardApi = {
  getMyTeam: () => request<MyTeam | null>("/api/teams/me"),
  createTeam: (input: { readonly name: string }) =>
    request<TeamSummary>("/api/teams", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createInvitation: () =>
    request<TeamInvitationResponse>("/api/teams/invitations", {
      method: "POST",
    }),
  joinTeam: (invitationToken: string) =>
    request<TeamMember>("/api/teams/join", {
      method: "POST",
      body: JSON.stringify({ invitationToken }),
    }),
  listMembers: () => request<TeamMember[]>("/api/teams/members"),
  removeMember: (userId: string) =>
    request<{ ok: true }>(`/api/teams/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  leaveTeam: () =>
    request<{ ok: true }>("/api/teams/me", {
      method: "DELETE",
    }),
}
