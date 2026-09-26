/**
 * 批量生成能力的注册入口 —— **由 `tools/generate/batch-capabilities.mjs` 生成，勿手改。**
 *
 * 这个文件是"接线点"，故意**不**放进 `src/index.ts`：
 * 批量产出需要先验证过（见同目录 `batch-report.json` 的正确率），再由主会话决定接不接、
 * 接哪些。
 *
 * ⚠️ **SDK 接线用 `BATCH_SDK_CAPABILITIES`，不是 `BATCH_CAPABILITIES`。**
 * 后者是**审计清单**：它按"抽不抽得出来"组织，因此也包含打到别的后端（`scope !== 'in-scope'`）
 * 的页面——那些页面是别的产品线的接口，接进来会打到错的 URL。
 * 接线时把它们并进 `portal.capabilities`，等于静默发错请求。
 * `BATCH_IN_SCOPE_CAPABILITIES` 还包含 `partial` 契约，只供审计与人工补齐。
 *
 * 用法（主会话接线时）：
 * ```ts
 * import { BATCH_SDK_CAPABILITIES, createBatchListCapability } from './capabilities/generated/index.js'
 * // ...
 * const capabilities = [...meetingRoomCapabilities, ...meetingApplicationCapabilities, ...BATCH_SDK_CAPABILITIES]
 * ```
 */

import type { CapabilityDefinition, ParamSpec } from '../types.js'
import type { PortalRequestConfig } from '../../http/client.js'
import type { PortalRequest } from '../meeting-room.js'
import {
  BATCH_CAPABILITIES,
  BATCH_ENDPOINTS,
  BATCH_GENERATED_META,
  type BatchEndpoint,
  type BatchQueryParam,
} from './batch-capabilities.js'

export { BATCH_CAPABILITIES, BATCH_ENDPOINTS, BATCH_GENERATED_META }
export type { BatchEndpoint, BatchQueryParam }

/** 只保留判定为 auto 的页面：partial 的契约里有已知缺口，接线时不该默认开放。 */
export const BATCH_AUTO_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.verdict === 'auto',
)

/**
 * **范围**维度（决策 D3 只做 Portal 主后端）：
 * `in-scope` = 列表请求走 `platform` 实例，接进来发的是同一个后端；其余一律不可接线。
 */
export const BATCH_IN_SCOPE_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.scope === 'in-scope',
)

/**
 * 真正接入 SDK 的安全子集：固定菜单保留、后端范围内且静态抽取结论为 auto。
 *
 * `BATCH_IN_SCOPE_CAPABILITIES` 仍然保留给审计与人工复核，它还包含 partial
 * 契约；把 partial 直接开放成 SDK 能力会让调用方以为表单/路径已经完整对齐。
 * 这里的 `write: false` 是刻意的：该入口只提供自动抽取出的 GET 列表请求，
 * 不代表对应 Portal 页面没有新增、编辑或删除动作。
 */
export const BATCH_SDK_CAPABILITIES: CapabilityDefinition[] = BATCH_CAPABILITIES
  .filter((c) => {
    const endpoint = BATCH_ENDPOINTS[c.id]
    return endpoint?.scope === 'in-scope' &&
      endpoint.menuScope === 'retained' &&
      endpoint.verdict === 'auto'
  })
  .map((c) => ({ ...c, write: false }))

/**
 * 范围外的契约，**只用于审计**：留在生成物里是为了让"有哪几页被打到别的后端"这件事
 * 可见、可复核、可回归。它们对应的后端不在本项目范围内，别接。
 */
export const BATCH_OUT_OF_SCOPE_CAPABILITIES = BATCH_CAPABILITIES.filter(
  (c) => BATCH_ENDPOINTS[c.id]?.scope !== 'in-scope',
)

export type BatchListQuery = Record<string, string | number | boolean | null | undefined>

export type BatchPageRequest = (
  pagePath: string,
  config: PortalRequestConfig,
) => Promise<unknown>

type BatchRequest = (config: Parameters<PortalRequest>[0]) => Promise<unknown>

function createBatchListCapabilityFromRequest (endpoint: BatchEndpoint, request: BatchRequest) {
  if (endpoint.scope !== 'in-scope') {
    throw new Error(
      `${endpoint.pagePath} 的列表请求走 ${endpoint.httpInstance} 实例` +
      `（${endpoint.httpModule}，baseURL=${endpoint.baseUrlEnv}），不在 SDK 的 Portal 主后端范围内` +
      `（scope=${endpoint.scope}，决策 D3）。这条契约只能用于审计，不能发请求。`,
    )
  }
  return {
    /** 按该页的契约查询列表 */
    list (query: BatchListQuery = {}): Promise<unknown> {
      const params: Record<string, unknown> = {}
      for (const item of endpoint.staticQuery) params[item.name] = item.defaultValue
      for (const item of endpoint.query) {
        const provided = query[item.name]
        params[item.name] = provided === undefined ? item.defaultValue : provided
      }
      return request({ url: endpoint.url, method: 'get', params })
    },
  }
}

/**
 * 把一页的请求契约变成可调用的列表查询。
 *
 * 参数顺序严格按 `endpoint.query`：renren 的列表接口要靠 order/orderField/form 同序，
 * 才能和浏览器请求逐字段一致（设计 D20）。
 *
 * **范围外直接拒绝**，与 `resolveHttpInstance` 失败时拒发请求是同一条口径：
 * 这条契约的 `url` 不是给本项目那个后端用的，静默发出去只会得到一个 404 或者
 * 一个字段对不上的 200，两种都很难查。
 */
export function createBatchListCapability (endpoint: BatchEndpoint, request: PortalRequest) {
  return createBatchListCapabilityFromRequest(endpoint, (config) => request<unknown>(config))
}

/** 与门面的 `call(pagePath, config)` 对接，确保 module-type / http 实例规则仍按页面解析。 */
export function createBatchListPageCapability (endpoint: BatchEndpoint, request: BatchPageRequest) {
  return createBatchListCapabilityFromRequest(endpoint, (config) => request(endpoint.pagePath, config))
}

/** capability ID 的稳定方法名：`batch:foo-bar-list` → `fooBarList`。 */
export function batchMethodName (capabilityId: string): string {
  return capabilityId
    .replace(/^batch:/, '')
    .replace(/[-:]([a-zA-Z])/g, (_match, character: string) => character.toUpperCase())
}

export type BatchCapability = ReturnType<typeof createBatchListCapability>
export type BatchCapabilityHost = Record<string, BatchCapability>

/** 构造 SDK 门面上的批量列表方法组；只暴露安全子集，不绕过页面上下文。 */
export function createBatchCapabilityHost (request: BatchPageRequest): BatchCapabilityHost {
  const host: BatchCapabilityHost = {}
  for (const capability of BATCH_SDK_CAPABILITIES) {
    const endpoint = BATCH_ENDPOINTS[capability.id]
    if (endpoint === undefined) throw new Error(`批量能力缺少请求契约：${capability.id}`)
    host[batchMethodName(capability.id)] = createBatchListPageCapability(endpoint, request)
  }
  return host
}

/** 该页声明的参数契约（给 AI 看的形态） */
export function batchParamSpecs (endpoint: BatchEndpoint): ParamSpec[] {
  return BATCH_CAPABILITIES.find((c) => c.id === endpoint.capabilityId)?.params ?? []
}
