import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import {
  AI_ANALYSIS_PATHS,
  AI_DATA_ANALYSIS_PAGE_PATH,
  AI_MODEL_LIST_PAGE_PATH,
  AI_MODEL_PATHS,
  AI_MODEL_PERMISSIONS,
  AI_MODEL_SELECTION_PATHS,
  AI_MODEL_SELECT_PAGE_PATH,
  AI_PLATFORM_USAGE_PAGE_PATH,
  AI_TOKEN_PATHS,
  APPLY_STATUS,
  CALL_TYPE,
  DEFAULT_PAGE_SIZE,
  HISTORY_CONFIG_TYPE,
  QUOTA_CYCLE,
  RULE_SCOPE,
  STATISTICS_DIMENSION,
  TIME_RANGE,
  aiModelCapabilities,
  buildAnalysisParams,
  buildApplyQuery,
  buildFlowRuleSavePayload,
  buildModelListParams,
  buildModelSavePayload,
  buildModelSelectionSavePayload,
  buildModelTestBodyFromForm,
  buildModelTestBodyFromRow,
  buildQuotaRuleSavePayload,
  buildUsageRecordQuery,
  cleanQuery,
  createAiModelCapability,
  normalizeNumber,
} from '../src/capabilities/ai-model.js'
import { normalizeVisibilityKey } from '../src/catalog/visibility.js'
import { resolveHttpInstance } from '../src/context/http-instance.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 分组与判据（**判据栏写"基准"的才叫验证过**，其余是"推导出来的形状没被手滑改掉"）：
 *
 * | 组 | 锁的是什么 | 判据 |
 * | --- | --- | --- |
 * | A 能力定义 | pagePath / 权限码 / write 标记 与 `generated/page-catalog.json` 对齐 | 目录（生成物） |
 * | B 请求层 | **本能力自己**发出的 URL、方法、键序 | 页面源码 + `src/http/client.ts` |
 * | C 请求头 | 这四页**不发** `module-type`；实例落到 platform 且 `/admin-api` 只补一次 | 规则表 + conventions 2/25/26 |
 * | D 写链路 | 每个写操作的 method / URL / body 逐字节；prepare 与 submit 同一份载荷 | 页面源码 + 后端 controller（**无写基准**） |
 * | E 本地校验 | 参数错时不发请求，且走 `Promise.reject` | 页面表单规则 + 后端 `@NotNull` |
 * | F 纯函数 | 载荷构造可独立断言（`cleanQuery` 的丢空值语义等） | 页面 `utils.js` |
 * | G 降级 | 一路失败不拖垮其余、`errors` 记账 | 页面 `Promise.all` + 各自 try/catch 的语义 |
 * | I 常量 | 端点字面量与枚举取值 | 页面源码 + 后端枚举 |
 * | **J 基准** | **四页的读请求与 `baseline/ai-model.browser.json` 逐字段一致（含键顺序）** | **浏览器基准（判据）** |
 * | K todo | 写链路（基准里 23 条**全是 GET** ⇒ 写形状至今无判据） | 等一次真机写验证 |
 *
 * J 组到位后（2026-09-21，基准 23 条 / 4 页），B 组里那些"推导出来的形状"被**证实**了 ——
 * 四条列表 + 一条角标 + 六条图表接口，**每一条都与基准逐字相同**（含 `_t` 排在最后）。
 * B 组保留不删：它是"改动时先红的那一层"，定位比 J 组精确。
 *
 * ⚠️ 基准里有两类**不是页面契约**的东西（J 组有断言专门锁这个）：
 * 1. 每页两条**门户外壳请求**（`org/sensitive/info`、`bpm/task/list-by-category?finished=1&…`）——
 *    钩子在 SPA 里跨 hash 导航不卸载，外壳自己发的。
 * 2. 「点查询会**重发**一条只差 `_t` 的相同请求」⇒ 断言要写成"存在一条相符"，
 *    **不要**写成"只出现一次"。
 */

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（D20） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : value] as [string, string]
  })
}

const keysOf = (rawUrl: string): string[] => queryPairs(rawUrl).map(([key]) => key)

/** 去掉 host 与 `_t` 的具体值，只留形状 */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/** 适配器拿到的 `config.data` 已经是 axios `transformRequest` 之后的字符串 */
const bodyOf = (call: CapturedCall | undefined): string => String(call?.data ?? '')

/** body 的键序（JSON 保序，所以这是能断言的） */
const bodyKeys = (call: CapturedCall | undefined): string[] =>
  Object.keys(JSON.parse(bodyOf(call) || '{}') as Record<string, unknown>)

/** DELETE 不走 qs 拦截器（platform.js 只对 GET 拼 params），axios 自己的序列化器出场 */
const deleteQueryOf = (rawUrl: string): string => rawUrl.split('?')[1] ?? ''

// ---------------------------------------------------------------------------
// 浏览器基准（**判据**，conventions 第 31 条）
// ---------------------------------------------------------------------------

type BaselineRequest = {
  页面: string
  pagePath: string
  via: string
  method: string
  url: string
  headers?: Record<string, string>
  body?: unknown
}
type Baseline = { requests: BaselineRequest[] }

const BASE = JSON.parse(
  readFileSync(join(here, '../baseline/ai-model.browser.json'), 'utf8'),
) as Baseline

/** 按页面 + URL 片段取基准里的那一条（同一条可能因"点查询重发"出现多次，取第一条即可） */
function reqOf (pagePath: string, match: RegExp): BaselineRequest {
  const hit = BASE.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
  if (!hit) throw new Error(`基准里找不到 ${pagePath} 的 ${match}`)
  return hit
}

/**
 * 每页两条**外壳请求**（`org/sensitive/info` 与 `bpm/task/list-by-category`）是
 * 门户外壳自己发的，**不是页面契约** —— 基准里留着它们是因为钩子在 SPA 里跨 hash 导航不卸载。
 * 本能力一条都不发（J 组有一条断言专门锁这个）。
 */
const SHELL_PATTERNS = [/\/org\/sensitive\/info/, /\/bpm\/task\/list-by-category/]

/**
 * 四个页面各一个 `request`（与门面的接法一致）。记录 `call` 收到的配置。
 *
 * `respond` 用来换掉默认的假响应体（默认 `{list: [], total: 0}`，够比 URL 了）。
 */
function build (respond?: (config: InternalAxiosRequestConfig) => unknown) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
    calls.push(config as CapturedCall)
    return {
      data: {
        ret: 'SUCCESS',
        code: 0,
        msg: '',
        data: respond ? respond(config) : { list: [], total: 0 },
      },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }) as never
  const at = (pagePath: string): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object) } as never)
  return {
    calls,
    sdk,
    cap: createAiModelCapability(
      at(AI_MODEL_LIST_PAGE_PATH),
      at(AI_MODEL_SELECT_PAGE_PATH),
      at(AI_PLATFORM_USAGE_PAGE_PATH),
      at(AI_DATA_ANALYSIS_PAGE_PATH),
    ),
  }
}

const QUOTA_RULE_DRAFT = {
  modelId: 100,
  ruleScope: RULE_SCOPE.tenant,
  targetTenantId: 7,
  targetTenantName: '测试租户',
  totalQuota: 100000,
  carryOverRule: 1,
  resetCycle: 3,
  shortageStrategy: 1,
  startTime: '2026-06-01 00:00:00',
  endTime: '2026-06-30 23:59:59',
  reason: 'SDK-TEST-额度',
} as const

const FLOW_RULE_DRAFT = {
  modelId: 100,
  ruleScope: RULE_SCOPE.general,
  memberLevel: 3,
  flowCheckEnabled: true,
  tokenLimitPerMinute: 60000,
  maxTokenPerRequest: 8192,
  exceedStrategy: 1,
  startTime: '2026-06-01 00:00:00',
  reason: 'SDK-TEST-流速',
} as const

// ---------------------------------------------------------------------------
// A. 能力定义 ↔ generated/page-catalog.json
// ---------------------------------------------------------------------------

describe('A. 28 条能力定义与 page-catalog.json 对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string | null; permission: string; title: string }> }
  const byPath = new Map(
    catalog.items.filter((item) => item.menuPath !== null).map((item) => [item.menuPath as string, item]),
  )

  it('28 条定义的 pagePath 在目录里逐字存在（多一个字少一个字都要红）', () => {
    expect(aiModelCapabilities).toHaveLength(28)
    for (const capability of aiModelCapabilities) {
      expect(byPath.has(capability.pagePath), `${capability.id} 的 pagePath 不在目录里：${capability.pagePath}`).toBe(true)
    }
  })

  it('pagePath 只落在这四页上，四页各有过半的能力', () => {
    const counts = new Map<string, number>()
    for (const capability of aiModelCapabilities) {
      counts.set(capability.pagePath, (counts.get(capability.pagePath) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([
      AI_DATA_ANALYSIS_PAGE_PATH,
      AI_MODEL_LIST_PAGE_PATH,
      AI_MODEL_SELECT_PAGE_PATH,
      AI_PLATFORM_USAGE_PAGE_PATH,
    ].sort())
    // 模型列表这一页确实最重（写链路全在它身上）
    expect(counts.get(AI_MODEL_LIST_PAGE_PATH)).toBe(17)
    expect(counts.get(AI_MODEL_SELECT_PAGE_PATH)).toBe(4)
    expect(counts.get(AI_PLATFORM_USAGE_PAGE_PATH)).toBe(6)
    expect(counts.get(AI_DATA_ANALYSIS_PAGE_PATH)).toBe(1)
  })

  it('能力 id 互不重复', () => {
    const ids = aiModelCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('九条写能力，十九条只读；`ai-model-test` 是 **POST 但只读**', () => {
    const writes = aiModelCapabilities.filter((c) => c.write).map((c) => c.id).sort()
    expect(writes).toEqual([
      'ai-model-apply-handle',
      'ai-model-delete',
      'ai-model-flow-rule-delete',
      'ai-model-flow-rule-save',
      'ai-model-quota-rule-delete',
      'ai-model-quota-rule-save',
      'ai-model-save',
      'ai-model-selection-delete',
      'ai-model-selection-save',
    ])
    expect(aiModelCapabilities.filter((c) => !c.write)).toHaveLength(19)
    // ⚠️ 连通性测试用的是 POST，但后端只探上游、不落库 ⇒ write:false
    //    （`availableStatus` 要等"保存"才写进模型行）
    expect(aiModelCapabilities.find((c) => c.id === 'ai-model-test')?.write).toBe(false)
  })

  it('权限码与目录**归一后**一致（v1 vs v2 只差一代前缀）', () => {
    for (const capability of aiModelCapabilities) {
      const entry = byPath.get(capability.pagePath)
      expect(entry, capability.id).toBeDefined()
      expect(normalizeVisibilityKey(String(capability.permission)), capability.id).toBe(
        normalizeVisibilityKey(String(entry?.permission)),
      )
    }
  })

  it('能力定义里的权限码一律是 **v2**（线上那一份）', () => {
    for (const capability of aiModelCapabilities) {
      expect(String(capability.permission), capability.id).toContain('/dashboard/platform-v2/')
    }
    expect(aiModelCapabilities.find((c) => c.id === 'data-analysis-overview')?.permission).toBe(
      AI_MODEL_PERMISSIONS.dataAnalysis.v2,
    )
  })

  /** 当前 Portal 的菜单入口加载 `menus/mall.v2.js`，四页目录权限均为 v2。 */
  it('目录侧：四页均为当前生效的 v2 权限', () => {
    expect(byPath.get(AI_MODEL_LIST_PAGE_PATH)?.permission).toBe(AI_MODEL_PERMISSIONS.model.v2)
    expect(byPath.get(AI_MODEL_SELECT_PAGE_PATH)?.permission).toBe(AI_MODEL_PERMISSIONS.modelSelect.v2)
    expect(byPath.get(AI_PLATFORM_USAGE_PAGE_PATH)?.permission).toBe(AI_MODEL_PERMISSIONS.platformUsage.v2)
    expect(byPath.get(AI_DATA_ANALYSIS_PAGE_PATH)?.permission).toBe(AI_MODEL_PERMISSIONS.dataAnalysis.v2)
  })

  it('长选项参数都带了 lookup（conventions 第 11 条）', () => {
    const expectLookup = (capabilityId: string, paramName: string): void => {
      const capability = aiModelCapabilities.find((c) => c.id === capabilityId)
      const param = capability?.params.find((p) => p.name === paramName)
      expect(param, `${capabilityId}.${paramName}`).toBeDefined()
      expect(param?.lookup, `${capabilityId}.${paramName} 缺 lookup`).toBeDefined()
      expect(param?.kind === 'search' || param?.kind === 'tree').toBe(true)
    }
    expectLookup('ai-model-quota-rule-save', 'targetTenantId')
    expectLookup('ai-model-quota-rule-save', 'targetUserPhone')
    expectLookup('ai-model-flow-rule-save', 'targetTenantId')
    expectLookup('ai-model-flow-rule-save', 'targetUserPhone')
    expectLookup('ai-model-selection-save', 'details')
    expectLookup('platform-usage-quota-list', 'tenantId')
    // 租户那两条指回已有的 base-tenant-list，而不是再开一个重复的
    const tenantParam = aiModelCapabilities
      .find((c) => c.id === 'platform-usage-quota-list')
      ?.params.find((p) => p.name === 'tenantId')
    expect(tenantParam?.lookup?.capabilityId).toBe('base-tenant-list')
    // 人员那一条指回本文件自己的 search-user（另一个上游，与 general-approval-user-search 不同端点）
    const userParam = aiModelCapabilities
      .find((c) => c.id === 'ai-model-quota-rule-save')
      ?.params.find((p) => p.name === 'targetUserPhone')
    expect(userParam?.lookup?.capabilityId).toBe('ai-model-search-user')
  })

  it('search-user 的 keyword 是**必填**（无关键字全量拉会冲掉调用方上下文）', () => {
    const capability = aiModelCapabilities.find((c) => c.id === 'ai-model-search-user')
    const keyword = capability?.params.find((p) => p.name === 'keyword')
    expect(keyword?.required).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// B. 请求层：URL / 方法 / 键序（**本能力自己**发出的形状）
// ---------------------------------------------------------------------------

describe('B. 请求层：URL、方法与键序', () => {
  it('模型列表：order/orderField 照发，`modelName` 初值是 null ⇒ 不给就不发', async () => {
    const { calls, cap } = build()
    await cap.listModels()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/manager/aiModelConfig/getByPage?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>',
    )
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    expect(String(calls[0]?.url)).not.toContain('modelName=')
    expect(calls[0]?.method).toBe('get')
  })

  it('模型列表：modelName 传值后排在 pageNo **之前**（表单字段插在 order 之后）', async () => {
    const { calls, cap } = build()
    await cap.listModels({ modelName: '蛋鸡', pageNo: 2, pageSize: 50 })
    const url = String(calls[0]?.url)
    expect(keysOf(url)).toEqual(['order', 'orderField', 'modelName', 'pageNo', 'pageSize', '_t'])
    expect(url).toContain('modelName=' + encodeURIComponent('蛋鸡'))
    expect(url).toContain('pageNo=2&pageSize=50')
  })

  it('模型列表：`modelName: ""` 会照发（空串不是 null，qs 的 skipNulls 只丢 null）', async () => {
    const { calls, cap } = build()
    await cap.listModels({ modelName: '' })
    expect(String(calls[0]?.url)).toContain('modelName=&pageNo=1')
  })

  it('模型选择：`callTypeList` 空数组 ⇒ 整项不发；有值 ⇒ 逗号连接（qs 会把逗号编码）', async () => {
    const { calls, cap } = build()
    await cap.listModelSelections()
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    await cap.listModelSelections({ callTypeList: [1, 2] })
    const url = String(calls[1]?.url)
    expect(keysOf(url)).toEqual(['order', 'orderField', 'callTypeList', 'pageNo', 'pageSize', '_t'])
    expect(url).toContain('callTypeList=' + encodeURIComponent('1,2'))
  })

  it('详情与删除走**路径变量**（模型的 delete 不是 `?id=`）', async () => {
    const { calls, cap } = build()
    await cap.getModel(9)
    await cap.deleteModel(9)
    // GET 即使没有业务参数也带 `_t`（platform.js:31 无条件加）
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/aiModelConfig/get/9?_t=<ts>')
    expect(calls[0]?.method).toBe('get')
    // DELETE 走路径变量、且**没有** `_t`（platform.js 只给 GET 加）
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/aiModelConfig/delete/9')
    expect(String(calls[1]?.url)).not.toContain('_t=')
    expect(calls[1]?.method).toBe('delete')
    expect(calls[1]?.params).toBeUndefined()
  })

  it('`/admin-api/ai-token/*` 不会被**补第二次**前缀（已带的透传）', async () => {
    const { calls, cap } = build()
    await cap.getPendingApplyCount()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ai-token/apply/pending-count?statisticsDimension=3&_t=<ts>',
    )
    await cap.getQuotaRule(5)
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/ai-token/quota-rule/get?id=5&_t=<ts>')
  })

  it('规则的删除是 `DELETE` + **`?id=`**（`@RequestParam`，与模型的路径变量不同）', async () => {
    const { calls, cap } = build()
    await cap.deleteQuotaRule(11)
    await cap.deleteFlowRule(12)
    expect(calls[0]?.method).toBe('delete')
    expect(calls[1]?.method).toBe('delete')
    // ⚠️ DELETE 不走 platform.js 的 qs 拦截器（那段只在 GET 上生效），
    //    所以 `id` 留在 axios 的 `params` 上由适配器序列化 —— 这里断言的是 **params**，
    //    不是 URL（假适配器不做 buildURL，URL 上没有 query 是正常的）
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/quota-rule/delete')
    expect(calls[0]?.params).toEqual({ id: 11 })
    expect(calls[1]?.params).toEqual({ id: 12 })
    expect(deleteQueryOf(String(calls[0]?.url))).toBe('')
  })

  it('额度规则列表：键序 modelId → ruleScope → pageNo → pageSize（**没有** order/orderField）', async () => {
    const { calls, cap } = build()
    await cap.listQuotaRules({ modelId: 100, ruleScope: RULE_SCOPE.tenant })
    expect(keysOf(String(calls[0]?.url))).toEqual(['modelId', 'ruleScope', 'pageNo', 'pageSize', '_t'])
    // ⚠️ `cleanQuery` 会按调用方的键序重建对象，列表模块那两个默认参数**活不下来**
    expect(String(calls[0]?.url)).not.toContain('order=')
  })

  it('流速规则列表：键序 modelId → ruleScope → pageNo → pageSize（页面同样不带 order）', async () => {
    const { calls, cap } = build()
    await cap.listFlowRules({ modelId: 100, ruleScope: RULE_SCOPE.general })
    expect(keysOf(String(calls[0]?.url))).toEqual(['modelId', 'ruleScope', 'pageNo', 'pageSize', '_t'])
  })

  it('调整历史：额度与流速**同一个端点**，靠 configType 区分（排在 pageNo 之前）', async () => {
    const { calls, cap } = build()
    await cap.listRuleHistory({ modelId: 100, ruleScope: RULE_SCOPE.tenant, targetId: 7, configType: HISTORY_CONFIG_TYPE.quota })
    await cap.listRuleHistory({ modelId: 100, ruleScope: RULE_SCOPE.general, configType: HISTORY_CONFIG_TYPE.flow })
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ai-token/history/page?modelId=100&ruleScope=2&targetId=7&configType=1&pageNo=1&pageSize=20&_t=<ts>',
    )
    // targetId 不给就整项不发（通用档传的是 memberLevel，没选就不发）
    expect(normalize(String(calls[1]?.url))).toBe(
      '/admin-api/ai-token/history/page?modelId=100&ruleScope=1&configType=2&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('申请记录：statisticsDimension 固定 **3**，页面那个申请列表的初值全是空 ⇒ 只剩它 + 分页', async () => {
    const { calls, cap } = build()
    await cap.listApplyRecords()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ai-token/apply/page?statisticsDimension=3&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('申请记录的日期区间补成 00:00:00 / 23:59:59', async () => {
    const { calls, cap } = build()
    await cap.listApplyRecords({ startDate: '2026-09-01', endDate: '2026-09-21' })
    const url = String(calls[0]?.url)
    expect(url).toContain('startDate=' + encodeURIComponent('2026-09-01 00:00:00'))
    expect(url).toContain('endDate=' + encodeURIComponent('2026-09-21 23:59:59'))
  })

  it('搜人员：参数名是页面的 `userName`（不是 keyword），分页默认 20', async () => {
    const { calls, cap } = build()
    await cap.searchUsers({ keyword: '张三' })
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ops/user/userSearch?userName=' + encodeURIComponent('张三') + '&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('搜人员：无关键字**当场拒绝**，不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.searchUsers({ keyword: '   ' })).rejects.toThrow(/必填|关键字/)
    await expect(cap.searchUsers({} as never)).rejects.toThrow(/必填|关键字/)
    expect(calls).toHaveLength(0)
  })

  it('平台额度：quotaCycle 初值默认 **3（月）**，modelName 空串会被 cleanQuery 丢掉', async () => {
    const { calls, cap } = build()
    await cap.listPlatformQuota()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ai-token/quota-usage/page?quotaCycle=3&statisticsDimension=3&pageNo=1&pageSize=20&_t=<ts>',
    )
    // 汇总走同一份参数构造器，但**不带分页**
    await cap.getPlatformQuotaSummary()
    expect(normalize(String(calls[1]?.url))).toBe(
      '/admin-api/ai-token/quota-usage/summary?quotaCycle=3&statisticsDimension=3&_t=<ts>',
    )
  })

  it('平台明细：quotaCycle 初值是 **2（周）**，与额度 Tab 的月**不同**', async () => {
    const { calls, cap } = build()
    await cap.listPlatformUsageRecords()
    expect(normalize(String(calls[0]?.url))).toBe(
      '/admin-api/ai-token/usage/page?quotaCycle=2&timeRangeType=2&statisticsDimension=3&pageNo=1&pageSize=20&_t=<ts>',
    )
  })

  it('平台明细：`YYYY-MM-DD` 的区间自动补时分秒（闭区间，不是 +1 天）', async () => {
    const { calls, cap } = build()
    await cap.listPlatformUsageRecords({ startTime: '2026-09-01', endTime: '2026-09-21' })
    const url = String(calls[0]?.url)
    expect(url).toContain('startTime=' + encodeURIComponent('2026-09-01 00:00:00'))
    expect(url).toContain('endTime=' + encodeURIComponent('2026-09-21 23:59:59'))
    // startTime/endTime 排在 timeRangeType 之后、requestId 之前
    expect(keysOf(url).slice(0, 5)).toEqual(['quotaCycle', 'timeRangeType', 'statisticsDimension', 'startTime', 'endTime'])
  })

  it('平台明细：带时间的串原样过（不再补一次时分秒）', async () => {
    const { calls, cap } = build()
    await cap.listPlatformUsageRecords({ startTime: '2026-09-01 08:30:00' })
    expect(String(calls[0]?.url)).toContain('startTime=' + encodeURIComponent('2026-09-01 08:30:00'))
  })

  it('数据分析六条 GET 的路径逐条对（都在 `/admin-api` 之下）', async () => {
    const { calls, cap } = build()
    await cap.dataAnalysisOverview()
    expect(calls).toHaveLength(6)
    const urls = calls.map((call) => normalize(String(call.url)))
    expect(urls).toEqual([
      `/admin-api${AI_ANALYSIS_PATHS.answerRightRate}?_t=<ts>`,
      `/admin-api${AI_ANALYSIS_PATHS.statsByTime}?_t=<ts>`,
      `/admin-api${AI_ANALYSIS_PATHS.knowledgeRecordRank}?_t=<ts>`,
      `/admin-api${AI_ANALYSIS_PATHS.aiToolRecordRank}?_t=<ts>`,
      `/admin-api${AI_ANALYSIS_PATHS.aiToolClickRank}?_t=<ts>`,
      `/admin-api${AI_ANALYSIS_PATHS.questionKeywordHeat}?_t=<ts>`,
    ])
    for (const call of calls) expect(call.method).toBe('get')
  })

  it('数据分析：不给区间时 startTime/endTime **整项不发**（页面初值 null）', async () => {
    const { calls, cap } = build()
    await cap.dataAnalysisOverview()
    for (const call of calls) {
      expect(String(call.url)).not.toContain('startTime=')
      expect(String(call.url)).not.toContain('endTime=')
      expect(keysOf(String(call.url))).toEqual(['_t'])
    }
  })

  it('数据分析：给了区间就照发（`YYYY-MM-DD`，页面不做补时分秒）', async () => {
    const { calls, cap } = build()
    await cap.dataAnalysisOverview({ startTime: '2026-09-01', endTime: '2026-09-21' })
    for (const call of calls) {
      const url = String(call.url)
      expect(url).toContain('startTime=2026-09-01')
      expect(url).toContain('endTime=2026-09-21')
      expect(url).not.toContain('00%3A00%3A00')
      expect(keysOf(url)).toEqual(['startTime', 'endTime', '_t'])
    }
  })

  it('模型选择的详情/删除同样是路径变量', async () => {
    const { calls, cap } = build()
    await cap.getModelSelection(3)
    await cap.deleteModelSelection(3)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/aiModelSelection/get/3?_t=<ts>')
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/aiModelSelection/delete/3')
    expect(calls[1]?.params).toBeUndefined()
  })

  it('返回值原样透传 `{list, total}`（不做字段裁剪）', async () => {
    const { cap } = build(() => ({ list: [{ id: 7, modelName: 'SDK-TEST' }], total: 42 }))
    const page = await cap.listModels()
    expect(page.total).toBe(42)
    expect(page.list).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C. 请求头与实例
// ---------------------------------------------------------------------------

describe('C. 这四个页面**不发** module-type（conventions 第 2 条 / D34）', () => {
  /**
   * ⚠️ 这里**不能**写成 `规则表 JSON.includes(pagePath)` —— 规则表存的是**前缀**
   * （`{kind:'prefix', prefixes:['/dashboard/statistics/', …]}`），不是整条页面路径，
   * 所以那种写法对任何一页都恒为 false（**恒真断言**，conventions 第 22 条点名的假测试）。
   * 判据是真正的推导函数 `resolveModuleType()`。
   */
  it('四页在规则表里都**匹配不到** ⇒ 推导结果是 moduleType:null（与浏览器一致）', () => {
    for (const pagePath of [
      AI_MODEL_LIST_PAGE_PATH,
      AI_MODEL_SELECT_PAGE_PATH,
      AI_PLATFORM_USAGE_PAGE_PATH,
      AI_DATA_ANALYSIS_PAGE_PATH,
    ]) {
      const resolution = resolveModuleType(pagePath)
      expect(resolution.moduleType, `${pagePath} 竟然推出了 module-type`).toBeNull()
      expect(resolution.matchedBy, pagePath).toBe('none')
    }
  })

  it('对照：同一函数对**在**规则表里的页面是会命中的（免得上面那条恒真）', () => {
    // `/dashboard/statistics/` 是 12（学习管理）那条前缀规则
    const hit = resolveModuleType('/dashboard/statistics/learning/list')
    expect(hit.matchedBy).toBe('rule')
    expect(hit.moduleType).toBe(12)
    // 而且四页里至少有一页的**前缀**与它相邻（`/dashboard/platform/...`），证明确实在做前缀比较
    expect(resolveModuleType('/dashboard/platform/intelligence/interaction/model/list').matchedBy).toBe('none')
  })

  it('实际发出的请求上没有 moduleType，头上也没有 module-type', async () => {
    const { calls, cap } = build()
    await cap.listModels()
    await cap.listModelSelections()
    await cap.listPlatformQuota()
    await cap.dataAnalysisOverview()
    expect(calls.length).toBeGreaterThanOrEqual(9)
    for (const call of calls) {
      expect(call.moduleType).toBeUndefined()
      expect((call.headers as unknown as Record<string, unknown>)['module-type']).toBeUndefined()
    }
  })

  it('四页的实例解析结果都是 platform（**匹配不到页面规则 ⇒ 全局默认**）', () => {
    for (const pagePath of [
      AI_MODEL_LIST_PAGE_PATH,
      AI_MODEL_SELECT_PAGE_PATH,
      AI_PLATFORM_USAGE_PAGE_PATH,
      AI_DATA_ANALYSIS_PAGE_PATH,
    ]) {
      const resolution = resolveHttpInstance({ pagePath })
      expect(resolution.kind, pagePath).toBe('resolved')
      if (resolution.kind !== 'resolved') return
      expect(resolution.instance.id, pagePath).toBe('platform')
      // ⚠️ 这几页**不在** HTTP_INSTANCE_PAGE_RULES 里：
      //   - 模型列表/模型选择/数据分析在调用点上直接 import platform.js
      //   - 平台用量连 http 字样都没有，靠 composable 里 `useListPageModule` 的全局默认
      // 两者都归到 global-default 这一档（与显式传默认实例字节相同）
      expect(resolution.matchedBy, pagePath).toBe('global-default')
    }
  })

  it('实际发出的请求也确实是那个实例的画像（urlRewrite 补 `/admin-api`、分页名 pageSize）', async () => {
    const { calls, cap } = build()
    await cap.listModels()
    await cap.listModelSelections()
    await cap.listPlatformQuota()
    await cap.dataAnalysisOverview()
    expect(calls.length).toBeGreaterThanOrEqual(9)
    for (const call of calls) {
      // 补前缀只发生在 platform 这一档；sale 那一档会原样发出
      expect(String(call.url).startsWith('/admin-api/'), String(call.url)).toBe(true)
      expect(String(call.url)).not.toContain('limit=') // 只有 sale.js 改分页名
    }
  })
})

// ---------------------------------------------------------------------------
// D. 写链路
// ---------------------------------------------------------------------------

describe('D. 写链路：method / URL / body 逐字节，且 prepare 与 submit 是同一份载荷', () => {
  it('模型新建：`add` + body 八键，**第一个键是 `id:null`**（lodash pick 保留 null）', async () => {
    const { calls, cap } = build()
    const draft = {
      modelName: 'SDK-TEST-模型',
      description: 'SDK-TEST',
      apiUrl: 'https://example.com/v1/chat/completions',
      apiKey: 'sk-test',
      temperature: 0.7,
      timeout: 30,
      maxToken: 4096,
    }
    const prepared = await cap.prepareSaveModel(draft)
    expect(prepared.mode).toBe('create')
    expect(prepared.current).toBeNull()
    expect(prepared.warnings).toEqual([])
    expect(Object.keys(prepared.payload)).toEqual([
      'id', 'modelName', 'description', 'apiUrl', 'apiKey', 'temperature', 'timeout', 'maxToken',
    ])
    expect(prepared.payload.id).toBeNull()

    await cap.saveModel(draft)
    const write = calls.at(-1)
    expect(write?.method).toBe('post')
    expect(normalize(String(write?.url))).toBe('/admin-api/manager/aiModelConfig/add')
    expect(bodyKeys(write)).toEqual(Object.keys(prepared.payload))
    expect(bodyOf(write)).toBe(JSON.stringify(prepared.payload))
  })

  it('模型修改：`update` + body 带 id；`dropApiKey` 让 **apiKey 这个键消失**，其余键序不变', async () => {
    const { calls, cap } = build()
    await cap.saveModel({
      id: 12,
      modelName: 'SDK-TEST-模型',
      description: 'SDK-TEST',
      apiUrl: 'https://example.com/v1/chat/completions',
      dropApiKey: true,
      temperature: null,
      timeout: null,
      maxToken: null,
    })
    const write = calls.at(-1)
    expect(normalize(String(write?.url))).toBe('/admin-api/manager/aiModelConfig/update')
    expect(bodyKeys(write)).toEqual(['id', 'modelName', 'description', 'apiUrl', 'temperature', 'timeout', 'maxToken'])
    expect(bodyOf(write)).not.toContain('apiKey')
  })

  it('模型新建：prepare 会把 `apiUrl` 不以 /chat/completions 结尾**提示出来**，但不硬拦', async () => {
    const { calls, cap } = build()
    const prepared = await cap.prepareSaveModel({
      modelName: 'SDK-TEST-模型',
      description: 'SDK-TEST',
      apiUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
    })
    expect(prepared.warnings.join('\n')).toMatch(/chat\/completions/)
    expect(calls).toHaveLength(0) // prepare 全程没发请求（新建时没有前置读）
    await cap.saveModel({
      modelName: 'SDK-TEST-模型',
      description: 'SDK-TEST',
      apiUrl: 'https://example.com/v1',
      apiKey: 'sk-test',
    })
    expect(calls).toHaveLength(1)
  })

  it('模型修改：prepare 会先**读一次**详情（conventions 第 13 条的只读前置）', async () => {
    const { calls, cap } = build(() => ({ id: 12, modelName: '旧名', description: '旧', apiUrl: 'https://x/v1/chat/completions' }))
    const prepared = await cap.prepareSaveModel({
      id: 12,
      modelName: '新名',
      description: '新',
      apiUrl: 'https://x/v1/chat/completions',
      dropApiKey: true,
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method).toBe('get')
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/aiModelConfig/get/12?_t=<ts>')
    expect(prepared.mode).toBe('update')
    expect(prepared.current?.modelName).toBe('旧名')
    // 编辑态不重输 apiKey 时，页面会给一条提醒（免得以为"这次也改了 apiKey"）
    expect(prepared.warnings.join('\n')).toMatch(/apiKey/)
  })

  it('模型测试：**两个调用点的键序不同**，所以是两个方法', async () => {
    const { calls, cap } = build()
    await cap.testModelConnectivity({ id: 5, modelName: 'm', apiUrl: 'u', apiKey: 'k' })
    await cap.testModelConnectivityFromForm({ modelName: 'm', apiUrl: 'u', apiKey: 'k' })
    await cap.testModelConnectivityFromForm({ id: 5, modelName: 'm', apiUrl: 'u', apiKey: 'k' })
    expect(calls.map((c) => normalize(String(c.url)))).toEqual([
      '/admin-api/manager/aiModelConfig/test',
      '/admin-api/manager/aiModelConfig/test',
      '/admin-api/manager/aiModelConfig/test',
    ])
    // 列表页那一支：id 在最前
    expect(bodyKeys(calls[0])).toEqual(['id', 'modelName', 'apiUrl', 'apiKey'])
    // 编辑页那一支：没有 id 时**整个键不出现**
    expect(bodyKeys(calls[1])).toEqual(['modelName', 'apiUrl', 'apiKey'])
    // 编辑页那一支：有 id 时追加在**最后**
    expect(bodyKeys(calls[2])).toEqual(['modelName', 'apiUrl', 'apiKey', 'id'])
  })

  it('模型测试是 POST 但没有落库语义 ⇒ write:false（能力定义侧）', () => {
    expect(aiModelCapabilities.find((c) => c.id === 'ai-model-test')?.write).toBe(false)
  })

  it('额度规则新建 POST / update **也是 POST**（与流速规则不同）', async () => {
    const { calls, cap } = build()
    await cap.saveQuotaRule(QUOTA_RULE_DRAFT)
    await cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, id: 3 })
    expect(calls[0]?.method).toBe('post')
    expect(calls[1]?.method).toBe('post')
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/quota-rule/create')
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/ai-token/quota-rule/update')
    // 只有租户档才发 targetTenantId/targetTenantName（个人档才发 targetUserPhone 那一组）
    expect(bodyKeys(calls[0])).toEqual([
      'modelId', 'ruleScope', 'targetTenantId', 'targetTenantName', 'totalQuota',
      'quotaCheckEnabled', 'carryOverRule', 'resetCycle', 'shortageStrategy', 'startTime', 'endTime',
      'reason', 'enabled',
    ])
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toMatchObject({
      modelId: 100,
      ruleScope: 2,
      targetTenantId: 7,
      // 没给 quotaCheckEnabled ⇒ **默认 true**（`!== false`），enabled 页面写死 true
      quotaCheckEnabled: true,
      enabled: true,
      totalQuota: 100000,
    })
  })

  it('额度规则：个人档不发租户字段、通用档只发 memberLevel', async () => {
    const { calls, cap } = build()
    await cap.saveQuotaRule({
      ...QUOTA_RULE_DRAFT,
      ruleScope: RULE_SCOPE.personal,
      targetTenantId: undefined,
      targetTenantName: undefined,
      targetUserPhone: '13800138000',
      targetUserName: '张三',
      targetUserTypeName: 'HR同步',
    })
    await cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, ruleScope: RULE_SCOPE.general, targetTenantId: undefined, targetTenantName: undefined, memberLevel: 3 })
    expect(bodyKeys(calls[0])).toEqual([
      'modelId', 'ruleScope', 'targetUserPhone', 'targetUserName', 'targetUserTypeName', 'totalQuota',
      'quotaCheckEnabled', 'carryOverRule', 'resetCycle', 'shortageStrategy', 'startTime', 'endTime',
      'reason', 'enabled',
    ])
    expect(bodyKeys(calls[1])).toEqual([
      'modelId', 'ruleScope', 'memberLevel', 'totalQuota',
      'quotaCheckEnabled', 'carryOverRule', 'resetCycle', 'shortageStrategy', 'startTime', 'endTime',
      'reason', 'enabled',
    ])
  })

  it('流速规则新建 POST、修改 **PUT**（后端 @PutMapping，别顺手统一成 POST）', async () => {
    const { calls, cap } = build()
    await cap.saveFlowRule(FLOW_RULE_DRAFT)
    await cap.saveFlowRule({ ...FLOW_RULE_DRAFT, id: 8 })
    expect(calls[0]?.method).toBe('post')
    expect(calls[1]?.method).toBe('put')
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/flow-rule/create')
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/ai-token/flow-rule/update')
    expect(bodyKeys(calls[0])).toEqual([
      'modelId', 'ruleScope', 'memberLevel', 'flowCheckEnabled', 'tokenLimitPerMinute',
      'maxTokenPerRequest', 'exceedStrategy', 'startTime', 'reason', 'enabled',
    ])
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toMatchObject({
      ruleScope: 1,
      memberLevel: 3,
      flowCheckEnabled: true,
      tokenLimitPerMinute: 60000,
      maxTokenPerRequest: 8192,
      exceedStrategy: 1,
      enabled: true,
    })
  })

  it('额度规则的改前读一次（prepare）与提交共用同一份载荷', async () => {
    const previous = {
      id: 3,
      modelId: 100,
      ruleScope: RULE_SCOPE.tenant,
      targetTenantId: 7,
      targetTenantName: '测试租户',
      totalQuota: 500,
      carryOverRule: 1,
      resetCycle: 3,
      shortageStrategy: 1,
      startTime: '2026-06-01 00:00:00',
      enabled: true,
    }
    const { calls, cap } = build(() => previous)
    const prepared = await cap.prepareSaveQuotaRule({
      id: 3,
      modelId: 100,
      ruleScope: RULE_SCOPE.tenant,
      targetTenantId: 7,
      targetTenantName: '测试租户',
      totalQuota: 900,
      carryOverRule: 1,
      resetCycle: 3,
      shortageStrategy: 1,
      startTime: '2026-06-01 00:00:00',
    })
    expect(prepared.mode).toBe('update')
    expect(prepared.current).toEqual(previous)
    await cap.saveQuotaRule({
      id: 3,
      modelId: 100,
      ruleScope: RULE_SCOPE.tenant,
      targetTenantId: 7,
      targetTenantName: '测试租户',
      totalQuota: 900,
      carryOverRule: 1,
      resetCycle: 3,
      shortageStrategy: 1,
      startTime: '2026-06-01 00:00:00',
    })
    expect(bodyOf(calls.at(-1))).toBe(JSON.stringify(prepared.payload))
  })

  it('撤销"新建规则"= 用 create 返回的 id 直接删；撤销"改规则"= 用旧行再 update/PUT 一次', async () => {
    const { calls, cap } = build()
    await cap.cancelCreatedQuotaRule(77)
    await cap.cancelCreatedFlowRule(78)
    expect(calls[0]?.method).toBe('delete')
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/quota-rule/delete')
    expect(calls[0]?.params).toEqual({ id: 77 })
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/ai-token/flow-rule/delete')
    expect(calls[1]?.params).toEqual({ id: 78 })

    const previousRule = {
      id: 3,
      modelId: 100,
      ruleScope: RULE_SCOPE.general,
      memberLevel: 3,
      flowCheckEnabled: true,
      tokenLimitPerMinute: 1000,
      maxTokenPerRequest: 100,
      exceedStrategy: 2,
      startTime: '2026-06-01 00:00:00',
      enabled: true,
    }
    await cap.restoreFlowRule(previousRule)
    const restore = calls.at(-1)
    expect(restore?.method).toBe('put') // 流速的撤销也走 PUT
    expect(normalize(String(restore?.url))).toBe('/admin-api/ai-token/flow-rule/update')
    expect(restore && JSON.parse(bodyOf(restore))).toMatchObject({ id: 3, tokenLimitPerMinute: 1000, exceedStrategy: 2 })
  })

  it('撤销"新建模型"：`add` 不返回 id ⇒ 按名字回查；查到多条**拒绝而不是猜**', async () => {
    const { calls, cap } = build(() => ({
      list: [{ id: 900, modelName: 'SDK-TEST-唯一' }],
      total: 1,
    }))
    await cap.cancelCreatedModel('SDK-TEST-唯一')
    expect(calls[0]?.method).toBe('get')
    expect(String(calls[0]?.url)).toContain('modelName=' + encodeURIComponent('SDK-TEST-唯一'))
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/aiModelConfig/delete/900')

    const dup = build(() => ({
      list: [{ id: 1, modelName: 'SDK-TEST-重名' }, { id: 2, modelName: 'SDK-TEST-重名' }],
      total: 2,
    }))
    await expect(dup.cap.cancelCreatedModel('SDK-TEST-重名')).rejects.toThrow(/不猜|两条|2 个/)
    // 只发了那一笔回查，**没有**发删除
    expect(dup.calls).toHaveLength(1)
  })

  it('撤销"新建模型"：回查不到时明确报错，不盲目再建一个', async () => {
    const { cap } = build(() => ({ list: [], total: 0 }))
    await expect(cap.cancelCreatedModel('SDK-TEST-没了')).rejects.toThrow(/回查不到/)
  })

  it('模型选择的写：body 键序 callType → details →（有 id）id →（callType=2）skillIds', async () => {
    const { calls, cap } = build()
    await cap.saveModelSelection({
      callType: CALL_TYPE.web,
      details: [{ code: 'model', modelId: 11, isDefault: 1 }, { code: 'model', modelId: 12, isDefault: 0 }],
      skillIds: [3, 4],
    })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/manager/aiModelSelection/add')
    expect(bodyKeys(calls[0])).toEqual(['callType', 'details', 'skillIds'])
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toEqual({
      callType: 2,
      details: [
        { code: 'model', modelId: 11, isDefault: 1 },
        { code: 'model', modelId: 12, isDefault: 0 },
      ],
      skillIds: '3,4',
    })
  })

  it('模型选择：非 2 档**不发** skillIds；有 id 时 id 夹在 details 与 skillIds 之间', async () => {
    const { calls, cap } = build()
    await cap.saveModelSelection({ callType: CALL_TYPE.backend, details: [] })
    expect(bodyKeys(calls[0])).toEqual(['callType', 'details'])
    await cap.saveModelSelection({ id: 6, callType: CALL_TYPE.web, details: [], skillIds: '3' })
    expect(bodyKeys(calls[1])).toEqual(['callType', 'details', 'id', 'skillIds'])
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/aiModelSelection/update')
  })

  it('模型选择：callType=2 且 skillIds 空 ⇒ prepare 给出**后端会拒**的提醒，但不硬拦', async () => {
    const { calls, cap } = build()
    const prepared = await cap.prepareSaveModelSelection({ callType: CALL_TYPE.web, details: [] })
    expect(prepared.mode).toBe('create')
    expect(prepared.warnings.join('\n')).toMatch(/skillIds/)
    expect(calls).toHaveLength(0)
  })

  it('撤销"新建模型选择"：按 callType 回查（**后端保证唯一**），查到一条就删', async () => {
    const { calls, cap } = build(() => ({ list: [{ id: 55, callType: 3 }], total: 1 }))
    await cap.cancelCreatedModelSelection(CALL_TYPE.backend)
    expect(String(calls[0]?.url)).toContain('callTypeList=3')
    expect(normalize(String(calls[1]?.url))).toBe('/admin-api/manager/aiModelSelection/delete/55')
  })

  it('处理申请：body 键序 id → status → statisticsDimension', async () => {
    const { calls, cap } = build()
    const prepared = cap.prepareHandleApply({ id: 21, status: APPLY_STATUS.pending }, APPLY_STATUS.ignored)
    expect(prepared.previousStatus).toBe(APPLY_STATUS.pending)
    expect(Object.keys(prepared.payload)).toEqual(['id', 'status', 'statisticsDimension'])
    await cap.handleApply({ id: 21 }, APPLY_STATUS.ignored)
    const write = calls.at(-1)
    expect(write?.method).toBe('post')
    expect(normalize(String(write?.url))).toBe('/admin-api/ai-token/apply/handle')
    expect(bodyOf(write)).toBe(JSON.stringify(prepared.payload))
  })

  it('撤销"处理申请"：用**读到的旧状态**再 handle 一次（不是删）', async () => {
    const { calls, cap } = build()
    await cap.cancelHandledApply(21, APPLY_STATUS.pending)
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/apply/handle')
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toEqual({
      id: 21,
      status: 0,
      statisticsDimension: 3,
    })
  })

  it('一键填写 = **两步真写**：先建规则、再把申请标成已填写（顺序与页面一致）', async () => {
    const { calls, cap } = build(() => 12345)
    const result = await cap.fillApplyWithQuotaRule({
      apply: {
        id: 21,
        status: APPLY_STATUS.pending,
        modelId: 100,
        tenantId: 7,
        tenantName: '测试租户',
        expectedMonthlyQuota: 5000,
        reason: 'SDK-TEST-申请',
      },
      form: { resetCycle: 3, shortageStrategy: 1, startTime: '2026-06-01 00:00:00' },
    })
    expect(result.createdRuleId).toBe(12345)
    expect(calls.map((c) => normalize(String(c.url)))).toEqual([
      '/admin-api/ai-token/quota-rule/create',
      '/admin-api/ai-token/apply/handle',
    ])
    // 「一键填写」那条链路的 body 与「额度管理」弹窗那份**不是同一个构造器**：
    // `ruleScope` 来自 `getRuleTarget(apply)`、**没有** id/memberLevel/quotaCheckEnabled/carryOverRule
    expect(bodyKeys(calls[0])).toEqual(['modelId', 'ruleScope', 'targetTenantId', 'targetTenantName', 'totalQuota', 'resetCycle', 'shortageStrategy', 'startTime', 'reason', 'enabled'])
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toMatchObject({ modelId: 100, ruleScope: 2, targetTenantId: 7, totalQuota: 5000, enabled: true })
    expect(calls[1] && JSON.parse(bodyOf(calls[1]))).toMatchObject({ id: 21, status: APPLY_STATUS.filled })
  })

  it('一键填写（流速）：落的是流速规则，maxToken 取申请的期望词元', async () => {
    const { calls, cap } = build(() => 999)
    const result = await cap.fillApplyWithFlowRule({
      apply: { id: 22, modelId: 100, userId: 5, userName: '张三', expectedMaxToken: 4096, reason: 'SDK-TEST' },
      form: { tokenLimitPerMinute: 60000, exceedStrategy: 1, startTime: '2026-06-01 00:00:00' },
    })
    expect(normalize(String(calls[0]?.url))).toBe('/admin-api/ai-token/flow-rule/create')
    expect(calls[0] && JSON.parse(bodyOf(calls[0]))).toMatchObject({
      modelId: 100,
      ruleScope: 3,
      targetUserId: 5,
      targetUserName: '张三',
      maxTokenPerRequest: 4096,
      tokenLimitPerMinute: 60000,
    })
    expect(bodyKeys(calls[0])).toEqual(['modelId', 'ruleScope', 'targetUserId', 'targetUserName', 'tokenLimitPerMinute', 'maxTokenPerRequest', 'exceedStrategy', 'startTime', 'reason', 'enabled'])
    // ⚠️ 个人档这条发的是 `targetUserId`，后端 SaveReqVO 里**没有这个字段** ⇒ 必须提示
    expect(result.warnings.join('\n')).toMatch(/targetUserId/)
  })

  it('一键填写（租户档）**不**触发 targetUserId 那条提醒（那条链路后端认 targetTenantId）', async () => {
    const { cap } = build(() => 1)
    const result = await cap.fillApplyWithQuotaRule({
      apply: { id: 21, modelId: 100, tenantId: 7, tenantName: 'T', expectedMonthlyQuota: 500 },
      form: { resetCycle: 3, shortageStrategy: 1, startTime: '2026-06-01 00:00:00' },
    })
    expect(result.warnings).toEqual([])
  })

  it('`skipApplyStatus` 只建规则、不动申请（撤销时能少一步）', async () => {
    const { calls, cap } = build(() => 1)
    const result = await cap.fillApplyWithQuotaRule({
      apply: { id: 21, modelId: 100, tenantId: 7, expectedMonthlyQuota: 500 },
      form: { resetCycle: 3, shortageStrategy: 1, startTime: '2026-06-01 00:00:00' },
      skipApplyStatus: true,
    })
    expect(result.applyHandled).toBeNull()
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// E. 本地校验（对齐后端 @NotNull / @Positive 与页面表单规则）
// ---------------------------------------------------------------------------

describe('E. 本地校验：参数错时不发请求', () => {
  it('模型新建缺 modelName/description/apiUrl/apiKey 中任何一个都当场拒绝', async () => {
    const { calls, cap } = build()
    const good = {
      modelName: 'm',
      description: 'd',
      apiUrl: 'https://x/v1/chat/completions',
      apiKey: 'k',
    }
    await expect(cap.saveModel({ ...good, modelName: '  ' })).rejects.toThrow(/modelName/)
    await expect(cap.saveModel({ ...good, description: '' })).rejects.toThrow(/description/)
    await expect(cap.saveModel({ ...good, apiUrl: undefined as never })).rejects.toThrow(/apiUrl/)
    await expect(cap.saveModel({ ...good, apiKey: '' })).rejects.toThrow(/apiKey/)
    expect(calls).toHaveLength(0)
  })

  it('`dropApiKey` 时**不再要求** apiKey（页面编辑态不重输就是这个行为）', async () => {
    const { calls, cap } = build()
    await cap.saveModel({
      id: 1,
      modelName: 'm',
      description: 'd',
      apiUrl: 'https://x/v1/chat/completions',
      dropApiKey: true,
    })
    expect(calls).toHaveLength(1)
  })

  it('规则草稿缺 modelId / ruleScope / startTime 或额度非正数都当场拒绝', async () => {
    const { calls, cap } = build()
    await expect(cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, modelId: undefined as never })).rejects.toThrow(/modelId/)
    await expect(cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, ruleScope: 9 })).rejects.toThrow(/ruleScope/)
    await expect(cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, startTime: '' })).rejects.toThrow(/startTime/)
    await expect(cap.saveQuotaRule({ ...QUOTA_RULE_DRAFT, totalQuota: 0 })).rejects.toThrow(/totalQuota/)
    await expect(cap.saveFlowRule({ ...FLOW_RULE_DRAFT, tokenLimitPerMinute: -1 })).rejects.toThrow(/tokenLimitPerMinute/)
    await expect(cap.saveFlowRule({ ...FLOW_RULE_DRAFT, maxTokenPerRequest: 0 })).rejects.toThrow(/maxTokenPerRequest/)
    expect(calls).toHaveLength(0)
  })

  it('id 为空 / NaN 的读操作也当场拒绝', async () => {
    const { calls, cap } = build()
    await expect(cap.getModel('   ')).rejects.toThrow(/必填/)
    await expect(cap.getModel(Number.NaN)).rejects.toThrow(/数字/)
    await expect(cap.deleteModelSelection(undefined as never)).rejects.toThrow(/必填/)
    await expect(cap.listQuotaRules({ modelId: undefined as never })).rejects.toThrow(/modelId/)
    expect(calls).toHaveLength(0)
  })

  it('校验失败走 **Promise.reject**（不是同步抛），调用方 await 时才接得住', () => {
    const { cap } = build()
    const pending = cap.saveModel({ modelName: '', description: '', apiUrl: '', apiKey: '' })
    expect(pending).toBeInstanceOf(Promise)
    return expect(pending).rejects.toThrow(/modelName/)
  })

  it('能力对象可以被解构（内部实现**不用 `this`**）', async () => {
    const { calls, cap } = build(() => ({ list: [{ id: 900, modelName: 'SDK-TEST-解构' }], total: 1 }))
    const { cancelCreatedModel, getPendingApplyCount, saveModel } = cap
    expect(getPendingApplyCount()).toBeInstanceOf(Promise)
    await cancelCreatedModel('SDK-TEST-解构')
    // 角标 1 + 回查 1 + 删除 1 = 3
    expect(calls).toHaveLength(3)
    // 解构出来的写方法也不会因为丢了 `this` 而炸
    await expect(saveModel({ modelName: '', description: '', apiUrl: '', apiKey: '' })).rejects.toThrow(/modelName/)
  })
})

// ---------------------------------------------------------------------------
// F. 纯函数
// ---------------------------------------------------------------------------

describe('F. 载荷与参数构造是纯函数（prepare 与 submit 共用同一份）', () => {
  it('`cleanQuery` 丢掉 `""` / `null` / `undefined`，保留 `0` 与 `false`', () => {
    expect(cleanQuery({ a: '', b: null, c: undefined, d: 0, e: false, f: '0' })).toEqual({
      d: 0,
      e: false,
      f: '0',
    })
  })

  it('`buildModelListParams` 的键序固定，空值时 `modelName` 是 null（会被 qs 丢掉）', () => {
    expect(buildModelListParams()).toEqual({
      order: '',
      orderField: '',
      modelName: null,
      pageNo: 1,
      pageSize: 20,
    })
    expect(Object.keys(buildModelListParams({ modelName: 'x' }))).toEqual([
      'order', 'orderField', 'modelName', 'pageNo', 'pageSize',
    ])
  })

  it('`buildModelSavePayload` 总是带 `id:null`（页面 pick 出来的形状）', () => {
    const payload = buildModelSavePayload({ modelName: 'm', description: 'd', apiUrl: 'u', apiKey: 'k' })
    expect(Object.keys(payload)).toEqual([
      'id', 'modelName', 'description', 'apiUrl', 'apiKey', 'temperature', 'timeout', 'maxToken',
    ])
    expect(payload).toEqual({
      id: null, modelName: 'm', description: 'd', apiUrl: 'u', apiKey: 'k',
      temperature: null, timeout: null, maxToken: null,
    })
  })

  it('`testResult.status` 为真时**追加** availableStatus + supportedFiles（追加在最后）', () => {
    const payload = buildModelSavePayload({
      id: 3,
      modelName: 'm',
      testResult: { status: 1, supportedFiles: '.pdf,.txt' },
    })
    expect(Object.keys(payload)).toEqual([
      'id', 'modelName', 'description', 'apiUrl', 'apiKey', 'temperature', 'timeout', 'maxToken',
      'availableStatus', 'supportedFiles',
    ])
    expect(payload.availableStatus).toBe(1)
    // `status: 0`（未测试）**不会**追加 —— 页面是 `if (testResult.status)`，0 是假值
    const zero = buildModelSavePayload({ modelName: 'm', testResult: { status: 0 } })
    expect(Object.keys(zero)).not.toContain('availableStatus')
  })

  it('`supportedFiles` 空值时补空串（不是 undefined）', () => {
    const payload = buildModelSavePayload({ modelName: 'm', testResult: { status: 2 } })
    expect(payload.supportedFiles).toBe('')
  })

  it('`buildQuotaRuleSavePayload` 的 `quotaCheckEnabled` 是 `!== false`（不给就是 true）', () => {
    const base = { modelId: 1, ruleScope: 1, totalQuota: 10, resetCycle: 3, shortageStrategy: 1, startTime: 't' }
    expect(buildQuotaRuleSavePayload({ ...base, memberLevel: 1 }).quotaCheckEnabled).toBe(true)
    expect(buildQuotaRuleSavePayload({ ...base, memberLevel: 1, quotaCheckEnabled: false }).quotaCheckEnabled).toBe(false)
    // 通用档才有 memberLevel；租户/个人档的 memberLevel 被整项丢掉
    expect(buildQuotaRuleSavePayload({ ...base, memberLevel: 3 })).not.toHaveProperty('targetTenantId')
    expect(buildQuotaRuleSavePayload({ ...base, ruleScope: 2, targetTenantId: 7, targetTenantName: 'T' })).toMatchObject({
      ruleScope: 2, targetTenantId: 7, targetTenantName: 'T',
    })
  })

  it('`buildFlowRuleSavePayload` **没有** carryOverRule / resetCycle / shortageStrategy', () => {
    const payload = buildFlowRuleSavePayload({
      modelId: 1, ruleScope: 1, memberLevel: 1, tokenLimitPerMinute: 10, maxTokenPerRequest: 5,
      exceedStrategy: 1, startTime: 't',
    })
    expect(payload).not.toHaveProperty('carryOverRule')
    expect(payload).not.toHaveProperty('resetCycle')
    expect(payload).not.toHaveProperty('shortageStrategy')
    expect(payload).toHaveProperty('flowCheckEnabled', true)
  })

  it('`buildModelSelectionSavePayload`：skillIds 数组 join 成逗号串、空数组得到空串', () => {
    expect(buildModelSelectionSavePayload({ callType: 2, skillIds: [] }).skillIds).toBe('')
    expect(buildModelSelectionSavePayload({ callType: 2, skillIds: '3,4' }).skillIds).toBe('3,4')
    expect(buildModelSelectionSavePayload({ callType: 2, skillIds: [3, 4] }).skillIds).toBe('3,4')
    // 非 2 档**不出现**这个键
    expect(buildModelSelectionSavePayload({ callType: 3, skillIds: [3] })).not.toHaveProperty('skillIds')
  })

  it('`buildModelTestBodyFromRow` / `FromForm` 是两份**不同**的形状', () => {
    const row = { id: 5, modelName: 'm', apiUrl: 'u', apiKey: 'k' }
    expect(Object.keys(buildModelTestBodyFromRow(row))).toEqual(['id', 'modelName', 'apiUrl', 'apiKey'])
    expect(Object.keys(buildModelTestBodyFromForm(row))).toEqual(['modelName', 'apiUrl', 'apiKey', 'id'])
    expect(Object.keys(buildModelTestBodyFromForm({ modelName: 'm', apiUrl: 'u' }))).toEqual([
      'modelName', 'apiUrl', 'apiKey',
    ])
  })

  it('`normalizeNumber` 去千分位、非有限值落 undefined', () => {
    expect(normalizeNumber('1,000')).toBe(1000)
    expect(normalizeNumber('')).toBeUndefined()
    expect(normalizeNumber('abc')).toBeUndefined()
    expect(normalizeNumber(0)).toBe(0)
  })

  it('`buildAnalysisParams` 的初值是 null（不是空串）—— 页面的日期区间没选就是 null', () => {
    expect(buildAnalysisParams()).toEqual({ startTime: null, endTime: null })
  })

  it('`buildApplyQuery` 的键序与页面参数表一致（modelId → userName → status → …）', () => {
    expect(Object.keys(buildApplyQuery({ statisticsDimension: 3, pageNo: 1, pageSize: 20 }))).toEqual([
      'statisticsDimension', 'pageNo', 'pageSize',
    ])
  })

  it('`buildUsageRecordQuery` 的键序与 `buildUsageQuery` 一致', () => {
    expect(Object.keys(buildUsageRecordQuery({ modelId: 1 }, 3))).toEqual([
      'statisticsDimension', 'modelId',
    ])
  })
})

// ---------------------------------------------------------------------------
// G. 降级语义
// ---------------------------------------------------------------------------

describe('G. 并发与降级：一路失败不拖垮其余', () => {
  it('数据分析：一条挂了其余五条照回，`errors` 里记下是哪条', async () => {
    const calls: CapturedCall[] = []
    const sdk = createPortalHeadless({
      baseUrl: 'https://biz-api-test.wodecorp.cn',
      credential: { token: 'tk-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = (async (config: InternalAxiosRequestConfig) => {
      calls.push(config as CapturedCall)
      const url = String(config.url)
      if (url.includes('getKnowledgeRecordRank')) {
        return {
          data: { ret: 'FAIL', code: 500, msg: '统计服务不可用', data: null },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      }
      return {
        data: { ret: 'SUCCESS', code: 0, msg: '', data: { ok: url } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }) as never
    const cap = createAiModelCapability(
      (c) => sdk.call(AI_MODEL_LIST_PAGE_PATH, { ...(c as object) } as never),
      (c) => sdk.call(AI_MODEL_SELECT_PAGE_PATH, { ...(c as object) } as never),
      (c) => sdk.call(AI_PLATFORM_USAGE_PAGE_PATH, { ...(c as object) } as never),
      (c) => sdk.call(AI_DATA_ANALYSIS_PAGE_PATH, { ...(c as object) } as never),
    )
    const result = await cap.dataAnalysisOverview({ startTime: '2026-09-01', endTime: '2026-09-21' })
    expect(calls).toHaveLength(6) // 六条都发了
    expect(result.knowledgeRecordRank).toBeNull()
    expect(result.answerRightRate).not.toBeNull()
    expect(Object.keys(result.errors)).toEqual(['knowledgeRecordRank'])
    expect(result.errors.knowledgeRecordRank).toContain('统计服务不可用')
  })

  it('平台用量分析：默认带三张 breakdown，`includeBreakdowns:false` 只发汇总', async () => {
    const { calls, cap } = build()
    await cap.platformUsageAnalytics()
    expect(calls.map((c) => normalize(String(c.url)))).toEqual([
      '/admin-api/ai-token/usage/summary?quotaCycle=2&timeRangeType=2&statisticsDimension=3&_t=<ts>',
      '/admin-api/ai-token/usage/trend?quotaCycle=2&timeRangeType=2&statisticsDimension=3&_t=<ts>',
      '/admin-api/ai-token/usage/model-ratio?quotaCycle=2&timeRangeType=2&statisticsDimension=3&_t=<ts>',
      '/admin-api/ai-token/usage/module-ranking?quotaCycle=2&timeRangeType=2&statisticsDimension=3&_t=<ts>',
    ])
    const before = calls.length
    await cap.platformUsageAnalytics({ modelId: 7 }, { includeBreakdowns: false })
    expect(calls.length - before).toBe(1)
  })

  it('平台用量分析：`modelId` 进**全部四条**（页面的 formState 里就有它，不只趋势那两条）', async () => {
    const { calls, cap } = build()
    await cap.platformUsageAnalytics({ modelId: 7 })
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(String(call.url), String(call.url)).toContain('modelId=7')
    }
    // 四条用的是同一份参数（含 modelId 排位也一致）
    const queries = calls.map((c) => normalize(String(c.url)).split('?')[1])
    expect(new Set(queries).size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// I. 端点常量与枚举取值（打错一个字符就是打错的接口）
// ---------------------------------------------------------------------------

describe('I. 端点常量逐字等于页面源码里的字面量', () => {
  it('模型 / 模型选择那两组**不带** `/admin-api`（由 platform.js 拦截器补）', () => {
    expect(AI_MODEL_PATHS).toEqual({
      page: '/manager/aiModelConfig/getByPage',
      detail: '/manager/aiModelConfig/get',
      availableList: '/manager/aiModelConfig/getAvailableList',
      add: '/manager/aiModelConfig/add',
      update: '/manager/aiModelConfig/update',
      remove: '/manager/aiModelConfig/delete',
      test: '/manager/aiModelConfig/test',
    })
    expect(AI_MODEL_SELECTION_PATHS).toEqual({
      page: '/manager/aiModelSelection/getByPage',
      detail: '/manager/aiModelSelection/get',
      add: '/manager/aiModelSelection/add',
      update: '/manager/aiModelSelection/update',
      remove: '/manager/aiModelSelection/delete',
    })
  })

  it('AI Token 那一组**自带** `/admin-api`（页面里就写着，拦截器不再补）', () => {
    expect(Object.values(AI_TOKEN_PATHS).every((path) => path.startsWith('/admin-api/'))).toBe(true)
    expect(AI_TOKEN_PATHS.quotaRuleUpdate).toBe('/admin-api/ai-token/quota-rule/update')
    expect(AI_TOKEN_PATHS.flowRuleUpdate).toBe('/admin-api/ai-token/flow-rule/update')
    expect(AI_TOKEN_PATHS.historyPage).toBe('/admin-api/ai-token/history/page')
    expect(AI_TOKEN_PATHS.userSearch).toBe('/admin-api/ops/user/userSearch')
    expect(AI_TOKEN_PATHS.tenantPage).toBe('/admin-api/system/tenant/page')
  })

  it('数据分析六条**不带** `/admin-api`，且都在 `/manage/ai` 下', () => {
    expect(Object.values(AI_ANALYSIS_PATHS)).toEqual([
      '/manage/ai/getStatsAnsRightRate',
      '/manage/ai/getStatsByTime',
      '/manage/ai/getKnowledgeRecordRank',
      '/manage/ai/getAiToolRecordRank',
      '/manage/ai/getAiToolClickRank',
      '/manage/ai/getQuestionKeywordHeat',
    ])
  })

  it('枚举取值以后端为准（额度周期 / 统计维度 / 时间范围 / 每页条数）', () => {
    expect(QUOTA_CYCLE).toEqual({ day: 1, week: 2, month: 3 })
    expect(STATISTICS_DIMENSION).toEqual({ personal: 1, enterprise: 2, platform: 3 })
    expect(TIME_RANGE).toEqual({ today: 1, thisMonth: 2, last7Days: 3, last30Days: 4, custom: 5 })
    expect(DEFAULT_PAGE_SIZE).toBe(20)
  })
})

// ---------------------------------------------------------------------------
// J. 与浏览器基准**逐字段**一致（D20 / conventions 第 31 条：基准是判据）
// ---------------------------------------------------------------------------

describe('J. 与 baseline/ai-model.browser.json 逐字段一致（含键顺序）', () => {
  it('基准本身是干净的：23 条、全 GET、**没有任何一条**带 module-type 头', () => {
    expect(BASE.requests).toHaveLength(23)
    expect(BASE.requests.filter((r) => r.method !== 'GET')).toHaveLength(0)
    expect(BASE.requests.filter((r) => 'module-type' in (r.headers ?? {}))).toHaveLength(0)
    // 每页都抓到（4 页各至少一条真请求）
    const pages = new Set(BASE.requests.map((r) => r.pagePath))
    expect(pages.size).toBe(4)
    // 只有测试环境一个 host
    expect(BASE.requests.every((r) => r.url.startsWith('https://biz-api-test.wodecorp.cn/'))).toBe(true)
  })

  it('模型列表：无筛选时的 URL 与基准**逐字段**一致（键顺序与 `_t` 的位置都一样）', async () => {
    const { calls, cap } = build()
    await cap.listModels()
    const base = reqOf(AI_MODEL_LIST_PAGE_PATH, /aiModelConfig\/getByPage/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('模型列表：基准证实 `modelName` 初值 null **真的被丢掉**（本文件先前是推导）', () => {
    const base = reqOf(AI_MODEL_LIST_PAGE_PATH, /aiModelConfig\/getByPage/)
    expect(keysOf(base.url)).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    expect(base.url).not.toContain('modelName')
  })

  it('模型选择：无筛选时的 URL 与基准逐字段一致；`callTypeList` 空**真的不发**', async () => {
    const { calls, cap } = build()
    await cap.listModelSelections()
    const base = reqOf(AI_MODEL_SELECT_PAGE_PATH, /aiModelSelection\/getByPage/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(keysOf(base.url)).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
  })

  it('平台用量：**额度明细**与**汇总**两条都与基准逐字段一致（quotaCycle 默认 3 得到证实）', async () => {
    const { calls, cap } = build()
    await cap.listPlatformQuota()
    await cap.getPlatformQuotaSummary()
    const pageBase = reqOf(AI_PLATFORM_USAGE_PAGE_PATH, /quota-usage\/page/)
    const summaryBase = reqOf(AI_PLATFORM_USAGE_PAGE_PATH, /quota-usage\/summary/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(pageBase.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(pageBase.url))
    expect(normalize(String(calls[1]?.url))).toBe(normalize(summaryBase.url))
    expect(queryPairs(String(calls[1]?.url))).toEqual(queryPairs(summaryBase.url))
    // 基准里这两条都**没有** `order`/`orderField`（cleanQuery 把它们丢了）——与推导一致
    expect(keysOf(pageBase.url)).toEqual(['quotaCycle', 'statisticsDimension', 'pageNo', 'pageSize', '_t'])
    expect(keysOf(summaryBase.url)).toEqual(['quotaCycle', 'statisticsDimension', '_t'])
  })

  it('模型列表页头角标：`pending-count?statisticsDimension=3` 与基准逐字段一致', async () => {
    const { calls, cap } = build()
    await cap.getPendingApplyCount()
    const base = reqOf(AI_MODEL_LIST_PAGE_PATH, /apply\/pending-count/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('数据分析：六条图表接口逐条与基准一致（**只有 `_t`**，没有区间参数）', async () => {
    const { calls, cap } = build()
    await cap.dataAnalysisOverview()
    expect(calls).toHaveLength(6)
    for (const path of Object.values(AI_ANALYSIS_PATHS)) {
      const base = reqOf(AI_DATA_ANALYSIS_PAGE_PATH, new RegExp(path.replace(/\//g, '\\/') + '(\\?|$)'))
      expect(keysOf(base.url)).toEqual(['_t'])
      const mine = calls.find((c) => String(c.url).includes(path))
      expect(mine, path).toBeDefined()
      expect(normalize(String(mine?.url))).toBe(normalize(base.url))
      expect(queryPairs(String(mine?.url))).toEqual(queryPairs(base.url))
    }
  })

  it('基准里同一条列表请求出现 **2 次**（点「查询」会重发一条只差 `_t` 的）⇒ 只断言"存在一条相符"', () => {
    const listUrl = reqOf(AI_MODEL_LIST_PAGE_PATH, /aiModelConfig\/getByPage/).url
    const same = BASE.requests.filter((r) => r.url === listUrl)
    expect(same).toHaveLength(2)
    // 两条的 URL 逐字相同（`_t` 已归一化）——所以"只出现一次"是个**错误**的断言
    expect(new Set(same.map((r) => r.url)).size).toBe(1)
  })

  it('本能力**不发**那两条门户外壳请求（基准里的它们不是页面契约）', async () => {
    const { calls, cap } = build()
    // 把四页所有的"读"都跑一遍（含所有 GET 单条与列表）
    await cap.listModels()
    await cap.getModel(1)
    await cap.listAvailableModels()
    await cap.listQuotaRules({ modelId: 1 })
    await cap.getQuotaRule(1)
    await cap.listFlowRules({ modelId: 1 })
    await cap.getFlowRule(1)
    await cap.listRuleHistory({ modelId: 1, configType: 1 })
    await cap.listApplyRecords()
    await cap.getPendingApplyCount()
    await cap.searchUsers({ keyword: 'x' })
    await cap.listModelSelections()
    await cap.getModelSelection(1)
    await cap.listPlatformQuota()
    await cap.getPlatformQuotaSummary()
    await cap.listPlatformUsageRecords()
    await cap.platformUsageAnalytics()
    await cap.getPlatformUsageDetail(1)
    await cap.listFunctionModules()
    await cap.dataAnalysisOverview()
    expect(calls.length).toBeGreaterThan(15)
    for (const call of calls) {
      const url = String(call.url)
      for (const pattern of SHELL_PATTERNS) {
        expect(pattern.test(url), `${url} 命中了门户外壳请求`).toBe(false)
      }
    }
    // 基准里确实有它们（说明"外壳请求混在基准里"这件事本身是真的）
    expect(BASE.requests.some((r) => /sensitive\/info/.test(r.url))).toBe(true)
    expect(BASE.requests.some((r) => /list-by-category/.test(r.url))).toBe(true)
  })

  it('⚠️ 基准里那条**长选项全量拉租户**（`tenant/page?name=&pageSize=200`）本能力**刻意不照抄**', async () => {
    const base = reqOf(AI_PLATFORM_USAGE_PAGE_PATH, /system\/tenant\/page/)
    expect(keysOf(base.url)).toEqual(['name', 'pageNo', 'pageSize', '_t'])
    expect(base.url).toContain('pageSize=200')
    // 本能力一条 `system/tenant/page` 都不发（租户候选交给 base-tenant-list 那条 lookup）
    const { calls, cap } = build()
    await cap.listPlatformQuota()
    await cap.getPlatformQuotaSummary()
    await cap.dataAnalysisOverview()
    for (const call of calls) {
      expect(String(call.url)).not.toContain('/system/tenant/page')
    }
  })
})

// ---------------------------------------------------------------------------
// K. 仍然只能等"写基准"的断言
// ---------------------------------------------------------------------------

describe('K. 写链路**没有**基准，这些断言只能等一次真机写验证', () => {
  /**
   * `baseline/ai-model.browser.json` 是 **23 条全 GET**（抓基准时没有做任何写操作），
   * 所以下面这些**至今没有判据** —— 它们现在锁的是"按源码 + 后端 controller 推导出来的形状"，
   * 不是"浏览器真的这么发"。真机 `prepare → submit → cancel` 跑完后再补成逐字段断言。
   */
  it.todo('模型 `add` 的真实 body（尤其 `"id":null` 与 `availableStatus`/`supportedFiles` 是否真在）')
  it.todo('模型 `update` 的真实 body（编辑态不重输 apiKey 时该键是否真的整个消失）')
  it.todo('模型 `test` 两个调用点的真实键序（列表页 id 在前 / 编辑页 id 在后）')
  it.todo('额度规则 `create`/`update` 的真实 body（`quotaCheckEnabled` 与 `enabled` 的实际取值）')
  it.todo('流速规则 `update` 的真实 method 是不是 **PUT**（本文件按后端 @PutMapping 推导）')
  it.todo('申请处理真实发出的是 `status=1`（忽略）/`status=2`（填写）—— 与后端枚举 0/3/4 的冲突以真机为准')
  it.todo('申请处理被后端拒绝时的**错误码**（后端失败信号区分度差，conventions 第 9 条）')
  it.todo('"一键填写"落个人档时后端**到底收不收** `targetUserId`（后端 VO 里没有这个字段）')
  it.todo('模型选择的 `details` / `skillIds` 真实 body（`skillIds` 是逗号串还是数组）')
  it.todo('数据分析那六条的真实**并发形状**：挂载时并发、点搜索时顺序 await（基准看不出顺序）')
})
