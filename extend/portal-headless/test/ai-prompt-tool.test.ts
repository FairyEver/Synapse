import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import {
  AI_BUSINESS_EVENT_PAGE_PATH,
  AI_OPEN_API_REGISTRY_PAGE_PATH,
  AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
  AI_TEMPLATE_PATHS,
  BUSINESS_EVENT_PATHS,
  DEFAULT_PAGE_SIZE,
  OPEN_API_REGISTRY_PATHS,
  aiPromptToolCapabilities,
  buildBusinessEventPayload,
  buildOpenApiRegistryCreatePayload,
  buildOpenApiRegistryParamTreeForSubmit,
  businessEventBindingsFromDetail,
  createAiPromptToolCapability,
  hasParamValue,
  mergeBusinessEventDraft,
  normalizeBusinessEventDetail,
  validateBusinessEvent,
  validateOpenApiRegistryParamTree,
  type WritePlan,
} from '../src/capabilities/ai-prompt-tool.js'
import { aiPromptCapabilities } from '../src/capabilities/ai-prompt.js'
import { normalizeVisibilityKey } from '../src/catalog/visibility.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 这份测试有两层，**别把它们读成同一件事**。
 *
 * ## 一、与浏览器基准逐字段一致（判据，conventions 31）
 *
 * `baseline/ai-prompt-tool.browser.json` 抓的是这三页**真实发出的只读请求**。
 * 它**证实了三条列表契约的每一个字节**（含键序与空值发不发）—— 见 `与浏览器基准逐字段一致` 那个 describe。
 * 抓取时间 2026-09-21，
 * 抓法：先在门户首页装钩子，再用**只改 hash** 的方式导航到目标页（SPA 同文档导航不卸载钩子）。
 *
 * ## 二、源码推导的契约锁定（**不是**"与浏览器一致"）
 *
 * 下面其余 describe 钉的是"源码推导出来的契约不许回退"。它们的依据是页面源码 + 后端代码，
 * **不是**基准 —— 因为基准是**只读**的（那一轮一个写请求都没发），下面这些基准**没覆盖**：
 *
 * 1. **三个 POST/PUT 体的键序**（`JSON.stringify` 保序，只有抓到写请求才能逐字节比）；
 * 2. **`DELETE` 的形态**：业务事件 / 工具提示词绑定是 `?id=`，开放接口是 `/delete/{id}?id={id}`；
 * 3. **`POST …/openApiRegistry/create` 的 `Content-Type`** 是不是 `application/json`
 *    （页面写了 `{ useJsonPost: true }`，本文件断言的是"platform.js 不看这个开关"）；
 * 4. **`available-skill/page` 到底带不带 `useSystem`**（后端会把它置空，但页面确实照发）；
 * 5. `get` / `record/page` / `record/get` / `scanByUrl` 的形状（页面挂载时不发这些）。
 *
 * 这五条**仍然只能算源码推导**，谁把它们说成"已验证"都是错的。
 */
const here = dirname(fileURLToPath(import.meta.url))

// ⚠️ 这一份测试**没有**逐字段基准可比：`baseline/ai-prompt-tool.browser.json` 本轮不存在。
// 本文件里**刻意不写**"基准不存在"的断言 —— 那种断言会在别人重新抓一次基准时变红
// （`perf-manage-config.test.ts` 里记过这个教训：随别人重抓基准而红的用例等于假警报）。
// 待办的那 8 条写在文件头。

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

/** 拆成有序的 [key, value] 列表：键顺序的差异也要能被发现（D20） */
function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, key === '_t' ? '<ts>' : decodeURIComponent(value)] as [string, string]
  })
}

const keysOf = (rawUrl: string): string[] => queryPairs(rawUrl).map(([key]) => key)
const pathOf = (rawUrl: string): string => rawUrl.split('?')[0] ?? ''

/**
 * 三页各一个 `request`（与门面的接法一致）。`respond` 用来换掉默认的假响应体 ——
 * `prepareXxx` 会真的 `GET` 一次，所以那几个用例必须让响应看起来像一条记录。
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
    cap: createAiPromptToolCapability(
      at(AI_BUSINESS_EVENT_PAGE_PATH),
      at(AI_OPEN_API_REGISTRY_PAGE_PATH),
      at(AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH),
    ),
  }
}

/** 一条看起来像真的业务事件（`prepareUpdate` / `prepareRemove` 会去 GET 它） */
const EVENT_ROW = {
  id: 77,
  eventCode: 'EVT-77',
  eventName: '预算超支提醒',
  ownerModule: 'HR',
  useSystem: 1,
  description: '测试用事件',
  enabled: true,
  updateTime: '2026-09-21 10:00:00',
  boundSkills: [
    { skillConfigId: 9, skillName: 'B', sort: 2, description: '第二条', publishStatus: 1 },
    { skillConfigId: 3, skillName: 'A', sort: 1, description: '第一条', publishStatus: 1 },
  ],
}

const REGISTRY_ROW = {
  id: 5,
  name: '查双赢协议列表',
  apiPath: '/admin-api/hr/win-win-agreement/list',
  httpMethod: 'GET',
  scopeKey: 'hr:agreement:read',
  groupName: 'HR模块',
  description: '分页查询',
  responseExample: '{"ret":"SUCCESS"}',
  sort: 3,
  status: 1,
  enabled: 1,
  createTime: '2026-09-01 09:00:00',
  params: [
    { id: 1, name: 'pageNo', type: 'integer', position: 'query', required: true, defaultValue: '1', description: '页码', sort: 1, children: null },
    { id: 2, name: 'keyword', type: 'string', position: 'query', required: false, defaultValue: '', description: '关键字', sort: 2, children: null },
  ],
}

const TEMPLATE_ROW = {
  id: 31,
  funcId: 'report',
  func: '日报',
  templateId: 12,
  templateContent: '旧模板内容',
  useType: 'report',
  creator: '1',
  createTime: '2026-09-01 09:00:00',
  updateTime: '2026-09-02 09:00:00',
}

// ---------------------------------------------------------------------------
// 与浏览器基准逐字段一致（判据）
// ---------------------------------------------------------------------------

type BaselineRequest = {
  页面: string
  pagePath: string
  via: string
  method: string
  url: string
  headers: Record<string, string>
  body: unknown
}

const BASELINE_PATH = join(here, '../baseline/ai-prompt-tool.browser.json')

let baselineCache: { requests: BaselineRequest[] } | null = null
function baseline (): { requests: BaselineRequest[] } {
  if (baselineCache === null) {
    baselineCache = JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as { requests: BaselineRequest[] }
  }
  return baselineCache
}

/** 基准里的 URL 到 `/admin-api/...` 为止（host 去掉、`_t` 归一成 `<ts>`） */
function baselineUrlPairs (raw: string): Array<[string, string]> {
  const [, rest] = raw.split(/^https?:\/\/[^/]+/) // rest 是「/…」，上面那步只为把 host 摘掉
  return queryPairs(rest ?? raw)
}

const baselinePathOf = (raw: string): string => {
  const [, rest] = raw.split(/^https?:\/\/[^/]+/)
  return pathOf(rest ?? raw)
}

/** 取某一页在基准里**页面自己**发的那条（两条噪声见下） */
function pageOwnedRequests (pagePath: string): BaselineRequest[] {
  const NOISE = [/\/org\/sensitive\/info/, /\/bpm\/task\/list-by-category/]
  return baseline().requests.filter(
    (request) => request.pagePath === pagePath && !NOISE.some((pattern) => pattern.test(request.url)),
  )
}

describe('与浏览器基准逐字段一致（`baseline/ai-prompt-tool.browser.json`）', () => {
  it('业务事件列表：无筛选时与基准**逐字段相同**（含键序）—— 三个筛选位确实整项不发', async () => {
    const owned = pageOwnedRequests(AI_BUSINESS_EVENT_PAGE_PATH)
    expect(owned).toHaveLength(1)
    expect(baselinePathOf(owned[0]!.url)).toBe('/admin-api/ai/business-event/page')

    const { calls, cap } = build()
    await cap.businessEvent.list()
    // ⚠️ 路径也要**与基准比**，不能只跟自己的常量比 —— 那样常量被改错时两边一起变，测试不会红
    expect(pathOf(String(calls[0]?.url))).toBe(baselinePathOf(owned[0]!.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(baselineUrlPairs(owned[0]!.url))
    // 基准里那条就是 `pageNo=1&pageSize=20&_t=<ts>`：eventName/ownerModule/useSystem **一个都没有**
    expect(baselineUrlPairs(owned[0]!.url).map(([key]) => key)).toEqual(['pageNo', 'pageSize', '_t'])
  })

  it('开放接口列表：无筛选时与基准**逐字段相同** —— `name=` 是**真的照发**（这条最容易搞反）', async () => {
    const owned = pageOwnedRequests(AI_OPEN_API_REGISTRY_PAGE_PATH)
    expect(owned).toHaveLength(1)
    expect(baselinePathOf(owned[0]!.url)).toBe('/admin-api/system/openApiRegistry/getByPage')

    const { calls, cap } = build()
    await cap.openApiRegistry.list()
    expect(pathOf(String(calls[0]?.url))).toBe(baselinePathOf(owned[0]!.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(baselineUrlPairs(owned[0]!.url))
    expect(baselineUrlPairs(owned[0]!.url)).toEqual([
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['name', ''],
      ['_t', '<ts>'],
    ])
  })

  it('工具提示词绑定列表：与基准**逐字段相同** —— `order=`/`orderField=` 真的在 URL 上', async () => {
    const owned = pageOwnedRequests(AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH)
    // ⚠️ 基准里这一页出现了**两次**同一条请求（点一次「查询」会重发一条只差 `_t` 的）——
    // 所以这里断言的是"**存在**一条逐字段相符的"，不是"只出现一次"：后者会在别人重抓基准
    // （少点/多点一次查询）时变红，那是与本能力无关的假警报。
    expect(owned.length).toBeGreaterThanOrEqual(1)
    expect(baselinePathOf(owned[0]!.url)).toBe('/admin-api/sales/ai-template/page')

    const { calls, cap } = build()
    await cap.templateBinding.list()
    // 能力一次调用只发一条 —— 我们复刻的是"这一页的列表契约"，不是"页面重复调的次数"
    expect(calls).toHaveLength(1)
    expect(pathOf(String(calls[0]?.url))).toBe(baselinePathOf(owned[0]!.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(baselineUrlPairs(owned[0]!.url))
    expect(baselineUrlPairs(owned[0]!.url)).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['func', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('基准的请求头里**没有 `module-type`** —— 三页"算不出就不发"是浏览器实测，不是推断', () => {
    const keys = new Set(baseline().requests.flatMap((request) => Object.keys(request.headers)))
    expect([...keys].sort()).toEqual(['Accept', 'Accept-Language', 'tenant-id', 'token'])
    expect(keys.has('module-type')).toBe(false)
  })

  it('基准里那两条**噪声**（全局敏感词 / 待办角标）不是这三页的 —— 能力不产生它们', async () => {
    const noise = baseline().requests.filter((request) =>
      /\/org\/sensitive\/info|\/bpm\/task\/list-by-category/.test(request.url),
    )
    // 每页各两条（是 app 外壳拉的，跟着每页一起被抓进来）。
    // ⚠️ 断言"至少有一条"而不是写死条数 —— 写死会随别人重抓基准而红（同样的假警报）。
    expect(noise.length).toBeGreaterThanOrEqual(3)
    expect(noise.some((request) => request.url.includes('/org/sensitive/info'))).toBe(true)
    expect(noise.some((request) => request.url.includes('/bpm/task/list-by-category'))).toBe(true)

    const { calls, cap } = build()
    await cap.businessEvent.list()
    await cap.openApiRegistry.list()
    await cap.templateBinding.list()
    for (const call of calls) {
      expect(String(call.url)).not.toContain('sensitive')
      expect(String(call.url)).not.toContain('list-by-category')
    }
    expect(calls).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// 能力定义：与目录（page-catalog.json）对齐
// ---------------------------------------------------------------------------

describe('21 条能力定义与 page-catalog.json / 路由 meta 对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string; permission: string; moduleType: number | null }> }

  it('三个 pagePath 在目录里逐字存在（多一个字少一个字都要红）', () => {
    const paths = new Set(catalog.items.map((item) => item.menuPath))
    for (const pagePath of [
      AI_BUSINESS_EVENT_PAGE_PATH,
      AI_OPEN_API_REGISTRY_PAGE_PATH,
      AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    ]) {
      expect(paths.has(pagePath), `pagePath 不在目录里：${pagePath}`).toBe(true)
    }
  })

  it('21 条能力：10 只读 + 11 写，id 互不重复', () => {
    expect(aiPromptToolCapabilities).toHaveLength(21)
    const ids = aiPromptToolCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const byWrite = aiPromptToolCapabilities.filter((c) => c.write).map((c) => c.id)
    expect(byWrite).toHaveLength(11)
    expect(aiPromptToolCapabilities.filter((c) => !c.write)).toHaveLength(10)
    expect(byWrite).toContain('ai-business-event-record-retry')
  })

  it('三页的 module-type 都**算不出来**（目录里是 null ⇒ 不发这个头，conventions 2）', () => {
    for (const pagePath of [
      AI_BUSINESS_EVENT_PAGE_PATH,
      AI_OPEN_API_REGISTRY_PAGE_PATH,
      AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    ]) {
      const entry = catalog.items.find((item) => item.menuPath === pagePath)
      expect(entry?.moduleType, pagePath).toBeNull()
    }
  })

  it('权利码：业务事件/开放接口与目录逐字一致；工具提示词绑定**刻意**跟路由 meta 走', () => {
    const byPath = new Map(catalog.items.map((item) => [item.menuPath, item.permission]))
    // 这两页目录与路由/菜单一致
    expect(byPath.get(AI_BUSINESS_EVENT_PAGE_PATH)).toBe('/dashboard/platform-v2/intelligence/prompt/business-event')
    expect(byPath.get(AI_OPEN_API_REGISTRY_PAGE_PATH)).toBe('/dashboard/platform/intelligence/prompt/interface')
    for (const capability of aiPromptToolCapabilities) {
      if (capability.pagePath === AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH) continue
      expect(capability.permission, capability.id).toBe(byPath.get(capability.pagePath))
    }

    // 当前菜单入口加载 mall.v2.js，页面自己的 `<route>` meta 也使用同一权限码。
    const templatePermissions = new Set(
      aiPromptToolCapabilities
        .filter((c) => c.pagePath === AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH)
        .map((c) => c.permission),
    )
    expect([...templatePermissions]).toEqual(['/dashboard/platform-v2/intelligence/prompt/template'])
    expect(byPath.get(AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH)).toBe(
      '/dashboard/platform-v2/intelligence/prompt/template',
    )
    expect(normalizeVisibilityKey('/dashboard/platform-v2/intelligence/prompt/template')).toBe(
      normalizeVisibilityKey(byPath.get(AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH) ?? ''),
    )
  })

  it('每条定义的 pagePath 只能是这三页之一；参数表里 search/tree 的 lookup 都不许指自己', () => {
    const allowed = new Set([
      AI_BUSINESS_EVENT_PAGE_PATH,
      AI_OPEN_API_REGISTRY_PAGE_PATH,
      AI_PROMPT_TEMPLATE_BINDING_PAGE_PATH,
    ])
    const ownIds = new Set(aiPromptToolCapabilities.map((c) => c.id))
    for (const capability of aiPromptToolCapabilities) {
      expect(allowed.has(capability.pagePath), capability.id).toBe(true)
      for (const param of capability.params) {
        if (param.lookup === undefined) continue
        // 不许指自己：自己指向自己是一条永远查不到候选的死路
        expect(ownIds.has(param.lookup.capabilityId), `${capability.id}.${param.name}`).toBe(false)
      }
    }
  })

  it('⚠️ 两处跨文件的 lookup（指 `ai-prompt.ts` 的候选入口）在那边真的存在、关键字参数也真的叫那个', () => {
    // 这两个 id 属于**别的文件**。它们一改名，这里就红 —— 而不是等到 `catalog.validate().lookups`
    // 在别人那一轮里报"候选入口能力不在目录里"。这是本文件敢跨文件引用的唯一理由。
    const targets = new Map(aiPromptCapabilities.map((c) => [c.id, c]))
    const crossFileLookups = aiPromptToolCapabilities.flatMap((capability) =>
      capability.params
        .filter((param) => param.lookup !== undefined && param.lookup.capabilityId !== 'base-dict-get')
        .map((param) => ({ from: capability.id, param: param.name, lookup: param.lookup! })),
    )
    // 同一个参数表被 create / update 两条定义共用，所以这里是**去重后**的两个目标
    expect([...new Set(crossFileLookups.map((item) => item.lookup.capabilityId))].sort()).toEqual([
      'ai-prompt-skill-list',
      'ai-prompt-tip-type-list',
    ])
    expect(crossFileLookups).toHaveLength(4)
    for (const { from, param, lookup } of crossFileLookups) {
      const target = targets.get(lookup.capabilityId)
      expect(target, `${from}.${param} 指向了 ai-prompt.ts 里不存在的 ${lookup.capabilityId}`).toBeDefined()
      expect(
        target?.params.some((candidate) => candidate.name === lookup.keywordParam),
        `${from}.${param} 的关键字参数 ${lookup.keywordParam} 不在 ${lookup.capabilityId} 的参数表里`,
      ).toBe(true)
    }
  })

  it('长选项参数都得是 search/tree 且带 lookup（conventions 11）', () => {
    // 这三处是"长选项"：技能候选、责任模块字典、接口方法字典、提示词类型、绑定模板、功能名称字典
    const longOptionNames = new Set(['ownerModule', 'httpMethod', 'funcId', 'useType', 'templateId'])
    for (const capability of aiPromptToolCapabilities) {
      for (const param of capability.params) {
        if (!longOptionNames.has(param.name)) continue
        expect(param.kind, `${capability.id}.${param.name}`).toBe('search')
        expect(param.lookup, `${capability.id}.${param.name}`).toBeDefined()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// 业务事件绑定技能：URL 契约（源码推导，非基准）
// ---------------------------------------------------------------------------

describe('业务事件 —— URL 契约（**源码推导**，基准还没到）', () => {
  it('无筛选时只有 pageNo/pageSize/_t：三个筛选位都是 undefined，整项不发', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.list()
    expect(pathOf(String(calls[0]?.url))).toBe(BUSINESS_EVENT_PATHS.page)
    expect(keysOf(String(calls[0]?.url))).toEqual(['pageNo', 'pageSize', '_t'])
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['_t', '<ts>'],
    ])
  })

  it('这一页**没有** order/orderField（customLoad 逐个挑字段，把它们挡在外面了）', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.list({ eventName: '制度' })
    const url = String(calls[0]?.url)
    expect(url).not.toContain('order=')
    expect(url).not.toContain('orderField=')
  })

  it('传了筛选就按 pageNo→pageSize→eventName→ownerModule→useSystem 的顺序出现', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.list({ eventName: '制度', ownerModule: 'HR', useSystem: 1, pageNo: 3, pageSize: 50 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '3'],
      ['pageSize', '50'],
      ['eventName', '制度'],
      ['ownerModule', 'HR'],
      ['useSystem', '1'],
      ['_t', '<ts>'],
    ])
  })

  it('详情 / 删除：都是 query 传 id，删除走 DELETE', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.get(77)
    expect(pathOf(String(calls[0]?.url))).toBe(BUSINESS_EVENT_PATHS.get)
    expect(queryPairs(String(calls[0]?.url))).toEqual([['id', '77'], ['_t', '<ts>']])
    expect(calls[0]?.method).toBe('get')

    // ⚠️ prepareRemove 会**先 GET 一次**（确认存在）—— 所以删除请求是 calls[2]
    const plan = await cap.businessEvent.prepareRemove(77)
    expect(pathOf(String(calls[1]?.url))).toBe(BUSINESS_EVENT_PATHS.get)
    await cap.businessEvent.submit(plan)
    expect(pathOf(String(calls[2]?.url))).toBe(BUSINESS_EVENT_PATHS.remove)
    // ⚠️ DELETE 的参数**不在 URL 字符串上**：platform.js 的拦截器只把 **GET** 的 params
    // 用 qs 拼进 url（client.ts 逐字复刻了这条），非 GET 的交给 axios 自己的序列化器 ——
    // 所以这里要看 `config.params`，也不能指望有 `_t`
    expect(String(calls[2]?.url)).not.toContain('?')
    expect(calls[2]?.params).toEqual({ id: 77 })
    expect(String(calls[2]?.method)).toBe('delete')
  })

  it('执行记录：eventCode 必填，且排在 pageNo/pageSize 之后', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.listRecords({ eventCode: 'EVT-77', pageNo: 2 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '2'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['eventCode', 'EVT-77'],
      ['_t', '<ts>'],
    ])
  })

  it('候选技能：skillName 空值整项不发，useSystem 照发', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.listAvailableSkills({ useSystem: 1 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['useSystem', '1'],
      ['_t', '<ts>'],
    ])
  })

  it('⚠️ 这里三页的路径都自带 /admin-api，前缀拦截器不会补第二次', async () => {
    const { calls, cap } = build()
    await cap.businessEvent.list()
    await cap.openApiRegistry.list()
    await cap.templateBinding.list()
    for (const call of calls) {
      const path = pathOf(String(call.url))
      expect(path.startsWith('/admin-api/'), path).toBe(true)
      expect(path.startsWith('/admin-api/admin-api'), path).toBe(false)
    }
  })
})

// ---------------------------------------------------------------------------
// 开放接口：URL 契约
// ---------------------------------------------------------------------------

describe('开放接口 —— URL 契约（**源码推导**，基准还没到）', () => {
  it('⚠️ 无筛选时 name 是**空串照发**（与业务事件那页相反），status/enabled 整项不发', async () => {
    const { calls, cap } = build()
    await cap.openApiRegistry.list()
    expect(pathOf(String(calls[0]?.url))).toBe(OPEN_API_REGISTRY_PATHS.page)
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['name', ''],
      ['_t', '<ts>'],
    ])
  })

  it('status/enabled 传了就按 pageNo→pageSize→name→status→enabled 的顺序出现；0 照发', async () => {
    const { calls, cap } = build()
    await cap.openApiRegistry.list({ name: '协议', status: 1, enabled: 0 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['pageNo', '1'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['name', '协议'],
      ['status', '1'],
      ['enabled', '0'],
      ['_t', '<ts>'],
    ])
  })

  it('⚠️ 详情是**路径**带 id（没有 query 参数）；删除是**路径 + query 都带 id**', async () => {
    const { calls, cap } = build((config) => (String(config.url).includes('/get/') ? REGISTRY_ROW : { list: [], total: 0 }))
    await cap.openApiRegistry.get(5)
    // ⚠️ 详情那条**没有 query 参数**，只有 platform.js 拦截器补的 `_t`
    expect(pathOf(String(calls[0]?.url))).toBe(`${OPEN_API_REGISTRY_PATHS.detail}/5`)
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])

    // ⚠️ prepareRemove 会**先 GET 一次**（确认存在）—— 所以删除请求是 calls[2]
    const plan = await cap.openApiRegistry.prepareRemove(5)
    expect(pathOf(String(calls[1]?.url))).toBe(`${OPEN_API_REGISTRY_PATHS.detail}/5`)
    await cap.openApiRegistry.submit(plan)
    expect(pathOf(String(calls[2]?.url))).toBe(`${OPEN_API_REGISTRY_PATHS.remove}/5`)
    // ⚠️ DELETE 的 id 在 `config.params` 上（非 GET 不走 qs-in-interceptor），URL 上没有 query
    expect(String(calls[2]?.url)).not.toContain('?')
    expect(calls[2]?.params).toEqual({ id: 5 })
    expect(calls[2]?.method).toBe('delete')
  })

  it('⚠️ 扫描接口的参数顺序是 baseUrl → url（与后端方法签名相反）', async () => {
    const { calls, cap } = build(() => [])
    await cap.openApiRegistry.scan({ baseUrl: 'https://biz-api-test.wodecorp.cn', url: 'agreement' })
    expect(keysOf(String(calls[0]?.url))).toEqual(['baseUrl', 'url', '_t'])
  })

  it('扫描不给 baseUrl 时只剩 url（页面表单是手填的，可以空着）', async () => {
    const { calls, cap } = build(() => [])
    await cap.openApiRegistry.scan({ url: 'agreement' })
    expect(keysOf(String(calls[0]?.url))).toEqual(['url', '_t'])
  })
})

// ---------------------------------------------------------------------------
// 工具提示词绑定：URL 契约
// ---------------------------------------------------------------------------

describe('工具提示词绑定 —— URL 契约（**源码推导**，基准还没到）', () => {
  it('⚠️ 这一页**会带** order=/orderField=（整份 params 原样发给 axios）', async () => {
    const { calls, cap } = build()
    await cap.templateBinding.list()
    expect(pathOf(String(calls[0]?.url))).toBe(AI_TEMPLATE_PATHS.page)
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['func', ''],
      ['pageNo', '1'],
      ['pageSize', String(DEFAULT_PAGE_SIZE)],
      ['_t', '<ts>'],
    ])
  })

  it('详情 / 删除都是 query 传 id，删除**不带路径 id**（与开放接口那页不同）', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get') ? TEMPLATE_ROW : { list: [], total: 0 },
    )
    await cap.templateBinding.get(31)
    expect(pathOf(String(calls[0]?.url))).toBe(AI_TEMPLATE_PATHS.get)
    expect(queryPairs(String(calls[0]?.url))).toEqual([['id', '31'], ['_t', '<ts>']])

    const plan = await cap.templateBinding.prepareRemove(31)
    expect(pathOf(String(calls[1]?.url))).toBe(AI_TEMPLATE_PATHS.get)
    await cap.templateBinding.submit(plan)
    expect(pathOf(String(calls[2]?.url))).toBe(AI_TEMPLATE_PATHS.remove)
    expect(calls[2]?.params).toEqual({ id: 31 })
    expect(calls[2]?.method).toBe('delete')
  })
})

// ---------------------------------------------------------------------------
// 请求体：逐字复刻页面（键序也是契约）
// ---------------------------------------------------------------------------

describe('请求体键序 —— 逐字复刻页面的组装函数（**源码推导**）', () => {
  it('业务事件：eventName→ownerModule→useSystem→description→enabled→skillBindings，id 追加在最后', () => {
    expect(
      Object.keys(
        buildBusinessEventPayload({
          eventName: '  制度发布  ',
          ownerModule: ' HR ',
          useSystem: '1',
          description: '  ',
          enabled: true,
          skillBindings: [{ skillConfigId: 3, description: ' 说明 ' }],
        }),
      ),
    ).toEqual(['eventName', 'ownerModule', 'useSystem', 'description', 'enabled', 'skillBindings'])
    expect(
      buildBusinessEventPayload({
        id: 77,
        eventName: '制度发布',
        ownerModule: 'HR',
        useSystem: 1,
        enabled: true,
        skillBindings: [{ skillConfigId: 3 }],
      }),
    ).toEqual({
      eventName: '制度发布',
      ownerModule: 'HR',
      useSystem: 1,
      description: null,
      enabled: true,
      skillBindings: [{ skillConfigId: 3, description: null }],
      id: 77,
    })
  })

  it('业务事件：ownerModule 空 → **空串**（照发）；description 空 → **null**（这两个不一样）', () => {
    const payload = buildBusinessEventPayload({
      eventName: '制度发布',
      ownerModule: '',
      useSystem: 1,
      description: '',
      enabled: false,
      skillBindings: [],
    })
    expect(Object.keys(payload)).toContain('ownerModule')
    expect(payload.ownerModule).toBe('')
    expect(payload.description).toBeNull()
  })

  it('业务事件：`boundSkills` 按 sort 升序、按 skillConfigId 去重（页面的 boundSkillsToBindingState）', () => {
    expect(businessEventBindingsFromDetail(EVENT_ROW).map((b) => b.skillConfigId)).toEqual([3, 9])
    expect(
      businessEventBindingsFromDetail({
        boundSkills: [
          { skillConfigId: 3, sort: 1 },
          { skillConfigId: 3, sort: 2 },
          { sort: 0 },
        ],
      }).map((b) => b.skillConfigId),
    ).toEqual([3])
  })

  it('开放接口：11 个字段的键序照抄 buildOpenApiRegistryCreatePayload，id 在最后', () => {
    const created = buildOpenApiRegistryCreatePayload({
      name: 'A',
      apiPath: '/x',
      httpMethod: 'GET',
      scopeKey: 's',
      groupName: 'g',
      description: 'd',
      sort: 0,
      params: [],
    })
    expect(Object.keys(created)).toEqual([
      'name',
      'apiPath',
      'httpMethod',
      'scopeKey',
      'groupName',
      'description',
      'responseExample',
      'sort',
      'status',
      'enabled',
      'params',
    ])
    expect(created.sort).toBe('')
    expect(created.status).toBe(0)
    expect(created.enabled).toBe(0)
  })

  it('开放接口：参数树**丢掉空节点**，required 变字符串、sort 按同级下标重排', () => {    const tree = buildOpenApiRegistryParamTreeForSubmit([
      { name: 'pageNo', type: 'integer', position: 'query', required: true, defaultValue: '1', description: '页码' },
      // ⚠️ 真正的"空行"必须连 position 都没有：编辑器新建出来的行默认带 `position: 'query'`，
      // 那种行 `hasParamValue` 是 true ⇒ **会被 validateOpenApiRegistryParamTree 拦下**
      // （页面也是这样：留一行没填完的空行存不下去）
      { name: '', defaultValue: '', description: '' },
      {
        name: 'body',
        type: 'object',
        position: 'body',
        required: false,
        description: '体',
        children: [{ name: 'child', type: 'string', position: 'query', required: true, defaultValue: 'x', description: '子' }],
      },
    ])
    expect(tree).toHaveLength(2)
    expect(tree[0]).toMatchObject({ name: 'pageNo', required: 'true', sort: '1', children: null })
    // 父级是 body ⇒ 子级被强制成 body（页面 normalizeParamNodeForSubmit 的行为）
    expect(tree[1]).toMatchObject({ name: 'body', required: 'false', sort: '2' })
    expect((tree[1]?.children as Array<Record<string, unknown>>)[0]).toMatchObject({
      name: 'child',
      position: 'body',
    })
  })

  it('⚠️ hasParamValue 把 `position` 也算作"有内容"：编辑器新建的空行（只带 position）**不会被静默丢掉**', () => {
    // 只带 position 的一行 —— 编辑器 `createInterfaceParam()` 建出来就是这个形状
    expect(hasParamValue({ position: 'query' })).toBe(true)
    // 连 position 都没有的一行才是真正的空行
    expect(hasParamValue({ name: '', type: 'string', required: 'true' })).toBe(false)
    expect(buildOpenApiRegistryParamTreeForSubmit([{ position: 'query' }])).toHaveLength(1)
  })

  it('⚠️ 但"只带 position 的空行"**存不下去**：页面的 validateParamTree 会拦，SDK 也拦', () => {
    expect(() => validateOpenApiRegistryParamTree([{ position: 'query' }])).toThrow(/未填写完整/)
    expect(() => validateOpenApiRegistryParamTree([
      { name: 'ok', type: 'string', position: 'query', required: 'true', defaultValue: '1', description: '说明' },
      { name: 'pageNo', type: 'integer', position: 'query', required: 'true', defaultValue: '', description: '页码' },
    ])).toThrow(/未填写完整/) // 必填叶子节点没有测试值
    expect(() => validateOpenApiRegistryParamTree([
      { name: 'big', type: 'string', position: 'query', required: 'false', defaultValue: 'x'.repeat(801), description: '说明' },
    ])).toThrow(/800/)
    expect(() => validateOpenApiRegistryParamTree([
      { name: 'ok', type: 'string', position: 'query', required: 'false', defaultValue: '', description: '说明' },
    ])).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// 写链路：prepare → submit → cancel（三步分开）
// ---------------------------------------------------------------------------

describe('写链路 prepare → submit → cancel', () => {
  it('prepareCreate 不发请求；submit 只发那一条 POST；create 不回传 id ⇒ cancel 会抛', async () => {
    const { calls, cap } = build()
    const plan = cap.businessEvent.prepareCreate({
      eventName: 'SDK-TEST-预算超支',
      ownerModule: 'HR',
      useSystem: 1,
      enabled: true,
      skillBindings: [{ skillConfigId: 3 }],
    })
    expect(calls).toHaveLength(0) // prepare 是只读的，而且这一步没有可读的东西
    expect(plan.undo).toBeNull()

    await cap.businessEvent.submit(plan)
    expect(calls).toHaveLength(1)
    expect(pathOf(String(calls[0]?.url))).toBe(BUSINESS_EVENT_PATHS.create)
    expect(calls[0]?.method).toBe('post')
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      eventName: 'SDK-TEST-预算超支',
      ownerModule: 'HR',
      useSystem: 1,
      description: null,
      enabled: true,
      skillBindings: [{ skillConfigId: 3, description: null }],
    })

    await expect(cap.businessEvent.cancel(plan)).rejects.toThrow(/撤销不了/)
    expect(calls).toHaveLength(1) // cancel 失败时一条请求都不许发
  })

  it('prepareUpdate 先 GET 一次并把没给的字段沿用回来；cancel 把 GET 到的那份**重算**后写回', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get') ? EVENT_ROW : { list: [], total: 0 },
    )
    const plan = await cap.businessEvent.prepareUpdate({ id: 77, eventName: 'SDK-TEST-改过的名字' })
    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.url)).toContain(`${BUSINESS_EVENT_PATHS.get}?id=77`)

    // 没给的字段沿用 GET 到的那份（ownerModule/useSystem/description/enabled/绑定都在）
    expect(plan.request.data).toEqual({
      eventName: 'SDK-TEST-改过的名字',
      ownerModule: 'HR',
      useSystem: 1,
      description: '测试用事件',
      enabled: true,
      skillBindings: [
        { skillConfigId: 3, description: '第一条' },
        { skillConfigId: 9, description: '第二条' },
      ],
      id: 77,
    })

    await cap.businessEvent.submit(plan)
    expect(pathOf(String(calls[1]?.url))).toBe(BUSINESS_EVENT_PATHS.update)

    // 撤销：把 GET 到的那份重算写回 —— 注意 boundSkills → skillBindings 的换算
    await cap.businessEvent.cancel(plan)
    expect(pathOf(String(calls[2]?.url))).toBe(BUSINESS_EVENT_PATHS.update)
    expect(JSON.parse(String(calls[2]?.data))).toEqual({
      eventName: '预算超支提醒',
      ownerModule: 'HR',
      useSystem: 1,
      description: '测试用事件',
      enabled: true,
      skillBindings: [
        { skillConfigId: 3, description: '第一条' },
        { skillConfigId: 9, description: '第二条' },
      ],
      id: 77,
    })
  })

  it('prepareUpdate 的 id 为空时当场拒绝，一条请求都不发', async () => {
    const { calls, cap } = build()
    await expect(cap.businessEvent.prepareUpdate({ eventName: 'x' })).rejects.toThrow(/业务事件 id 不能为空/)
    expect(calls).toHaveLength(0)
  })

  it('启停：body 是 {id, enabled}；撤销写回**当前值**（不是取反）', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get') ? EVENT_ROW : { list: [], total: 0 },
    )
    const plan = await cap.businessEvent.prepareSetEnabled(77, false)
    expect(plan.request).toEqual({ url: BUSINESS_EVENT_PATHS.updateEnabled, method: 'post', data: { id: 77, enabled: false } })
    expect(plan.undo?.data).toEqual({ id: 77, enabled: true })

    await cap.businessEvent.submit(plan)
    expect(JSON.parse(String(calls[1]?.data))).toEqual({ id: 77, enabled: false })
    await cap.businessEvent.cancel(plan)
    expect(JSON.parse(String(calls[2]?.data))).toEqual({ id: 77, enabled: true })
  })

  it('启停的 enabled 必须是布尔值（禁止把"当前值"当成"目标值"传进来）', async () => {
    const { calls, cap } = build(() => EVENT_ROW)
    await expect(cap.businessEvent.prepareSetEnabled(77, 1 as never)).rejects.toThrow(/布尔值/)
    expect(calls).toHaveLength(0)
  })

  it('删除不可撤销：prepare 会 GET（确认存在），cancel 抛且不发请求', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get') ? EVENT_ROW : { list: [], total: 0 },
    )
    const plan = await cap.businessEvent.prepareRemove(77)
    expect(plan.note).toContain('预算超支提醒') // GET 到了才有名字
    await cap.businessEvent.submit(plan)
    expect(calls).toHaveLength(2)
    await expect(cap.businessEvent.cancel(plan)).rejects.toThrow(/撤销不了/)
    expect(calls).toHaveLength(2)
  })

  it('重试：状态可重试才给 plan；不可重试时提前拦、不发请求（后端也会拒）', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/record/get') ? { id: 9, status: 3 } : { list: [], total: 0 },
    )
    const plan = await cap.businessEvent.prepareRecordRetry(9)
    expect(plan.request).toEqual({ url: BUSINESS_EVENT_PATHS.recordRetry, method: 'post', data: { id: 9 } })
    expect(plan.undo).toBeNull()
    expect(plan.note).toContain('真的把技能再执行一遍')

    const failing = build((config) =>
      String(config.url).includes('/record/get') ? { id: 9, status: 2 } : { list: [], total: 0 },
    )
    await expect(failing.cap.businessEvent.prepareRecordRetry(9)).rejects.toThrow(/只有 3\/4\/5/)
    expect(failing.calls).toHaveLength(1) // 只发了那次 GET
  })

  it('开放接口 create 的 body 键序 + cancel 不可用', async () => {
    const { calls, cap } = build()
    const plan = cap.openApiRegistry.prepareCreate({
      name: 'SDK-TEST-接口',
      apiPath: '/admin-api/sdk-test',
      httpMethod: 'GET',
      scopeKey: 'sdk:test',
      groupName: 'SDK测试',
      description: '测试用',
      sort: 7,
      status: 0,
      enabled: 0,
    })
    await cap.openApiRegistry.submit(plan)
    expect(pathOf(String(calls[0]?.url))).toBe(OPEN_API_REGISTRY_PATHS.create)
    const body = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual([
      'name',
      'apiPath',
      'httpMethod',
      'scopeKey',
      'groupName',
      'description',
      'responseExample',
      'sort',
      'status',
      'enabled',
      'params',
    ])
    expect(body.sort).toBe('7')
    await expect(cap.openApiRegistry.cancel(plan)).rejects.toThrow(/撤销不了/)
  })

  it('开放接口 update：prepare 先 GET，没给的字段沿用；cancel 把 GET 到的那份写回', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get/') ? REGISTRY_ROW : { list: [], total: 0 },
    )
    const plan = await cap.openApiRegistry.prepareUpdate({ id: 5, description: 'SDK-TEST-改过的描述' })
    const body = plan.request.data as Record<string, unknown>
    expect(body).toMatchObject({
      name: '查双赢协议列表',
      apiPath: '/admin-api/hr/win-win-agreement/list',
      httpMethod: 'GET',
      scopeKey: 'hr:agreement:read',
      groupName: 'HR模块',
      description: 'SDK-TEST-改过的描述',
      responseExample: '{"ret":"SUCCESS"}',
      sort: '3',
      status: 1,
      enabled: 1,
      id: 5,
    })
    // 参数树：`required` 变成字符串、`sort` 按同级下标重排（页面的 normalizeParamTreeForSubmit）
    expect(body.params).toHaveLength(2)
    expect((body.params as Array<Record<string, unknown>>)[0]).toMatchObject({ name: 'pageNo', required: 'true', sort: '1', position: 'query' })
    expect((body.params as Array<Record<string, unknown>>)[1]).toMatchObject({ name: 'keyword', required: 'false', sort: '2' })

    await cap.openApiRegistry.submit(plan)
    expect(pathOf(String(calls[1]?.url))).toBe(OPEN_API_REGISTRY_PATHS.update)

    await cap.openApiRegistry.cancel(plan)
    const undoBody = JSON.parse(String(calls[2]?.data)) as Record<string, unknown>
    expect(undoBody.description).toBe('分页查询')
    expect(undoBody.sort).toBe('3')
  })

  it('工具提示词绑定 create 的 body 键序照抄页面（id 打头且是 null）', async () => {
    const { calls, cap } = build()
    const plan = cap.templateBinding.prepareCreate({
      funcId: 'report',
      templateId: 12,
      useType: 'report',
      templateContent: 'SDK-TEST-模板',
    })
    await cap.templateBinding.submit(plan)
    expect(pathOf(String(calls[0]?.url))).toBe(AI_TEMPLATE_PATHS.create)
    expect(calls[0]?.method).toBe('post')
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      id: null,
      templateId: 12,
      useType: 'report',
      funcId: 'report',
      templateContent: 'SDK-TEST-模板',
    })
    await expect(cap.templateBinding.cancel(plan)).rejects.toThrow(/撤销不了/)
  })

  it('工具提示词绑定 update：body 是**这一行原样** + templateContent；undo 是这一个行原样', async () => {
    const { calls, cap } = build((config) =>
      String(config.url).includes('/get') ? TEMPLATE_ROW : { list: [], total: 0 },
    )
    const plan = await cap.templateBinding.prepareUpdate(31, { templateContent: 'SDK-TEST-新模板' })
    const body = plan.request.data as Record<string, unknown>
    // 服务端给的字段一个不少（页面就是 `{...GET 回来的, templateContent}`）
    expect(Object.keys(body)).toEqual(Object.keys(TEMPLATE_ROW))
    expect(body).toMatchObject({ ...TEMPLATE_ROW, templateContent: 'SDK-TEST-新模板' })
    expect(calls[0]?.method).toBe('get') // prepare 只读：先 GET

    await cap.templateBinding.submit(plan)
    expect(pathOf(String(calls[1]?.url))).toBe(AI_TEMPLATE_PATHS.update)
    expect(calls[1]?.method).toBe('put')

    await cap.templateBinding.cancel(plan)
    expect(JSON.parse(String(calls[2]?.data))).toEqual(TEMPLATE_ROW)
  })

  it('submit / cancel 拿到的不是 plan 时一律拒绝，不发请求（把"三步分开"钉死）', async () => {
    const { calls, cap } = build()
    await expect(cap.businessEvent.submit({} as WritePlan)).rejects.toThrow(/prepareXxx/)
    await expect(cap.businessEvent.cancel(undefined as unknown as WritePlan)).rejects.toThrow(/prepareXxx/)
    await expect(cap.openApiRegistry.submit(null as unknown as WritePlan)).rejects.toThrow(/prepareXxx/)
    await expect(cap.templateBinding.cancel(1 as unknown as WritePlan)).rejects.toThrow(/prepareXxx/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 本地校验：与页面同构，校验不过就不发请求
// ---------------------------------------------------------------------------

describe('本地校验（与页面 validateBusinessEvent / rules 同构）', () => {
  it('事件名称长度 2-50', () => {
    expect(validateBusinessEvent({ eventName: '短', useSystem: 1 })).toContain('2-50')
    expect(validateBusinessEvent({ eventName: 'a'.repeat(51), useSystem: 1 })).toContain('2-50')
    expect(validateBusinessEvent({ eventName: '刚刚好', useSystem: 1 })).toBe('')
  })

  it('useSystem 必填；description 超长报错', () => {
    expect(validateBusinessEvent({ eventName: '名称' })).toBe('请选择使用系统')
    expect(
      validateBusinessEvent({ eventName: '名称', useSystem: 1, description: 'x'.repeat(501) }),
    ).toContain('500')
  })

  it('绑定：最多 100 个、不能重复、启用时至少 1 个、未发布要拦', () => {
    expect(validateBusinessEvent({ eventName: '名称', useSystem: 1, enabled: true, skillBindings: [] })).toContain('至少绑定 1 个')
    expect(
      validateBusinessEvent({ eventName: '名称', useSystem: 1, enabled: true, skillBindings: [{ skillConfigId: 1 }, { skillConfigId: 1 }] }),
    ).toContain('不能重复')
    expect(
      validateBusinessEvent({
        eventName: '名称',
        useSystem: 1,
        enabled: true,
        skillBindings: [{ skillConfigId: 1, publishStatus: 0 }],
      }),
    ).toContain('未发布')
    // 停用 + 空绑定是合法的
    expect(validateBusinessEvent({ eventName: '名称', useSystem: 1, enabled: false, skillBindings: [] })).toBe('')
    // 不给 publishStatus 就跳过"已发布"那一条（文档里写清楚了这是不校验）
    expect(
      validateBusinessEvent({ eventName: '名称', useSystem: 1, enabled: true, skillBindings: [{ skillConfigId: 1 }] }),
    ).toBe('')
  })

  it('useSystem 是 NaN 时 buildBusinessEventPayload 提前抛（不让 NaN 悄悄变成 null）', () => {
    expect(() => buildBusinessEventPayload({ eventName: '名称', useSystem: undefined as never, enabled: false })).toThrow(
      /useSystem/,
    )
  })

  it('listRecords 空 eventCode / listAvailableSkills 缺 useSystem：都 reject 且不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.businessEvent.listRecords({ eventCode: '  ' })).rejects.toThrow(/eventCode 必填/)
    await expect(cap.businessEvent.listAvailableSkills({ useSystem: '' })).rejects.toThrow(/useSystem 必填/)
    await expect(cap.openApiRegistry.scan({ url: '' })).rejects.toThrow(/url 必填/)
    expect(calls).toHaveLength(0)
  })

  it('开放接口 create 缺必填字段当场抛，一条请求都不发', () => {
    const { calls, cap } = build()
    expect(() => cap.openApiRegistry.prepareCreate({ name: '只有名字' })).toThrow(/必填/)
    expect(calls).toHaveLength(0)
  })

  it('工具提示词绑定 funcId / templateId / templateContent 必填', () => {
    const { cap } = build()
    expect(() => cap.templateBinding.prepareCreate({ funcId: '', templateId: 1, templateContent: 'x' })).toThrow(/funcId/)
    expect(() => cap.templateBinding.prepareCreate({ funcId: 'a', templateId: '' as never, templateContent: 'x' })).toThrow(/templateId/)
    expect(() => cap.templateBinding.prepareCreate({ funcId: 'a', templateId: 1, templateContent: '  ' })).toThrow(/templateContent/)
  })

  it('mergeBusinessEventDraft 只覆盖**显式给了**的字段（undefined 不算给了）', () => {
    const merged = mergeBusinessEventDraft(EVENT_ROW, { id: 77, eventName: '新名字', description: undefined })
    expect(merged.eventName).toBe('新名字')
    expect(merged.ownerModule).toBe('HR')
    expect(merged.description).toBe('测试用事件')
    expect(merged.enabled).toBe(true)
    expect(merged.skillBindings?.map((b) => b.skillConfigId)).toEqual([3, 9])
  })

  it('normalizeBusinessEventDetail 的 `enabled: source.enabled !== false`（缺省是启用）', () => {
    expect(normalizeBusinessEventDetail({}).enabled).toBe(true)
    expect(normalizeBusinessEventDetail({ enabled: false }).enabled).toBe(false)
    expect(normalizeBusinessEventDetail({ enabled: 0 }).enabled).toBe(true) // 页面的 `!== false` 就是这么宽
  })
})
