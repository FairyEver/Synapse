import { randomUUID } from "node:crypto"
import { request as httpsRequest } from "node:https"

import type { DataNamespace, DataRepository, SecretEntryV1 } from "../../../runtime/data-repo"
import type { AuditSink, PermissionGuard } from "../../../runtime/security"
import type { StructuredLogger } from "../../../runtime/service-registry"
import { ConnectorRepository } from "../connector-repository"
import type { FeishuConnectorSummary } from "../types"
import {
  FEISHU_ACCOUNTS_BASE_URL,
  type FeishuCredentialInput,
  type FeishuSetupBeginResult,
  type FeishuSetupPollResult,
  type FeishuSetupSession,
  type StoredFeishuSecret,
} from "./feishu-types"

export interface FeishuRegistrationRequest {
  readonly action: "begin" | "poll"
  readonly deviceCode?: string
  readonly baseUrl: string
}

export interface FeishuRegistrationClient {
  call(request: FeishuRegistrationRequest): Promise<Record<string, unknown>>
}

export interface FeishuSetupServiceDeps {
  readonly dataRepository: DataRepository
  readonly connectorRepository?: ConnectorRepository
  readonly permissionGuard?: PermissionGuard
  readonly auditSink?: AuditSink
  readonly logger?: StructuredLogger
  readonly registrationClient?: FeishuRegistrationClient
  readonly now?: () => Date
}

const DEFAULT_INTERVAL_SECONDS = 5
const MAX_REGISTRATION_RESPONSE_BYTES = 1024 * 1024

export class FeishuSetupService {
  private readonly deps: FeishuSetupServiceDeps
  private readonly connectorRepository: ConnectorRepository
  private readonly sessions = new Map<string, FeishuSetupSession>()

  constructor(deps: FeishuSetupServiceDeps) {
    this.deps = deps
    this.connectorRepository = deps.connectorRepository ?? new ConnectorRepository({
      connectors: deps.dataRepository.namespace("connectors"),
      now: deps.now,
    })
  }

  async beginSetup(projectId: string): Promise<FeishuSetupBeginResult> {
    await this.checkPermission("network.connect", `feishu:${projectId}:registration`, projectId)
    const response = await this.registrationClient().call({
      action: "begin",
      baseUrl: FEISHU_ACCOUNTS_BASE_URL,
    })
    const deviceCode = requiredString(response.device_code, "device_code")
    const qrUrl = requiredString(
      response.verification_uri_complete ?? response.qr_url,
      "verification_uri_complete",
    )
    const intervalSeconds = numberValue(response.interval) ?? DEFAULT_INTERVAL_SECONDS
    const expiresInSeconds = numberValue(response.expires_in) ?? 600
    const expiresAt = new Date(this.now().getTime() + expiresInSeconds * 1000).toISOString()
    const setupId = `feishu-setup:${randomUUID()}`

    this.sessions.set(setupId, {
      setupId,
      projectId,
      deviceCode,
      qrUrl,
      intervalSeconds,
      expiresAt,
      baseUrl: FEISHU_ACCOUNTS_BASE_URL,
    })

    this.recordAudit("network.connect", "allowed", projectId, {
      phase: "begin",
      setupId,
    })

    return {
      setupId,
      deviceCode,
      qrUrl,
      intervalSeconds,
      expiresAt,
    }
  }

  async pollSetup(setupId: string): Promise<FeishuSetupPollResult> {
    const session = this.session(setupId)
    if (Date.parse(session.expiresAt) <= this.now().getTime()) {
      this.sessions.delete(setupId)
      return { status: "expired", message: "二维码已过期。" }
    }
    if (session.baseUrl !== FEISHU_ACCOUNTS_BASE_URL) {
      return { status: "unsupported_platform", message: "当前阶段只支持飞书。" }
    }

    await this.checkPermission("network.connect", `feishu:${session.projectId}:registration`, session.projectId)
    const response = await this.registrationClient().call({
      action: "poll",
      deviceCode: session.deviceCode,
      baseUrl: session.baseUrl,
    })
    const errorCode = stringValue(response.error)
    if (errorCode === "authorization_pending") {
      return { status: "pending", intervalSeconds: session.intervalSeconds }
    }
    if (errorCode === "slow_down") {
      session.intervalSeconds += 5
      return { status: "slow_down", intervalSeconds: session.intervalSeconds }
    }
    if (errorCode === "access_denied") {
      this.sessions.delete(setupId)
      return { status: "denied", message: "授权已取消。" }
    }
    if (errorCode === "expired_token") {
      this.sessions.delete(setupId)
      return { status: "expired", message: "二维码已过期。" }
    }
    if (errorCode) {
      return { status: "error", message: errorCode }
    }

    session.appId = requiredString(response.client_id, "client_id")
    session.appSecret = requiredString(response.client_secret, "client_secret")
    session.ownerOpenId =
      stringValue(response.owner_open_id)
      ?? stringValue(response.open_id)
      ?? stringValue(recordValue(response.user_info)?.open_id)

    return {
      status: "completed",
      appId: session.appId,
      ownerOpenId: session.ownerOpenId,
    }
  }

  async saveSetup(setupId: string): Promise<FeishuConnectorSummary> {
    const session = this.session(setupId)
    if (!session.appId || !session.appSecret) {
      throw new Error("飞书授权尚未完成。")
    }
    const saved = await this.saveCredentials({
      projectId: session.projectId,
      appId: session.appId,
      appSecret: session.appSecret,
      ownerOpenId: session.ownerOpenId,
    })
    this.sessions.delete(setupId)
    return saved
  }

  async saveManualCredentials(input: FeishuCredentialInput): Promise<FeishuConnectorSummary> {
    return this.saveCredentials(input)
  }

  async readSecret(projectId: string): Promise<StoredFeishuSecret | null> {
    await this.checkPermission("secret.read", `feishu:${projectId}:credentials`, projectId)
    const secret = await this.secrets().get(secretId(projectId))
    if (!secret?.value) return null
    const parsed = parseSecret(secret.value)
    if (!parsed) return null
    this.recordAudit("secret.read", "allowed", projectId, {
      secretRef: secret.id,
      appId: parsed.appId,
    })
    return parsed
  }

  private async saveCredentials(input: FeishuCredentialInput): Promise<FeishuConnectorSummary> {
    const appId = input.appId.trim()
    const appSecret = input.appSecret.trim()
    if (!appId || !appSecret) throw new Error("appId 和 appSecret 必填。")

    const id = secretId(input.projectId)
    await this.checkPermission("secret.write", id, input.projectId)
    const secret: SecretEntryV1 = {
      id,
      schemaVersion: 1,
      kind: "generic",
      value: JSON.stringify({
        platform: "feishu",
        appId,
        appSecret,
      } satisfies StoredFeishuSecret),
      description: "Feishu connector credentials",
    }

    try {
      await this.secrets().upsert(secret)
      const connector = await this.connectorRepository.upsert({
        projectId: input.projectId,
        platform: "feishu",
        secretRef: id,
        status: "disabled",
        appId,
        ownerOpenId: input.ownerOpenId,
      })
      this.recordAudit("secret.write", "allowed", input.projectId, {
        secretRef: id,
        connectorId: connector.id,
        appId,
      })
      return this.connectorRepository.toFeishuSummary(connector)
    } catch (error) {
      this.recordAudit("secret.write", "failed", input.projectId, {
        secretRef: id,
        appId,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }

  private session(setupId: string): FeishuSetupSession {
    const session = this.sessions.get(setupId)
    if (!session) throw new Error("飞书授权流程不存在或已过期。")
    return session
  }

  private secrets(): DataNamespace<SecretEntryV1> {
    return this.deps.dataRepository.namespace("secrets")
  }

  private registrationClient(): FeishuRegistrationClient {
    return this.deps.registrationClient ?? defaultFeishuRegistrationClient
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  private async checkPermission(
    action: "network.connect" | "secret.read" | "secret.write",
    resource: string,
    projectId: string,
  ): Promise<void> {
    const permission = await this.deps.permissionGuard?.check({
      action,
      actor: { kind: "user" },
      resource,
      context: { projectId, platform: "feishu" },
    })
    if (permission && !permission.allowed) {
      this.recordAudit(action, "denied", projectId, {
        resource,
        reason: permission.reason,
        policyId: permission.policyId,
      })
      throw new Error(permission.reason)
    }
  }

  private recordAudit(
    action: "network.connect" | "secret.read" | "secret.write",
    outcome: "allowed" | "denied" | "failed",
    projectId: string,
    metadata: Record<string, unknown>,
  ): void {
    this.deps.auditSink?.record({
      action,
      actor: { kind: "user" },
      resource: "feishu-connector",
      outcome,
      metadata: {
        projectId,
        platform: "feishu",
        ...metadata,
      },
    })
  }
}

export function secretId(projectId: string): string {
  return `feishu:${projectId}:credentials`
}

export const defaultFeishuRegistrationClient: FeishuRegistrationClient = {
  async call(request) {
    return postFormJson(
      `${request.baseUrl.replace(/\/$/, "")}/oauth/v1/app/registration`,
      {
        action: request.action,
        archetype: request.action === "begin" ? "PersonalAgent" : undefined,
        auth_method: request.action === "begin" ? "client_secret" : undefined,
        request_user_info: request.action === "begin" ? "open_id" : undefined,
        device_code: request.deviceCode,
      },
    )
  },
}

function postFormJson(
  url: string,
  body: Record<string, string | undefined>,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) form.set(key, value)
    }
    const parsed = new URL(url)
    const request = httpsRequest({
      method: "POST",
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      timeout: 15_000,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(form.toString()),
      },
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => {
        const nextBytes = chunks.reduce((total, item) => total + item.byteLength, 0) + chunk.byteLength
        if (nextBytes > MAX_REGISTRATION_RESPONSE_BYTES) {
          request.destroy(new Error("飞书授权响应过大。"))
          return
        }
        chunks.push(chunk)
      })
      response.on("end", () => {
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
          if (typeof value !== "object" || value === null || Array.isArray(value)) {
            reject(new Error("飞书授权响应格式不正确。"))
            return
          }
          resolve(value as Record<string, unknown>)
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    })
    request.on("timeout", () => {
      request.destroy(new Error("飞书授权请求超时。"))
    })
    request.on("error", reject)
    request.end(form.toString())
  })
}

function parseSecret(value: string): StoredFeishuSecret | null {
  try {
    const parsed = JSON.parse(value) as unknown
    if (
      typeof parsed === "object"
      && parsed !== null
      && !Array.isArray(parsed)
      && (parsed as { platform?: unknown }).platform === "feishu"
      && typeof (parsed as { appId?: unknown }).appId === "string"
      && typeof (parsed as { appSecret?: unknown }).appSecret === "string"
    ) {
      return parsed as StoredFeishuSecret
    }
    return null
  } catch {
    return null
  }
}

function requiredString(value: unknown, field: string): string {
  const text = stringValue(value)
  if (!text) throw new Error(`飞书授权响应缺少 ${field}。`)
  return text
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}
