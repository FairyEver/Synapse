export interface AdminSession {
  readonly email: string
}

export interface SystemOverview {
  readonly serverTime: string
  readonly counts: {
    readonly auditLogs: number
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

export const adminApi = {
  getSession: () => request<AdminSession>("/admin/session"),
  login: (input: { email: string; password: string }) =>
    request<AdminSession>("/admin/login", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  logout: () =>
    request<{ ok: true }>("/admin/logout", {
      method: "POST",
    }),
  getSystemOverview: () => request<SystemOverview>("/admin/api/system"),
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
    return request<PaginatedResponse<AuditLog>>(`/admin/api/audit-logs${suffix}`)
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
    window.open(`/admin/api/audit-logs/export${suffix}`, "_blank")
  },
  async listLogFiles(): Promise<LogFileInfo[]> {
    return request<LogFileInfo[]>("/admin/api/logs/files");
  },
  async fetchRecentLogs(opts?: { level?: string; limit?: number }): Promise<LogEntry[]> {
    const params = new URLSearchParams();
    if (opts?.level) params.set("level", opts.level);
    if (opts?.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return request<LogEntry[]>(`/admin/api/logs/recent${qs ? `?${qs}` : ""}`);
  },
  downloadLogs(opts?: { from?: string; to?: string }) {
    const params = new URLSearchParams();
    if (opts?.from) params.set("from", opts.from);
    if (opts?.to) params.set("to", opts.to);
    const qs = params.toString();
    window.open(`/admin/api/logs/download${qs ? `?${qs}` : ""}`, "_blank");
  },
}
