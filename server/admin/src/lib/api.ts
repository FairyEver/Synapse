export interface AdminSession {
  readonly email: string
}

export interface SystemOverview {
  readonly serverTime: string
  readonly counts: {
    readonly auditLogs: number
    readonly users: number
    readonly teams: number
    readonly invitations: number
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
}

export interface AdminInvitationRow {
  readonly id: string
  readonly type: "user_signup" | "team_join"
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

export interface UserRegisterInput {
  readonly invitationToken: string
  readonly email: string
  readonly password: string
}

export interface UserTokenPair {
  readonly accessToken: string
  readonly refreshToken: string
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

const dashboardBasePath = "/dashboard"
const dashboardApiBasePath = `${dashboardBasePath}/api`

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

export const adminApi = {
  getSession: () => request<AdminSession>(`${dashboardBasePath}/session`),
  login: (input: { email: string; password: string }) =>
    request<AdminSession>(`${dashboardBasePath}/login`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () =>
    request<{ ok: true }>(`${dashboardBasePath}/logout`, {
      method: "POST",
    }),
  getSystemOverview: () => request<SystemOverview>(`${dashboardApiBasePath}/system`),
  createSignupInvitation: () =>
    request<CreateSignupInvitationResponse>(`${dashboardApiBasePath}/invitations`, { method: "POST" }),
  listInvitations: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminInvitationRow>>(`${dashboardApiBasePath}/invitations${paginationSuffix(options)}`),
  listUsers: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminUserRow>>(`${dashboardApiBasePath}/users${paginationSuffix(options)}`),
  updateUserStatus: (id: string, status: "active" | "disabled") =>
    request<AdminUserRow>(`${dashboardApiBasePath}/users/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listTeams: (options: { readonly page?: number; readonly pageSize?: number } = {}) =>
    request<PaginatedResponse<AdminTeamRow>>(`${dashboardApiBasePath}/teams${paginationSuffix(options)}`),
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
    return request<PaginatedResponse<AuditLog>>(`${dashboardApiBasePath}/audit-logs${suffix}`)
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
    window.open(`${dashboardApiBasePath}/audit-logs/export${suffix}`, "_blank")
  },
  async listLogFiles(): Promise<LogFileInfo[]> {
    return request<LogFileInfo[]>(`${dashboardApiBasePath}/logs/files`);
  },
  async fetchRecentLogs(opts?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.level) params.set("level", opts.level);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<LogEntry[]>(`${dashboardApiBasePath}/logs/recent${qs ? `?${qs}` : ""}`);
  },
  downloadLogs(opts?: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    const qs = params.toString();
    window.open(`${dashboardApiBasePath}/logs/download${qs ? `?${qs}` : ""}`, "_blank");
  },
}

export const userAuthApi = {
  register: (input: UserRegisterInput) =>
    request<UserTokenPair>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(input),
    }),
}
