import type { AuditSink, PermissionGuard } from "../../runtime/security"
import type {
  DeviceMetadata,
  LicenseServerConfig,
  LicenseServerResponse,
  LicenseServerValidationResponse,
} from "./types"

type FetchLike = typeof fetch

export interface LicenseClientDeps {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly fetchImpl?: FetchLike
}

export class LicenseClient {
  private readonly fetchImpl: FetchLike

  constructor(private readonly deps: LicenseClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch
  }

  getConfig(serverUrl: string): Promise<LicenseServerConfig> {
    return this.request<LicenseServerConfig>(serverUrl, "/v1/license/config")
  }

  redeem(
    serverUrl: string,
    input: {
      readonly email: string
      readonly activationCode: string
      readonly device: DeviceMetadata
    },
  ): Promise<LicenseServerResponse> {
    return this.request<LicenseServerResponse>(serverUrl, "/v1/activations/redeem", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  renew(
    serverUrl: string,
    input: {
      readonly leaseToken: string
      readonly device: DeviceMetadata
    },
  ): Promise<LicenseServerResponse> {
    return this.request<LicenseServerResponse>(serverUrl, "/v1/licenses/renew", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  validate(
    serverUrl: string,
    input: {
      readonly leaseToken: string
      readonly device: DeviceMetadata
    },
  ): Promise<LicenseServerValidationResponse> {
    return this.request<LicenseServerValidationResponse>(serverUrl, "/v1/licenses/validate", {
      method: "POST",
      body: JSON.stringify(input),
    })
  }

  private async request<T>(
    serverUrl: string,
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const url = new URL(path, normalizeLicenseServerUrl(serverUrl))
    const permission = await this.deps.permissionGuard.check({
      action: "network.connect",
      actor: { kind: "user", id: "local" },
      context: { service: "license", path },
      resource: url.origin,
    })
    if (!permission.allowed) {
      this.deps.auditSink.record({
        action: "network.connect",
        actor: { kind: "user", id: "local" },
        metadata: { service: "license", path },
        outcome: "denied",
        resource: url.origin,
      })
      throw new Error("没有连接授权服务器的权限。")
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)
    let audited = false
    try {
      const response = await this.fetchImpl(url, {
        ...init,
        headers: {
          "Content-Type": "application/json",
          ...init.headers,
        },
        signal: controller.signal,
      })
      const body = await readResponseBody(response)
      if (!response.ok) {
        this.recordAudit(url.origin, path, "failed", response.status)
        audited = true
        throw new LicenseClientRequestError(readErrorMessage(body), response.status)
      }
      this.recordAudit(url.origin, path, "allowed", response.status)
      audited = true
      return body as T
    } catch (error) {
      if (!audited) {
        this.recordAudit(url.origin, path, "failed")
      }
      if (error instanceof LicenseClientRequestError) {
        throw error
      }
      throw new Error("授权服务器请求失败。")
    } finally {
      clearTimeout(timeout)
    }
  }

  private recordAudit(
    resource: string,
    path: string,
    outcome: "allowed" | "failed",
    status?: number,
  ): void {
    this.deps.auditSink.record({
      action: "network.connect",
      actor: { kind: "user", id: "local" },
      metadata: { service: "license", path, status },
      outcome,
      resource,
    })
  }
}

export class LicenseClientRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export function normalizeLicenseServerUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) {
    throw new Error("授权服务器不能为空。")
  }
  const url = new URL(trimmed)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("授权服务器地址无效。")
  }
  url.hash = ""
  url.search = ""
  return url.toString().replace(/\/$/, "")
}

async function readResponseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type")
  if (!contentType?.includes("application/json")) {
    return response.text()
  }
  return response.json()
}

function readErrorMessage(body: unknown): string {
  if (typeof body === "string" && body.trim()) return body
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message
    if (typeof message === "string") return message
    if (Array.isArray(message)) return message.join("；")
  }
  return "授权服务器请求失败。"
}
