import { randomUUID } from "node:crypto"
import { HttpException, Inject, Injectable, Logger, OnModuleDestroy } from "@nestjs/common"
import type { Catalog } from "portal-headless" with { "resolution-mode": "import" }
import type { z } from "zod"
import { catalogInput, describeInput, readInput, type PortalCredentials } from "./contract"

export const PORTAL_SDK_LOADER = "PORTAL_HEADLESS_SDK_LOADER"
export type PortalSdk = typeof import("portal-headless", { with: { "resolution-mode": "import" } })
type Operation = { op: "context" }
  | { op: "catalog"; input: z.infer<typeof catalogInput> }
  | { op: "describe"; input: z.infer<typeof describeInput> }
  | { op: "read"; input: z.infer<typeof readInput> }
  | { op: "invoke"; input: z.infer<typeof readInput> }
const baseUrl = "https://biz-api-test.wodecorp.cn"
const protocolVersion = 1
const catalogRevision = "0dae0247f34ee503d6086c58a5f6243f3665fb3d:full-test-v1"
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

/** 每个 HTTP 请求独立 SDK 会话，用完清理，避免跨凭证缓存与本机断开语义混淆。 */
@Injectable()
export class PortalHeadlessService implements OnModuleDestroy {
  private readonly logger = new Logger(PortalHeadlessService.name)
  private loading?: Promise<PortalSdk>
  private readonly active = new Map<AbortController, string>()
  constructor(@Inject(PORTAL_SDK_LOADER) private readonly load: () => Promise<PortalSdk>) {}

  onModuleDestroy() { for (const controller of this.active.keys()) controller.abort() }

  async run(identity: { owner: string; credential: PortalCredentials }, operation: Operation) {
    if (this.active.size >= 16 || [...this.active.values()].filter((owner) => owner === identity.owner).length >= 4) {
      throw failure(429, "EXTENSION_BUSY", "扩展查询繁忙，请稍后重试。")
    }
    const controller = new AbortController()
    this.active.set(controller, identity.owner)
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
    let server: ReturnType<PortalSdk["createPortalServer"]> | undefined
    try {
      this.loading ??= this.load().catch(() => { this.loading = undefined; throw failure(503, "SDK_UNAVAILABLE", "Portal SDK 暂不可用。") })
      const sdk = await this.loading
      const config = { baseUrl, timeoutMs: 10_000 }
      const requestFactory = sdk.createPortalRequestFactory(config)
      server = sdk.createPortalServer({ ...config, sessionOptions: {
        maxSessions: 1, idleTtlMs: 30_000, absoluteTtlMs: 30_000,
        // SDK diagnostics may include upstream error messages; never forward their raw metadata.
        logger: {
          warn: () => this.logger.warn({ event: "portal.session.degraded" }),
          error: () => this.logger.error({ event: "portal.session.failed" }),
        },
        createRequest(context) {
          const request = requestFactory(context)
          return (input) => request({ ...input, signal, timeout: 10_000, maxRedirects: 0, maxContentLength: 2 * 1024 * 1024, maxBodyLength: 256 * 1024 })
        },
      } })
      if (server.catalog.index.pages.length === 0) throw failure(503, "SDK_RESOURCES_MISSING", "SDK 目录资源缺失。")
      const scoped = await server.forSession({
        userId: `${identity.owner}:${randomUUID()}`, credential: identity.credential, language: identity.credential.language,
        capabilities: ["user-basic", "tenant-context"],
      })
      let data: unknown
      if (operation.op === "context") {
        const user = await scoped.baseShell.getUserInfo()
        const capabilities = server.catalog.index.capabilities
        data = { portalUser: { id: user.id, name: user.realName ?? user.username }, tenantId: identity.credential.tenantId,
          environment: "test", now: new Date().toISOString(), timeZone: "Asia/Shanghai",
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
      return { protocolVersion, catalogRevision, data }
    } catch (error) {
      if (error instanceof HttpException) throw error
      throw normalizePortalError(error, signal.aborted)
    } finally {
      controller.abort()
      server?.sessions.clear()
      this.active.delete(controller)
    }
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
