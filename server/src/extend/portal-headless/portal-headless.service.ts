import { AsyncLocalStorage } from "node:async_hooks"
import { HttpException, Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import type { Catalog } from "@synapse/portal-headless" with { "resolution-mode": "import" }
import type { z } from "zod"
import { catalogInput, describeInput, readInput, type PortalCredentials, type PortalEnvironment } from "./contract"

export const PORTAL_SDK_LOADER = "PORTAL_HEADLESS_SDK_LOADER"
export type PortalSdk = typeof import("@synapse/portal-headless", { with: { "resolution-mode": "import" } })
type Operation = { op: "context" }
  | { op: "refresh" }
  | { op: "catalog"; input: z.infer<typeof catalogInput> }
  | { op: "describe"; input: z.infer<typeof describeInput> }
  | { op: "read"; input: z.infer<typeof readInput> }
  | { op: "invoke"; input: z.infer<typeof readInput> }
const baseUrls = { test: "https://biz-api-test.wodecorp.cn", prod: "https://biz-api.wodecorp.cn" } as const
const protocolVersion = 1
const catalogRevision = "0dae0247f34ee503d6086c58a5f6243f3665fb3d"
type CapabilityDescription = Extract<ReturnType<Catalog["describe"]>, { ok: true }>
type ExecutableCapabilityDescription = CapabilityDescription & { invoke: NonNullable<CapabilityDescription["invoke"]> }
const jsonSchemaTypes = new Set(["array", "boolean", "integer", "null", "number", "object", "string"])

function failure(status: number, code: string, message: string): HttpException {
  return new HttpException({ code, message }, status)
}
function page<T>(items: readonly T[], offset: number, limit: number) {
  const end = Math.min(offset + limit, items.length)
  return { items: items.slice(offset, end), total: items.length, nextOffset: end < items.length ? end : null, complete: end >= items.length }
}
function permitted(catalog: Catalog, id: string): ExecutableCapabilityDescription {
  const description = catalog.describe(id)
  if (!description.ok) throw failure(404, "CAPABILITY_UNAVAILABLE", "当前 SDK 目录不存在此能力。")
  if (!description.invoke) throw failure(404, "CAPABILITY_UNAVAILABLE", "当前 SDK 能力没有可执行绑定。")
  return description as ExecutableCapabilityDescription
}
async function waitForOperation<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort!: () => void
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(failure(504, "PORTAL_TIMEOUT", "Portal 操作超时，请稍后重试。"))
    if (signal.aborted) onAbort()
    else signal.addEventListener("abort", onAbort, { once: true })
  })
  try { return await Promise.race([operation, cancelled]) }
  finally { signal.removeEventListener("abort", onAbort) }
}

/** 环境各自持有 SDK 会话仓库；用户缓存与单次 HTTP 调用的取消信号独立。 */
@Injectable()
export class PortalHeadlessService implements OnModuleDestroy {
  private readonly logger = new Logger(PortalHeadlessService.name)
  private loading?: Promise<PortalSdk>
  private readonly servers = new Map<PortalEnvironment, ReturnType<PortalSdk["createPortalServer"]>>()
  private readonly requestScope = new AsyncLocalStorage<AbortSignal>()
  private readonly shutdown = new AbortController()
  private readonly active = new Map<AbortController, string>()
  constructor(@Inject(PORTAL_SDK_LOADER) private readonly load: () => Promise<PortalSdk>) {}

  onModuleDestroy() {
    this.shutdown.abort()
    for (const controller of this.active.keys()) controller.abort()
    for (const server of this.servers.values()) server.sessions.clear()
    this.servers.clear()
  }

  async run(identity: { owner: string; environment: PortalEnvironment; credential: PortalCredentials }, operation: Operation) {
    if (this.active.size >= 16 || [...this.active.values()].filter((owner) => owner === identity.owner).length >= 4) {
      throw failure(429, "EXTENSION_BUSY", "扩展查询繁忙，请稍后重试。")
    }
    const controller = new AbortController()
    this.active.set(controller, identity.owner)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    let server: ReturnType<PortalSdk["createPortalServer"]> | undefined
    let scoped: Awaited<ReturnType<NonNullable<typeof server>["forSession"]>> | undefined
    try {
      this.loading ??= this.load().catch(() => { this.loading = undefined; throw failure(503, "SDK_UNAVAILABLE", "Portal SDK 暂不可用。") })
      const sdk = await this.loading
      return await waitForOperation(this.requestScope.run(signal, async () => {
        if (signal.aborted) throw failure(504, "PORTAL_TIMEOUT", "Portal 操作超时，请稍后重试。")
        server = this.serverFor(sdk, identity.environment)
        if (server.catalog.index.pages.length === 0) throw failure(503, "SDK_RESOURCES_MISSING", "SDK 目录资源缺失。")
        if (operation.op === "refresh") {
          server.sessions.invalidate({ userId: identity.owner, tenantId: identity.credential.tenantId, language: identity.credential.language })
        }
        scoped = await server.forSession({
          userId: identity.owner, credential: identity.credential, language: identity.credential.language,
          capabilities: ["user-basic", "tenant-context"],
        })
        let data: unknown
        if (operation.op === "refresh") {
          await scoped.baseShell.getUserInfo()
          data = { refreshed: true, environment: identity.environment, tenantId: identity.credential.tenantId }
          this.logger.log({ event: "portal.session.refreshed", owner: identity.owner, environment: identity.environment,
            tenantId: identity.credential.tenantId, language: identity.credential.language })
        } else if (operation.op === "context") {
          const user = await scoped.baseShell.getUserInfo()
          const capabilities = server.catalog.index.capabilities
          data = { portalUser: { id: user.id, name: user.realName ?? user.username }, tenantId: identity.credential.tenantId,
            environment: identity.environment, now: new Date().toISOString(), timeZone: "Asia/Shanghai",
            capabilityAccess: { mode: "all", total: capabilities.length,
              read: capabilities.filter((entry) => !entry.write).length, write: capabilities.filter((entry) => entry.write).length } }
        } else {
          const catalog = server.catalog
          if (operation.op === "catalog") data = this.catalog(catalog, operation.input)
          else if (operation.op === "describe") {
            const description = permitted(catalog, operation.input.capabilityId)
            if (operation.input.kind === "capability") data = { ...description, extensionInputSchema: this.parameterSchema(description) }
            else if (operation.input.kind === "method" && operation.input.id && operation.input.id === description.invoke?.sdkPath) data = catalog.describeMethod(operation.input.id)
            else throw failure(404, "REFERENCE_UNAVAILABLE", "当前能力没有此结构或方法引用。")
          } else {
            const description = permitted(catalog, operation.input.capabilityId)
            const result = await scoped.capabilities.invoke(description.invoke.capabilityId, operation.input.arguments)
            data = { result, ai: description.ai, capabilityId: description.capabilityId }
          }
        }
        if (signal.aborted) throw failure(504, "PORTAL_TIMEOUT", "Portal 操作超时，请稍后重试。")
        return { protocolVersion, catalogRevision: `${catalogRevision}:full-${identity.environment}-v1`, data }
      }), signal)
    } catch (error) {
      const normalized = error instanceof HttpException ? error : normalizePortalError(error, signal.aborted)
      // An older in-flight failure must not invalidate a newer refreshed or rotated session.
      if ((normalized.getStatus() === 401 || operation.op === "refresh") && server && scoped && server.sessions.peek(scoped.session.key) === scoped.session) {
        server.sessions.invalidate(scoped.session.key, normalized.getStatus() === 401 ? "credential-rotated" : "manual")
      }
      throw normalized
    } finally {
      controller.abort()
      this.active.delete(controller)
    }
  }

  private serverFor(sdk: PortalSdk, environment: PortalEnvironment) {
    const cached = this.servers.get(environment)
    if (cached) return cached
    const config = { baseUrl: baseUrls[environment], timeoutMs: 10_000 }
    const requestFactory = sdk.createPortalRequestFactory(config)
    const server = sdk.createPortalServer({ ...config, permissionPolicy: sdk.loadGeneratedPermissionPolicy(), permissionSourcePin: sdk.loadPermissionSourcePin(), sessionOptions: {
      // SDK diagnostics may include upstream error messages; never forward their raw metadata.
      logger: {
        warn: (event, metadata) => {
          if (event === "portal.permission.denied") {
            const denied = metadata as { capabilityId?: unknown; policyRevision?: unknown; failedRule?: unknown } | undefined
            this.logger.warn({ event, capabilityId: typeof denied?.capabilityId === "string" ? denied.capabilityId : null,
              policyRevision: typeof denied?.policyRevision === "string" ? denied.policyRevision : null,
              failedRule: typeof denied?.failedRule === "string" ? denied.failedRule : "permission denied" })
          } else this.logger.warn({ event: "portal.session.degraded" })
        },
        error: () => this.logger.error({ event: "portal.session.failed" }),
      },
      createRequest: (context) => {
        const request = requestFactory(context)
        return (input) => {
          // Resolve at send time: a cached session must never retain a previous request's signal.
          const operationSignal = this.requestScope.getStore()
          if (!operationSignal) throw new Error("Portal request outside operation scope")
          // Single-flight base data belongs to the session, not its first waiting caller.
          const signal = input.capabilityId?.startsWith("base-data:") ? this.shutdown.signal : operationSignal
          if (signal.aborted) throw failure(504, "PORTAL_TIMEOUT", "Portal 操作超时，请稍后重试。")
          return request({ ...input, signal, timeout: 10_000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, maxBodyLength: 256 * 1024 })
        }
      },
    } })
    this.servers.set(environment, server)
    return server
  }

  private parameterSchema(description: CapabilityDescription) {
    const required = description.params.filter((parameter) => parameter.required).map((parameter) => parameter.name)
    return {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: Object.fromEntries(description.params.map((parameter) => {
        const types = (parameter.contract?.type?.split("|").map((type) => type.trim()).filter((type) => jsonSchemaTypes.has(type)) ?? [])
        if (parameter.contract?.nullable && !types.includes("null")) types.push("null")
        return [parameter.name, {
          ...(types.length ? { type: types.length === 1 ? types[0] : types } : {}),
          ...(parameter.description ? { description: parameter.description } : {}),
          ...(parameter.contract?.format ? { format: parameter.contract.format } : {}),
          ...(parameter.options ? { enum: parameter.options.map((option) => option.value) } : {}),
        }]
      })),
      ...(required.length ? { required } : {}),
      additionalProperties: false,
    }
  }

  private catalog(catalog: Catalog, input: z.infer<typeof catalogInput>) {
    switch (input.op) {
      case "domains": { const result = catalog.listDomains({ detail: false }); return { ...result, domains: undefined, ...page(result.domains, input.offset, input.limit) } }
      case "pages": { const result = catalog.listPages(input.domain); return { ...result, pages: undefined, ...page(result.pages, input.offset, input.limit) } }
      case "page": return catalog.describePage(input.pageId)
      case "search": { const result = catalog.search(input.query, { limit: 100 }); return { ...result, hits: undefined, ...page(result.hits, input.offset, input.limit) } }
      case "recommend": return catalog.recommend(input.query, { limit: 5 })
    }
  }
}

export function normalizePortalError(error: unknown, timedOut = false): HttpException {
  let current = error
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    const item = current as { name?: string; code?: number | string; response?: { status?: number }; cause?: unknown }
    if (item.name === "PermissionDeniedError") {
      const denied = item as { capabilityId?: string; policyRevision?: string | null; failedRule?: string }
      return new HttpException({
        code: "PH_PERMISSION_DENIED",
        message: "PH 权限策略拒绝当前能力。",
        capabilityId: denied.capabilityId,
        policyRevision: denied.policyRevision,
        failedRule: denied.failedRule,
      }, 403)
    }
    if (item.code === 403 || item.response?.status === 403 || item.code === 1002015001) {
      return failure(403, "PORTAL_FORBIDDEN", "Portal 拒绝当前账号或企业访问。")
    }
    if (item.code === 401 || item.code === 10001 || item.response?.status === 401 || item.name === "PortalCredentialError") {
      return failure(401, "PORTAL_CREDENTIAL_INVALID", "Portal 凭证已失效，请重新连接。")
    }
    if (item.code === "ECONNABORTED" || item.code === "ERR_CANCELED") timedOut = true
    current = item.cause
  }
  return timedOut ? failure(504, "PORTAL_TIMEOUT", "Portal 操作超时，请稍后重试。")
    : failure(502, "PORTAL_REQUEST_FAILED", "Portal 操作失败，请检查参数、连接与企业权限后重试。")
}
