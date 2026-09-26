/**
 * 默认的基础数据能力表：逐项对齐 Portal 前端的 `BASE_DATA_REGISTRY`
 * （`app/portal/utils/router/base-data.js:57-104`，六项）+ 它指向的真实接口
 * （`app/portal/utils/system.js`）。
 *
 * 对应关系（左 = 这里，右 = base-data.js / system.js）：
 *
 * | key             | Portal 的 load                | 接口                                             | critical |
 * | --------------- | ----------------------------- | ------------------------------------------------ | -------- |
 * | user-basic      | fetchSimpleUserBasic          | GET /sys/user/info                               | 是       |
 * | tenant-context  | ensureTenantContext           | GET /admin-api/hr/system-tenant/getUserTenantsByPage | 是   |
 * | tenant-system   | fetchTenantSystem             | GET /admin-api/system/tenant/get                 | 否       |
 * | security-config | fetchSecurityConfigs          | GET /adminmanage-api/adminmanage/platform-config/list | 否  |
 * | dict-hr         | softFetchAllDicts             | GET /admin-api/system/dict-data/grouped-list     | 否       |
 * | dict-platform   | softFetchAllPlatformDicts     | GET /admin-api/system/dict-data/grouped-list     | 否       |
 *
 * `critical` 的两项与 Portal 完全一致（base-data.js 里只有 user-basic 和 tenant-context 带 `critical: true`）。
 *
 * **两点必须说清楚的保留意见**（别当成已验证的事实）：
 *
 * 1. 这里复刻的是**接口路径、参数与关键字段的解析**（例如 tenant-system 的 `useSystem` 逗号串拆数字，
 *    与 system.js:683-690 一致）。但「响应体归一化成 Portal store 的形状」这一层，Portal 是在
 *    各自的 `fetch*` 里做的；SDK 现在返回的是**够用的最小归一化**，没有逐字段复刻 `normalizeSecurityConfigs`
 *    之外的加工。真正的口径要按 D20 用浏览器基准逐字段比对——那是逐页推进时的事（D24/D26），不是这里。
 * 2. `dict-hr` 与 `dict-platform` 在当前 Portal 版本里指向同一个 grouped-list 接口
 *    （system.js:283 / system.js:376）。保留两个 key 是为了与注册表对齐、便于页面按需声明；
 *    如果确认它们对同一个能力永远同源，接入方可以只用其中一个、或让 dict-hr `deps: ['dict-platform']`。
 */

import { BaseDataRegistry } from './registry.js'
import type { BaseDataCapability, BaseDataLoadContext } from './types.js'

export const PORTAL_BASE_DATA_KEYS = {
  userBasic: 'user-basic',
  tenantContext: 'tenant-context',
  tenantSystem: 'tenant-system',
  securityConfig: 'security-config',
  dictHr: 'dict-hr',
  dictPlatform: 'dict-platform',
} as const

/** getUserTenantsByPage 的分页参数，与 system.js:600-606 的 loopFetch 配置一致 */
const TENANT_LIST_PAGE_SIZE = 200
const TENANT_LIST_MAX_PAGES = 100

type PageResult<T> = { list?: T[]; total?: number }

export const PORTAL_BASE_DATA_CAPABILITIES: readonly BaseDataCapability[] = [
  {
    key: PORTAL_BASE_DATA_KEYS.userBasic,
    label: '用户基础信息',
    critical: true,
    onlySimpleForm: true,
    // system.js:459 —— http.get('/sys/user/info')，前缀由 client 的拦截器补
    load: ({ request }: BaseDataLoadContext) =>
      request({ url: '/sys/user/info', method: 'get' }),
  },

  {
    key: PORTAL_BASE_DATA_KEYS.tenantContext,
    label: '租户上下文',
    critical: true,
    onlySimpleForm: true,
    /**
     * 无头下租户是调用方显式给的（它已经进了会话键），所以这个能力不再"挑一个租户"，
     * 而是校验**这个用户确实属于这个租户**——这正是浏览器里 ensureTenantContext
     * 拉全量企业列表换来的那个前提。命中即停，不必翻完 100 页。
     */
    async load ({ request, session }: BaseDataLoadContext) {
      const wanted = session.key.tenantId
      const tenants: unknown[] = []

      for (let pageNo = 1; pageNo <= TENANT_LIST_MAX_PAGES; pageNo += 1) {
        const page = await request<PageResult<{ id?: number | string }>>({
          url: '/admin-api/hr/system-tenant/getUserTenantsByPage',
          method: 'get',
          params: { pageNo, pageSize: TENANT_LIST_PAGE_SIZE },
        })

        const list = Array.isArray(page?.list) ? page.list : []
        tenants.push(...list)

        if (list.some((tenant) => String(tenant?.id ?? '') === wanted)) {
          return { tenantId: wanted, tenants }
        }
        if (list.length < TENANT_LIST_PAGE_SIZE) {
          break
        }
      }

      throw new Error(`用户不属于租户 ${wanted}（企业列表里找不到，共取回 ${tenants.length} 条）`)
    },
  },

  {
    key: PORTAL_BASE_DATA_KEYS.tenantSystem,
    label: '企业开通系统',
    deps: [PORTAL_BASE_DATA_KEYS.tenantContext],
    onlySimpleForm: true,
    // system.js:674-690 —— 路径、参数与 useSystem 逗号串拆数字的规则逐条对齐
    async load ({ request, session }: BaseDataLoadContext) {
      const result = await request<{ useSystem?: string }>({
        url: '/admin-api/system/tenant/get',
        method: 'get',
        params: { id: session.key.tenantId },
      })

      const raw = typeof result?.useSystem === 'string' ? result.useSystem : ''
      return raw
        .split(',')
        .filter((item) => item !== '')
        .map((item) => item.trim())
        .map(Number)
        .filter((system) => Number.isFinite(system))
    },
  },

  {
    key: PORTAL_BASE_DATA_KEYS.securityConfig,
    label: '安全配置',
    deps: [PORTAL_BASE_DATA_KEYS.tenantContext],
    onlySimpleForm: true,
    async load ({ request, now }: BaseDataLoadContext) {
      const groups = await request<Record<string, unknown> | null>({
        url: '/adminmanage-api/adminmanage/platform-config/list',
        method: 'get',
      })
      return normalizeSecurityConfigs(groups, now)
    },
  },

  {
    key: PORTAL_BASE_DATA_KEYS.dictHr,
    label: 'HR/HXR 字典',
    onlySimpleForm: true,
    load: loadGroupedDicts,
  },

  {
    key: PORTAL_BASE_DATA_KEYS.dictPlatform,
    label: '平台字典',
    onlySimpleForm: true,
    load: loadGroupedDicts,
  },
]

/** 造一份 Portal 对齐的默认注册表。要替换其中某项时用 `registry.replace(...)` */
export function createPortalBaseDataRegistry (): BaseDataRegistry {
  return new BaseDataRegistry().registerAll(PORTAL_BASE_DATA_CAPABILITIES)
}

/**
 * 复刻 system.js:109-124 的 normalizeSecurityConfigs：
 * `{ groups, list, byKey, loadedAt }`。byKey 是给"按 configKey 取一项"用的索引。
 */
function normalizeSecurityConfigs (
  groups: Record<string, unknown> | null | undefined,
  now: number,
): { groups: Record<string, unknown>; list: unknown[]; byKey: Record<string, unknown>; loadedAt: number } {
  const normalizedGroups = groups ?? {}
  const list = Object.values(normalizedGroups).flatMap((group) => (Array.isArray(group) ? group : []))

  const byKey: Record<string, unknown> = {}
  for (const item of list) {
    const configKey = (item as { configKey?: unknown } | null)?.configKey
    if (typeof configKey === 'string' && configKey !== '') {
      byKey[configKey] = item
    }
  }

  return { groups: normalizedGroups, list, byKey, loadedAt: now }
}

/**
 * 复刻 system.js:283-291 / 376-384 对 grouped-list 的加工：
 * `[{ dictType, dataList: [{ label, value, id }] }]` → `{ [dictType]: [{ label, value, id }] }`
 */
async function loadGroupedDicts ({ request }: BaseDataLoadContext): Promise<Record<string, unknown>> {
  const result = await request<Array<{
    dictType?: string
    dataList?: Array<{ label?: unknown; value?: unknown; id?: unknown }>
  }>>({
    url: '/admin-api/system/dict-data/grouped-list',
    method: 'get',
  })

  const grouped: Record<string, unknown> = {}
  for (const item of Array.isArray(result) ? result : []) {
    const dictType = item?.dictType
    if (typeof dictType !== 'string' || dictType === '') {
      continue
    }
    grouped[dictType] = (item.dataList ?? []).map((entry) => ({
      label: entry?.label,
      value: entry?.value,
      id: entry?.id,
    }))
  }
  return grouped
}
