export type ManagedStatus = "active" | "disabled" | "revoked" | "expired"
export type DeviceStatus = "active" | "revoked"
export type AccountStatus = "active" | "disabled"

export interface AdminSession {
  readonly email: string
}

export interface ActivationCode {
  readonly id: string
  readonly status: ManagedStatus
  readonly maxDevices: number
  readonly expiresAt: string | null
  readonly boundAccountId: string | null
  readonly redeemedAt: string | null
  readonly createdAt: string
}

export interface LicenseDevice {
  readonly id: string
  readonly name: string
  readonly platform: string
  readonly appVersion: string
  readonly status: DeviceStatus
  readonly firstSeenAt: string
  readonly lastSeenAt: string
}

export interface License {
  readonly id: string
  readonly status: ManagedStatus
  readonly maxDevices: number
  readonly expiresAt: string | null
  readonly createdAt: string
  readonly devices: LicenseDevice[]
  readonly leases?: Lease[]
}

export interface Account {
  readonly id: string
  readonly email: string
  readonly status: AccountStatus
  readonly createdAt: string
  readonly licenses: License[]
}

export interface Device {
  readonly id: string
  readonly name: string
  readonly platform: string
  readonly appVersion: string
  readonly status: DeviceStatus
  readonly firstSeenAt: string
  readonly lastSeenAt: string
  readonly license: License & {
    readonly account: Pick<Account, "id" | "email" | "status">
  }
}

export interface Lease {
  readonly id: string
  readonly tokenId: string
  readonly issuedAt: string
  readonly expiresAt: string
  readonly createdAt: string
}

export interface SystemOverview {
  readonly serverTime: string
  readonly counts: {
    readonly activationCodes: number
    readonly activeActivationCodes: number
    readonly accounts: number
    readonly activeAccounts: number
    readonly licenses: number
    readonly activeLicenses: number
    readonly devices: number
    readonly activeDevices: number
    readonly leases: number
  }
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
  listActivationCodes: () => request<ActivationCode[]>("/admin/api/activation-codes"),
  createActivationCode: (input: {
    code: string
    maxDevices: number
    expiresAt: string | null
  }) =>
    request<{ id: string; code: string; maxDevices: number }>("/admin/api/activation-codes", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  updateActivationCode: (id: string, status: ManagedStatus) =>
    request<ActivationCode>(`/admin/api/activation-codes/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  listAccounts: () => request<Account[]>("/admin/api/accounts"),
  getAccount: (id: string) => request<Account>(`/admin/api/accounts/${id}`),
  listDevices: () => request<Device[]>("/admin/api/devices"),
  getSystemOverview: () => request<SystemOverview>("/admin/api/system"),
  updateLicense: (id: string, status: ManagedStatus) =>
    request<License>(`/admin/api/licenses/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  updateDevice: (id: string, status: DeviceStatus) =>
    request<LicenseDevice>(`/admin/api/devices/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
}
