import http from "node:http"
import https from "node:https"
import { URL, URLSearchParams } from "node:url"
import type { SynapseConfig, SynapseProjectPlatformConnection } from "../../src/types/config"
import type { SynapseConnectorEntry } from "../../src/types/connector"
import type { PermissionGuard, AuditSink } from "../runtime/security"
import type { ConnectorRegistryService } from "./connector-registry-service"
import type { ConnectorSecretStoreService } from "./connector-secret-store-service"

export type ConnectorQrPlatform = "feishu" | "lark"
export type ConnectorQrStatus = "waiting" | "scanned" | "success" | "expired" | "denied" | "cancelled" | "failed"

export type ConnectorQrHttpRequest = {
  method: "GET" | "POST"
  url: string
  headers?: Record<string, string>
  body?: string
  timeoutMs?: number
}

export type ConnectorQrHttpResponse = {
  status: number
  body: string
}

export type ConnectorQrHttpClient = (request: ConnectorQrHttpRequest) => Promise<ConnectorQrHttpResponse>

export type FeishuRegistrationInit = {
  supportedAuthMethods?: string[]
  error?: string
  errorDescription?: string
}

export type FeishuRegistrationBegin = {
  deviceCode?: string
  verificationUriComplete?: string
  interval?: number
  expireIn?: number
  error?: string
  errorDescription?: string
}

export type FeishuRegistrationPoll = {
  clientId?: string
  clientSecret?: string
  ownerOpenId?: string
  tenantBrand?: string
  error?: string
  errorDescription?: string
}

export type ConnectorQrSession = {
  id: string
  platform: ConnectorQrPlatform
  status: ConnectorQrStatus
  mode: "new" | "bind"
  qrContent: string | null
  deviceCode: string | null
  baseUrl: string | null
  intervalSeconds: number
  expiresAt: string | null
  refreshCount: number
  result: Record<string, string> | null
  error: string | null
}

export type ConnectorQrPublicSession = {
  sessionId: string
  platform: ConnectorQrPlatform
  status: ConnectorQrStatus
  qrContent: string | null
  intervalSeconds: number
  expiresAt: string | null
  refreshCount: number
  result: Record<string, string> | null
  error: string | null
}

export type ConnectorQrSaveResult = {
  connection: SynapseProjectPlatformConnection
}

type ConfigAccess = {
  load: () => Promise<SynapseConfig>
  update: (patch: { global: { projects: SynapseConfig["global"]["projects"] } }) => Promise<SynapseConfig>
}

type ConnectorQrOnboardingServiceOptions = {
  httpClient?: ConnectorQrHttpClient
  config?: ConfigAccess
  registry?: ConnectorRegistryService
  secretStore?: ConnectorSecretStoreService
  runtime?: {
    startOrReloadProjectConnection: (projectId: string, connectionId: string) => Promise<void>
  }
  permissionGuard?: PermissionGuard
  auditSink?: AuditSink
  now?: () => Date
}

type SaveManualPlatformInput = {
  projectId: string
  type: string
  name?: string
  enabled?: boolean
  options?: Record<string, unknown>
}

type SaveCompletedQrInput = {
  sessionId: string
  projectId: string
}

const FEISHU_ACCOUNTS_BASE_URL = "https://accounts.feishu.cn"
const LARK_ACCOUNTS_BASE_URL = "https://accounts.larksuite.com"

let sequence = 0

function trimString(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

function sessionId(platform: ConnectorQrPlatform): string {
  sequence += 1
  return `qr:${platform}:${sequence}`
}

function errorText(code: string, description: string | undefined): string {
  return description ? `${code}: ${description}` : code
}

function isSupportedPlatform(type: string): type is ConnectorQrPlatform {
  return type === "feishu" || type === "lark"
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {}
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? trimString(value) : undefined
}

function readStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function parseJsonObject(body: string, context: string): Record<string, unknown> {
  const parsed = JSON.parse(body) as unknown
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${context}: expected JSON object`)
  }
  return parsed as Record<string, unknown>
}

function mapFeishuInit(raw: Record<string, unknown>): FeishuRegistrationInit {
  return {
    supportedAuthMethods: readStringArray(raw.supported_auth_methods),
    error: readString(raw.error),
    errorDescription: readString(raw.error_description),
  }
}

function mapFeishuBegin(raw: Record<string, unknown>): FeishuRegistrationBegin {
  return {
    deviceCode: readString(raw.device_code),
    verificationUriComplete: readString(raw.verification_uri_complete),
    interval: readNumber(raw.interval),
    expireIn: readNumber(raw.expire_in),
    error: readString(raw.error),
    errorDescription: readString(raw.error_description),
  }
}

function mapFeishuPoll(raw: Record<string, unknown>): FeishuRegistrationPoll {
  const userInfo = readRecord(raw.user_info)
  return {
    clientId: readString(raw.client_id),
    clientSecret: readString(raw.client_secret),
    ownerOpenId: readString(userInfo.open_id),
    tenantBrand: readString(userInfo.tenant_brand),
    error: readString(raw.error),
    errorDescription: readString(raw.error_description),
  }
}

function toPublicSession(session: ConnectorQrSession): ConnectorQrPublicSession {
  let result: Record<string, string> | null = null
  if (session.result) {
    result = {
      ...(session.result.appId ? { appId: session.result.appId } : {}),
      ...(session.result.ownerOpenId ? { ownerOpenId: session.result.ownerOpenId } : {}),
    }
  }

  return {
    sessionId: session.id,
    platform: session.platform,
    status: session.status,
    qrContent: session.qrContent,
    intervalSeconds: session.intervalSeconds,
    expiresAt: session.expiresAt,
    refreshCount: session.refreshCount,
    result,
    error: session.error,
  }
}

function createProjectPlatformConnectionFromConnector(
  connector: SynapseConnectorEntry,
  now: string,
): SynapseProjectPlatformConnection {
  return {
    id: connector.id,
    type: connector.type,
    name: connector.name,
    status: connector.status,
    enabled: connector.enabled,
    options: { ...connector.options },
    secretRefs: { ...connector.secretRefs },
    allowFrom: connector.allowFrom,
    shareSessionInChannel: connector.options.share_session_in_channel === true,
    groupReplyAll: connector.options.group_reply_all === true,
    createdAt: now,
    updatedAt: now,
  }
}

export function createNodeConnectorQrHttpClient(): ConnectorQrHttpClient {
  return (request) => new Promise((resolve, reject) => {
    const url = new URL(request.url)
    const transport = url.protocol === "https:" ? https : http
    const clientRequest = transport.request(url, {
      method: request.method,
      headers: request.headers,
      timeout: request.timeoutMs ?? 15_000,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk)
      })
      response.on("end", () => {
        resolve({
          status: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        })
      })
    })

    clientRequest.on("error", reject)
    clientRequest.on("timeout", () => {
      clientRequest.destroy(new Error("request timed out"))
    })
    if (request.body) {
      clientRequest.write(request.body)
    }
    clientRequest.end()
  })
}

export function resolveFeishuSetupInputs(
  requestedMode: "auto" | "new" | "bind",
  app: string,
  appId: string,
  appSecret: string,
): { mode: "new" | "bind"; appId: string | null; appSecret: string | null; error: string | null } {
  const pair = trimString(app)
  let resolvedAppId = trimString(appId) ?? ""
  let resolvedSecret = trimString(appSecret) ?? ""

  if (pair && (resolvedAppId || resolvedSecret)) {
    return { mode: "new", appId: null, appSecret: null, error: "use either --app or --app-id/--app-secret, not both" }
  }

  if (pair) {
    const separator = pair.indexOf(":")
    if (separator <= 0 || separator >= pair.length - 1) {
      return { mode: "new", appId: null, appSecret: null, error: "--app format must be app_id:app_secret" }
    }
    resolvedAppId = pair.slice(0, separator).trim()
    resolvedSecret = pair.slice(separator + 1).trim()
  }

  if ((resolvedAppId && !resolvedSecret) || (!resolvedAppId && resolvedSecret)) {
    return { mode: "new", appId: null, appSecret: null, error: "both --app-id and --app-secret are required" }
  }

  const mode = requestedMode === "auto"
    ? resolvedAppId && resolvedSecret ? "bind" : "new"
    : requestedMode

  if (mode === "bind" && (!resolvedAppId || !resolvedSecret)) {
    return { mode, appId: null, appSecret: null, error: "bind mode requires credentials: use --app id:secret or --app-id/--app-secret" }
  }

  if (mode === "new" && (resolvedAppId || resolvedSecret)) {
    return { mode, appId: null, appSecret: null, error: "new mode does not accept credentials; use `cc-connect feishu bind`" }
  }

  return {
    mode,
    appId: resolvedAppId || null,
    appSecret: resolvedSecret || null,
    error: null,
  }
}

export class ConnectorQrOnboardingService {
  private readonly httpClient: ConnectorQrHttpClient
  private readonly config: ConfigAccess | null
  private readonly registry: ConnectorRegistryService | null
  private readonly secretStore: ConnectorSecretStoreService | null
  private readonly runtime: ConnectorQrOnboardingServiceOptions["runtime"] | null
  private readonly permissionGuard: PermissionGuard | null
  private readonly auditSink: AuditSink | null
  private readonly now: () => Date
  private readonly sessions = new Map<string, ConnectorQrSession>()

  constructor(options: ConnectorQrOnboardingServiceOptions = {}) {
    this.httpClient = options.httpClient ?? createNodeConnectorQrHttpClient()
    this.config = options.config ?? null
    this.registry = options.registry ?? null
    this.secretStore = options.secretStore ?? null
    this.runtime = options.runtime ?? null
    this.permissionGuard = options.permissionGuard ?? null
    this.auditSink = options.auditSink ?? null
    this.now = options.now ?? (() => new Date())
  }

  beginFeishuRegistration(
    init: FeishuRegistrationInit,
    begin: FeishuRegistrationBegin,
    options: { timeoutSeconds?: number; now?: Date; platform?: "feishu" | "lark"; baseUrl?: string } = {},
  ): ConnectorQrSession {
    const supported = init.supportedAuthMethods ?? []
    if (init.error) {
      return this.failed("feishu", errorText(init.error, init.errorDescription))
    }
    if (supported.length > 0 && !supported.includes("client_secret")) {
      return this.failed("feishu", "current environment does not support client_secret auth")
    }
    if (begin.error) {
      return this.failed("feishu", errorText(begin.error, begin.errorDescription))
    }

    const deviceCode = trimString(begin.deviceCode)
    const qrContent = trimString(begin.verificationUriComplete)
    if (!deviceCode || !qrContent) {
      return this.failed("feishu", "incomplete onboarding response")
    }

    const timeoutSeconds = options.timeoutSeconds && options.timeoutSeconds > 0 ? options.timeoutSeconds : 600
    const expireIn = begin.expireIn && begin.expireIn > 0 ? Math.min(begin.expireIn, timeoutSeconds) : timeoutSeconds
    const now = options.now ?? new Date()

    return {
      id: sessionId(options.platform ?? "feishu"),
      platform: options.platform ?? "feishu",
      status: "waiting",
      mode: "new",
      qrContent,
      deviceCode,
      baseUrl: options.baseUrl ?? FEISHU_ACCOUNTS_BASE_URL,
      intervalSeconds: begin.interval && begin.interval > 0 ? begin.interval : 5,
      expiresAt: new Date(now.getTime() + expireIn * 1000).toISOString(),
      refreshCount: 0,
      result: null,
      error: null,
    }
  }

  pollFeishuRegistration(session: ConnectorQrSession, poll: FeishuRegistrationPoll): ConnectorQrSession {
    if (session.status !== "waiting" && session.status !== "scanned") {
      return session
    }

    const tenantBrand = trimString(poll.tenantBrand)?.toLowerCase()
    const platform: ConnectorQrPlatform = tenantBrand === "lark" ? "lark" : session.platform
    const clientId = trimString(poll.clientId)
    const clientSecret = trimString(poll.clientSecret)
    if (clientId && clientSecret) {
      return {
        ...session,
        platform,
        status: "success",
        result: {
          appId: clientId,
          appSecret: clientSecret,
          ...(trimString(poll.ownerOpenId) ? { ownerOpenId: trimString(poll.ownerOpenId) as string } : {}),
        },
      }
    }

    switch (poll.error) {
      case undefined:
      case "":
      case "authorization_pending":
        return { ...session, platform, status: "waiting" }
      case "slow_down":
        return { ...session, platform, intervalSeconds: session.intervalSeconds + 5 }
      case "access_denied":
        return { ...session, platform, status: "denied", error: "authorization denied by user" }
      case "expired_token":
        return { ...session, platform, status: "expired", error: "onboarding session expired" }
      default:
        return { ...session, platform, status: "failed", error: errorText(poll.error ?? "unknown_error", poll.errorDescription) }
    }
  }

  cancel(session: ConnectorQrSession): ConnectorQrSession {
    return { ...session, status: "cancelled" }
  }

  async beginQr(platform: ConnectorQrPlatform): Promise<ConnectorQrPublicSession> {
    const session = await this.beginFeishuQrFromRemote(platform)

    this.sessions.set(session.id, session)
    return toPublicSession(session)
  }

  async pollQr(sessionId: string): Promise<ConnectorQrPublicSession> {
    const session = this.requireSession(sessionId)
    if (session.status !== "waiting" && session.status !== "scanned") {
      return toPublicSession(session)
    }

    let next: ConnectorQrSession
    try {
      next = await this.pollFeishuQrFromRemote(session)
    } catch (error) {
      next = {
        ...session,
        status: "failed",
        refreshCount: session.refreshCount + 1,
        error: error instanceof Error ? error.message : "poll failed",
      }
    }

    this.sessions.set(next.id, next)
    return toPublicSession(next)
  }

  cancelQr(sessionId: string): ConnectorQrPublicSession {
    const session = this.requireSession(sessionId)
    const next = this.cancel(session)
    this.sessions.set(next.id, next)
    return toPublicSession(next)
  }

  async saveCompletedQr(input: SaveCompletedQrInput): Promise<ConnectorQrSaveResult> {
    const session = this.requireSession(input.sessionId)
    if (session.status !== "success" || !session.result) {
      throw new Error("扫码尚未完成。")
    }

    return this.saveConnectorToProject({
      projectId: input.projectId,
      type: session.platform,
      nameSuffix: session.platform,
      options: {
        app_id: session.result.appId,
        app_secret: session.result.appSecret,
        owner_open_id: session.result.ownerOpenId,
      },
    })
  }

  async saveManualPlatform(input: SaveManualPlatformInput): Promise<ConnectorQrSaveResult> {
    if (!isSupportedPlatform(input.type)) {
      throw new Error("当前仅支持新增 Feishu 或 Lark。")
    }

    return this.saveConnectorToProject({
      projectId: input.projectId,
      type: input.type,
      nameSuffix: input.type,
      name: input.name,
      enabled: input.enabled,
      options: input.options ?? {},
    })
  }

  private async beginFeishuQrFromRemote(platform: "feishu" | "lark"): Promise<ConnectorQrSession> {
    const initRaw = await this.feishuRegistrationCall(FEISHU_ACCOUNTS_BASE_URL, "init")
    const init = mapFeishuInit(initRaw)
    if (init.error) {
      return this.failed(platform, errorText(init.error, init.errorDescription))
    }
    if ((init.supportedAuthMethods ?? []).length > 0 && !init.supportedAuthMethods?.includes("client_secret")) {
      return this.failed(platform, "current environment does not support client_secret auth")
    }

    const beginRaw = await this.feishuRegistrationCall(FEISHU_ACCOUNTS_BASE_URL, "begin", {
      archetype: "PersonalAgent",
      auth_method: "client_secret",
      request_user_info: "open_id",
    })

    return this.beginFeishuRegistration(
      init,
      mapFeishuBegin(beginRaw),
      {
        platform,
        baseUrl: FEISHU_ACCOUNTS_BASE_URL,
        now: this.now(),
      },
    )
  }

  private async pollFeishuQrFromRemote(session: ConnectorQrSession): Promise<ConnectorQrSession> {
    let current = session
    let baseUrl = current.baseUrl ?? FEISHU_ACCOUNTS_BASE_URL

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.feishuRegistrationCall(baseUrl, "poll", {
        device_code: current.deviceCode ?? "",
      })
      const poll = mapFeishuPoll(raw)
      const tenantBrand = trimString(poll.tenantBrand)?.toLowerCase()

      if (tenantBrand === "lark" && baseUrl !== LARK_ACCOUNTS_BASE_URL) {
        baseUrl = LARK_ACCOUNTS_BASE_URL
        current = { ...current, platform: "lark", baseUrl }
        continue
      }

      return {
        ...this.pollFeishuRegistration({ ...current, baseUrl }, poll),
        baseUrl,
      }
    }

    return { ...current, baseUrl }
  }

  private async feishuRegistrationCall(
    baseUrl: string,
    action: string,
    params: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const form = new URLSearchParams()
    form.set("action", action)
    for (const [key, value] of Object.entries(params)) {
      form.set(key, value)
    }

    return this.postFormJson(
      `${baseUrl}/oauth/v1/app/registration`,
      form.toString(),
      `feishu ${action}`,
    )
  }

  private async postFormJson(url: string, body: string, context: string): Promise<Record<string, unknown>> {
    await this.checkNetworkPermission(url)
    const response = await this.httpClient({
      method: "POST",
      url,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      timeoutMs: 15_000,
    })

    try {
      const parsed = parseJsonObject(response.body, context)
      this.recordNetworkAudit(url, "allowed")
      return parsed
    } catch (error) {
      this.recordNetworkAudit(url, "failed")
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`${context}: http ${response.status}`)
      }
      throw error
    }
  }

  private async checkNetworkPermission(url: string): Promise<void> {
    if (!this.permissionGuard) {
      return
    }

    const resource = new URL(url).origin
    const result = await this.permissionGuard.check({
      action: "network.connect",
      actor: { kind: "user" },
      resource,
      context: { source: "connectors.qr" },
    })

    if (!result.allowed) {
      this.auditSink?.record({
        action: "network.connect",
        actor: { kind: "user" },
        resource,
        outcome: "denied",
        metadata: { reason: result.reason },
      })
      throw new Error("外部平台网络请求未授权。")
    }
  }

  private recordNetworkAudit(url: string, outcome: "allowed" | "failed"): void {
    this.auditSink?.record({
      action: "network.connect",
      actor: { kind: "user" },
      resource: new URL(url).origin,
      outcome,
      metadata: { source: "connectors.qr" },
    })
  }

  private requireSession(sessionId: string): ConnectorQrSession {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error("扫码会话不存在或已过期。")
    }
    return session
  }

  private requirePersistenceDeps(): {
    config: ConfigAccess
    registry: ConnectorRegistryService
    secretStore: ConnectorSecretStoreService
  } {
    if (!this.config || !this.registry || !this.secretStore) {
      throw new Error("连接保存服务不可用。")
    }

    return {
      config: this.config,
      registry: this.registry,
      secretStore: this.secretStore,
    }
  }

  private async saveConnectorToProject(input: {
    projectId: string
    type: string
    nameSuffix: string
    name?: string
    enabled?: boolean
    options: Record<string, unknown>
  }): Promise<ConnectorQrSaveResult> {
    const { config, registry, secretStore } = this.requirePersistenceDeps()
    const currentConfig = await config.load()
    const project = currentConfig.global.projects.find((item) => item.id === input.projectId)
    if (!project) {
      throw new Error("项目不存在。")
    }

    const connectorDraft = registry.createConnectorDraft({
      type: input.type,
      name: input.name ?? `${project.name}-${input.nameSuffix}`,
      enabled: input.enabled ?? true,
      options: input.options,
    })

    if (connectorDraft.issues.length > 0) {
      throw new Error(connectorDraft.issues[0]?.message ?? "平台配置不完整。")
    }

    await secretStore.writeConnectorSecrets(connectorDraft.secrets)
    const now = this.now().toISOString()
    const connection = createProjectPlatformConnectionFromConnector(connectorDraft.connector, now)
    const projects = currentConfig.global.projects.map((item) => {
      if (item.id !== project.id) {
        return item
      }

      const existingConnections = item.platformConnections ?? []
      return {
        ...item,
        platformConnections: [
          ...existingConnections.filter((current) => current.id !== connection.id),
          connection,
        ],
      }
    })

    await config.update({ global: { projects } })
    await this.runtime?.startOrReloadProjectConnection(project.id, connection.id)
    return { connection }
  }

  private failed(platform: ConnectorQrPlatform, error: string): ConnectorQrSession {
    return {
      id: sessionId(platform),
      platform,
      status: "failed",
      mode: "new",
      qrContent: null,
      deviceCode: null,
      baseUrl: FEISHU_ACCOUNTS_BASE_URL,
      intervalSeconds: 0,
      expiresAt: null,
      refreshCount: 0,
      result: null,
      error,
    }
  }
}
