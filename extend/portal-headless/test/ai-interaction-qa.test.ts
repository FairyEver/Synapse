import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'

import {
  AI_INTERACTION_CHAT_PAGE_PATH,
  AI_INTERACTION_FEEDBACK_PAGE_PATH,
  AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
  AI_INTERACTION_PERMISSIONS,
  AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
  DEFAULT_PAGE_SIZE,
  HOT_QUESTION_LIST_PATHS,
  TEXT_MAX_LENGTH,
  aiInteractionQaCapabilities,
  buildHotQuestionCreatePayload,
  buildSetChatDisplayPayload,
  createAiInteractionQaCapability,
} from '../src/capabilities/ai-interaction-qa.js'
import { normalizeVisibilityKey } from '../src/catalog/visibility.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 断言分九组，**判据的强弱不一样**，别混着读：
 *
 * | 组 | 锁的是什么 | 出处（判据） |
 * | --- | --- | --- |
 * | **B2 基准** | **无筛选时的列表请求与浏览器逐字段一致** | ⭐ `baseline/ai-interaction-qa.browser.json`（**实测**） |
 * | C 请求头 | 四页**不发** `module-type`、头逐键一致 | ⭐ 基准 `headers`（**实测**） |
 * | A 能力定义 | pagePath / 权限码 / write 标记 | `generated/page-catalog.json`（生成物） |
 * | B 请求层 | 本能力自己发出的 URL、方法、键序 | 页面源码 + `src/http/client.ts`（**推导**） |
 * | D 写链路 | 每个写操作的 method / URL / body 逐字节 | 页面源码 + 后端 controller（**推导**） |
 * | D2 预检 | 两个会读后端的 prepare 的读行为与告警 | 页面源码（**推导**） |
 * | E 本地校验 | 参数错时不发请求 | 页面的表单规则（**推导**） |
 * | F 载荷构造 | 预检与提交共用同一份实现 | 本文件（**内部一致性**） |
 * | G | 基准**也**判断不了的那几条 | `it.todo`，不硬编 |
 *
 * **B/D/D2/E 四组没有基准背书**：基准 14 条里 **0 条非 GET**（没人抓写请求），
 * 而且只抓了"挂载时那条无筛选请求" —— 三种 role 里**只出现 `getSysHotQuestion`**，
 * 也一个筛选值都没填。所以写链路、`user`/`mix` 两个角色、带筛选值的请求，
 * 全都**只有源码推导**。这些**没有被删掉**：它们锁的是"推导出来的形状没被手滑改掉"，
 * 红线是另一条（B2/C 才是与浏览器比的）。
 *
 * ⭐ **基准与源码推导没有冲突**：四条列表请求（含 `order=`/`orderField=` 两个空值、`_t` 在最后、
 * `pageSize=20`）、不发 `module-type`、`/manage/ai/**` 与 `/manager/**` 两个前缀族，
 * 全都推对了 —— 所以这四页**没有**需要标注「本地源码与线上不一致」的地方
 * （那 435 个提交的落后**没有**漏到这四页，与派单方的逐文件 diff 一致）。
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
    cap: createAiInteractionQaCapability(
      at(AI_INTERACTION_HOT_TOPICS_PAGE_PATH),
      at(AI_INTERACTION_CHAT_PAGE_PATH),
      at(AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH),
      at(AI_INTERACTION_FEEDBACK_PAGE_PATH),
    ),
  }
}

/** 适配器拿到的 `config.data` 已经是 axios `transformRequest` 之后的字符串 */
const bodyOf = (call: CapturedCall | undefined): string => String(call?.data ?? '')

/** axios 把请求头包成 `AxiosHeaders`，比之前摊平成普通对象 */
function headersOf (call: CapturedCall): Record<string, unknown> {
  const raw = call.headers as unknown as { toJSON?: () => Record<string, unknown> }
  return typeof raw?.toJSON === 'function' ? raw.toJSON() : (raw as unknown as Record<string, unknown>)
}

// ---------------------------------------------------------------------------
// B2. 浏览器基准（实测）
// ---------------------------------------------------------------------------

type BaselineRequest = {
  页面: string
  pagePath: string
  via: string
  method: string
  url: string
  headers: Record<string, string> | null
  body: unknown
}
type Baseline = { requests: BaselineRequest[] }

const BASE: Baseline = JSON.parse(
  readFileSync(join(here, '../baseline/ai-interaction-qa.browser.json'), 'utf8'),
) as Baseline

/**
 * 每页开头那两条**外壳请求**（门户框架每次路由都发，不是被比页发的）：
 * `org/sensitive/info` 与 `bpm/task/list-by-category`。它们各有 4 条（每页 1 条）。
 */
const SHELL_URL_PATTERNS = [/\/org\/sensitive\/info(\?|$)/, /\/bpm\/task\/list-by-category(\?|$)/]

/** 这一页**真正属于页面自己**的请求（去掉外壳那两条） */
function pageOwnRequests (pagePath: string): BaselineRequest[] {
  return BASE.requests.filter(
    (r) => r.pagePath === pagePath && !SHELL_URL_PATTERNS.some((p) => p.test(r.url)),
  )
}

/** 按页面 + URL 片段找基准行。⚠️ 会有**重复**（点一次「查询」重发一条只差 `_t` 的），所以只取第一条 */
function reqOf (pagePath: string, match: RegExp): BaselineRequest {
  const hit = BASE.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
  if (!hit) throw new Error(`基准里找不到 ${pagePath} 的 ${match}`)
  return hit
}

describe('B2. 四页的列表请求与浏览器基准**逐字段一致**（D20 / conventions 31）', () => {
  it('基准本身是干净的：14 条、只有 4 页、只有 GET、没有 module-type 头', () => {
    expect(BASE.requests).toHaveLength(14)
    expect(new Set(BASE.requests.map((r) => r.pagePath)).size).toBe(4)
    expect(new Set(BASE.requests.map((r) => r.method))).toEqual(new Set(['GET']))
    // ⭐ 硬证据（不再是"规则表推导"）：浏览器在这四页**一条 module-type 都没发**
    for (const request of BASE.requests) {
      expect(Object.keys(request.headers ?? {}), request.url).not.toContain('module-type')
      expect(Object.keys(request.headers ?? {}).sort()).toEqual(
        ['Accept', 'Accept-Language', 'tenant-id', 'token'],
      )
    }
    // 外壳请求恰好 8 条（4 页 × 2 条），页面自己的请求 6 条（敏感词与意见反馈各多一条重发）
    const shell = BASE.requests.filter((r) => SHELL_URL_PATTERNS.some((p) => p.test(r.url)))
    expect(shell).toHaveLength(8)
    expect(BASE.requests.length - shell.length).toBe(6)
  })

  it('热门问题（role 默认 system）：URL 与基准逐字段一致（含 order=/orderField= 两个空值）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    const base = reqOf(AI_INTERACTION_HOT_TOPICS_PAGE_PATH, /getSysHotQuestion/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(calls[0]?.method).toBe('get')
    // ⭐ conventions 4：即使全是空值，order/orderField 也照发
    expect(String(calls[0]?.url)).toContain('order=&orderField=')
  })

  it('交互历史：URL 与基准逐字段一致', async () => {
    const { calls, cap } = build()
    await cap.listChats()
    const base = reqOf(AI_INTERACTION_CHAT_PAGE_PATH, /getChatListByPage/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('敏感词：URL 与基准逐字段一致（基准里有**两条**只差 `_t` 的重发，取其一）', async () => {
    const { calls, cap } = build()
    await cap.listWhitelist()
    const base = reqOf(AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, /getWhitelistByPage/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    // 这一页在基准里被点了两次「查询」⇒ 同一条 URL 出现两遍，**不该**断言"只出现一次"
    const dup = pageOwnRequests(AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH).filter((r) => /getWhitelistByPage/.test(r.url))
    expect(dup).toHaveLength(2)
    expect(new Set(dup.map((r) => normalize(r.url))).size).toBe(1)
  })

  it('意见反馈：URL 与基准逐字段一致', async () => {
    const { calls, cap } = build()
    await cap.listFeedback()
    const base = reqOf(AI_INTERACTION_FEEDBACK_PAGE_PATH, /feedbackContent\/getByPage/)
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
  })

  it('⭐ 四页无筛选时的 query **逐字相同** —— 这条现在是基准证实的，不是推的', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    const mine = calls.map((c) => String(c.url).replace(/([?&]_t=)\d+/, '$1<ts>').split('?')[1])
    const base = [
      reqOf(AI_INTERACTION_HOT_TOPICS_PAGE_PATH, /getSysHotQuestion/),
      reqOf(AI_INTERACTION_CHAT_PAGE_PATH, /getChatListByPage/),
      reqOf(AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, /getWhitelistByPage/),
      reqOf(AI_INTERACTION_FEEDBACK_PAGE_PATH, /feedbackContent\/getByPage/),
    ].map((r) => r.url.split('?')[1])
    expect(mine).toEqual(base)
    expect(new Set(mine).size).toBe(1)
  })

  it('四页页面自己的请求**只有**那条列表请求（去重后各 1 条，没有第二个接口藏在里面）', () => {
    const expected: Array<[string, RegExp]> = [
      [AI_INTERACTION_HOT_TOPICS_PAGE_PATH, /^\/admin-api\/manage\/ai\/getSysHotQuestion\?/],
      [AI_INTERACTION_CHAT_PAGE_PATH, /^\/admin-api\/manage\/ai\/getChatListByPage\?/],
      [AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, /^\/admin-api\/manager\/sensitiveWordsWhitelist\/getWhitelistByPage\?/],
      [AI_INTERACTION_FEEDBACK_PAGE_PATH, /^\/admin-api\/manager\/feedbackContent\/getByPage\?/],
    ]
    for (const [pagePath, pattern] of expected) {
      const distinct = new Set(pageOwnRequests(pagePath).map((r) => normalize(r.url)))
      expect(distinct.size, pagePath).toBe(1)
      const only = [...distinct][0] ?? ''
      expect(only, pagePath).toMatch(pattern)
    }
  })

  it('⭐ 同域三个前缀族：`/manage/ai/**` 与 `/manager/**`（都经 platform 补成 `/admin-api`）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    const pages = [AI_INTERACTION_HOT_TOPICS_PAGE_PATH, AI_INTERACTION_CHAT_PAGE_PATH, AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, AI_INTERACTION_FEEDBACK_PAGE_PATH]
    for (const [index, pagePath] of pages.entries()) {
      const base = reqOf(pagePath, /get(SysHotQuestion|ChatListByPage|WhitelistByPage|ByPage)/)
      // 基准里的路径去掉 host 后与我发的一致（前缀族一一对上）
      expect(String(calls[index]?.url).split('?')[0], pagePath).toBe(
        normalize(base.url).split('?')[0],
      )
    }
    // 前缀族本身：/manage/ai/** 两条、/manager/** 两条
    expect(String(calls[0]?.url).startsWith('/admin-api/manage/ai/')).toBe(true)
    expect(String(calls[1]?.url).startsWith('/admin-api/manage/ai/')).toBe(true)
    expect(String(calls[2]?.url).startsWith('/admin-api/manager/')).toBe(true)
    expect(String(calls[3]?.url).startsWith('/admin-api/manager/')).toBe(true)
  })

  it('⭐ 四页的请求头都与基准**逐键一致**（4 个键，没有 module-type、没有多出来的头）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    // ⚠️ 四页**各自**比一遍：只比第一页的话，给另外三页加个头不会被发现
    // （反证时实测漏掉过一次：往 chatList 加 `X-extra` 全绿）
    const pages = [
      [AI_INTERACTION_HOT_TOPICS_PAGE_PATH, /getSysHotQuestion/],
      [AI_INTERACTION_CHAT_PAGE_PATH, /getChatListByPage/],
      [AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH, /getWhitelistByPage/],
      [AI_INTERACTION_FEEDBACK_PAGE_PATH, /feedbackContent\/getByPage/],
    ] as const
    for (const [index, [pagePath, pattern]] of pages.entries()) {
      const base = reqOf(pagePath, pattern)
      const mine = headersOf(calls[index] as CapturedCall)
      expect(Object.keys(mine).sort(), pagePath).toEqual(Object.keys(base.headers ?? {}).sort())
      expect(mine['tenant-id'], pagePath).toBe('1')
      expect(mine['tenant-id'], pagePath).toBe(base.headers?.['tenant-id'])
      expect(mine['Accept-Language'], pagePath).toBe(base.headers?.['Accept-Language'])
      expect(mine['Accept'], pagePath).toBe(base.headers?.['Accept'])
      expect(mine['module-type'], pagePath).toBeUndefined()
    }
  })

  it('⚠️ 基准里**没有** getMixedHotQuestion / getManualHotQuestion —— 那两个角色的参数仍无判据', () => {
    // 这条不是"跳过"，是把"基准的覆盖边界"钉下来：谁以后加断言时看得到它
    expect(BASE.requests.some((r) => /getMixedHotQuestion/.test(r.url))).toBe(false)
    expect(BASE.requests.some((r) => /getManualHotQuestion/.test(r.url))).toBe(false)
  })

  it('⚠️ 基准里**一条非 GET 都没有** ⇒ 写链路一条基准都没沾到', () => {
    expect(BASE.requests.filter((r) => r.method !== 'GET')).toEqual([])
    expect(BASE.requests.every((r) => r.body === null)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// A. 能力定义 ↔ generated/page-catalog.json
// ---------------------------------------------------------------------------

describe('A. 十四条能力定义与 page-catalog.json 对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string | null; permission: string; title: string }> }
  const byPath = new Map(
    catalog.items.filter((item) => item.menuPath !== null).map((item) => [item.menuPath as string, item]),
  )

  it('十四条定义的 pagePath 在目录里逐字存在（多一个字少一个字都要红）', () => {
    expect(aiInteractionQaCapabilities).toHaveLength(14)
    for (const capability of aiInteractionQaCapabilities) {
      expect(byPath.has(capability.pagePath), `${capability.id} 的 pagePath 不在目录里：${capability.pagePath}`).toBe(true)
    }
  })

  it('pagePath 只落在四页上，且四页各有过半的能力', () => {
    const counts = new Map<string, number>()
    for (const capability of aiInteractionQaCapabilities) {
      counts.set(capability.pagePath, (counts.get(capability.pagePath) ?? 0) + 1)
    }
    expect([...counts.keys()].sort()).toEqual([
      AI_INTERACTION_CHAT_PAGE_PATH,
      AI_INTERACTION_FEEDBACK_PAGE_PATH,
      AI_INTERACTION_HOT_TOPICS_PAGE_PATH,
      AI_INTERACTION_SENSITIVE_WORD_PAGE_PATH,
    ].sort())
  })

  it('能力 id 互不重复', () => {
    const ids = aiInteractionQaCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('只读能力一共 6 条（含那个用 POST 的试检），其余 8 条是写', () => {
    const reads = aiInteractionQaCapabilities.filter((c) => !c.write).map((c) => c.id)
    expect(reads.sort()).toEqual([
      'ai-interaction-chat-get',
      'ai-interaction-chat-list',
      'ai-interaction-feedback-list',
      'ai-interaction-hot-topics-list',
      'ai-interaction-sensitive-word-check',
      'ai-interaction-sensitive-word-list',
    ].sort())
    expect(aiInteractionQaCapabilities.filter((c) => c.write)).toHaveLength(8)
    // ⚠️ checkSensitiveWords 用的是 POST、名字里带 check，但它是**只读**的（后端只 findAll）
    expect(aiInteractionQaCapabilities.find((c) => c.id === 'ai-interaction-sensitive-word-check')?.write).toBe(false)
  })

  it('权限码与当前菜单目录逐字一致（均为 v2）', () => {
    for (const capability of aiInteractionQaCapabilities) {
      const entry = byPath.get(capability.pagePath)
      expect(entry, capability.id).toBeDefined()
      expect(capability.permission, capability.id).toBe(entry?.permission)
      expect(normalizeVisibilityKey(String(capability.permission)), capability.id).toBe(
        normalizeVisibilityKey(String(entry?.permission)),
      )
    }
  })

  it('能力定义里的权限码是当前生效的 **v2**', () => {
    expect(aiInteractionQaCapabilities.map((c) => c.permission)).toEqual([
      AI_INTERACTION_PERMISSIONS.hotTopics.v2,
      AI_INTERACTION_PERMISSIONS.hotTopics.v2,
      AI_INTERACTION_PERMISSIONS.hotTopics.v2,
      AI_INTERACTION_PERMISSIONS.hotTopics.v2,
      AI_INTERACTION_PERMISSIONS.chat.v2,
      AI_INTERACTION_PERMISSIONS.chat.v2,
      AI_INTERACTION_PERMISSIONS.chat.v2,
      AI_INTERACTION_PERMISSIONS.chat.v2,
      AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
      AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
      AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
      AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
      AI_INTERACTION_PERMISSIONS.sensitiveWord.v2,
      AI_INTERACTION_PERMISSIONS.feedback.v2,
    ])
    for (const capability of aiInteractionQaCapabilities) {
      expect(String(capability.permission)).toContain('/dashboard/platform-v2/')
    }
  })

  it('热门问题那个三选一角色被写成枚举（三种取值一个不少）', () => {
    const role = aiInteractionQaCapabilities
      .find((c) => c.id === 'ai-interaction-hot-topics-list')
      ?.params.find((p) => p.name === 'role')
    expect(role?.kind).toBe('enum')
    expect(role?.options?.map((o) => o.value)).toEqual(['system', 'user', 'mix'])
  })
})

// ---------------------------------------------------------------------------
// B. 请求层（源码推导，**不是**基准）
// ---------------------------------------------------------------------------

describe('B. 列表请求的 URL / 方法 / 键序（源码推导，等基准复核）', () => {
  it('无筛选时只发 order/orderField/pageNo/pageSize（null 被 qs 的 skipNulls 丢掉）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    expect(normalize(String(calls[0]?.url))).toBe(
      `/admin-api${HOT_QUESTION_LIST_PATHS.system}?order=&orderField=&pageNo=1&pageSize=20&_t=<ts>`,
    )
    expect(calls[0]?.method).toBe('get')
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
  })

  it('role 三选一切三个端点，参数形状**完全一样**（pageNo/pageSize 三种角色都发）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions({ role: 'system' })
    await cap.listHotQuestions({ role: 'user' })
    await cap.listHotQuestions({ role: 'mix' })
    // ⚠️ 这里写**字面量**、不写 HOT_QUESTION_LIST_PATHS —— 拿实现自己的常量比实现，
    // 常量被改名时两边一起变，测试看不出来（反证时实测漏掉过一次）。
    expect(calls.map((c) => String(c.url).split('?')[0])).toEqual([
      '/admin-api/manage/ai/getSysHotQuestion',
      '/admin-api/manage/ai/getManualHotQuestion',
      '/admin-api/manage/ai/getMixedHotQuestion',
    ])
    for (const call of calls) {
      expect(keysOf(String(call.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    }
    // 常量与这三个字面量必须对得上（哪个被改了都要红）
    expect(HOT_QUESTION_LIST_PATHS).toEqual({
      system: '/manage/ai/getSysHotQuestion',
      user: '/manage/ai/getManualHotQuestion',
      mix: '/manage/ai/getMixedHotQuestion',
    })
  })

  it('十四个接口路径的字面量（源码推导）—— 路径被改一个字就要红', async () => {
    const { calls, cap } = build()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    expect(calls.map((c) => String(c.url).split('?')[0])).toEqual([
      '/admin-api/manage/ai/getChatListByPage',
      '/admin-api/manager/sensitiveWordsWhitelist/getWhitelistByPage',
      '/admin-api/manager/feedbackContent/getByPage',
    ])
    await cap.createHotQuestion({ sort: 1, question: 'x' })
    await cap.updateHotQuestion({ id: 1, sort: 1, question: 'x' })
    await cap.removeHotQuestions(1)
    await cap.setChatDisplay(1, 1)
    await cap.convertChatToHot({ id: 1, sort: 1 })
    await cap.createWhitelistWord({ word: 'x' })
    await cap.updateWhitelistWord({ id: 1, word: 'x' })
    await cap.removeWhitelistWords(1)
    await cap.checkSensitiveWords('x')
    expect(calls.slice(3).map((c) => String(c.url))).toEqual([
      '/admin-api/manage/ai/addHotQuestion',
      '/admin-api/manage/ai/updateHotQuestion',
      '/admin-api/manage/ai/logicalDelete',
      '/admin-api/manage/ai/updateChatInfo',
      '/admin-api/manage/ai/convertHotQuestion',
      '/admin-api/manager/sensitiveWordsWhitelist/add',
      '/admin-api/manager/sensitiveWordsWhitelist/update',
      '/admin-api/manager/sensitiveWordsWhitelist/delete',
      '/admin-api/manager/sensitiveWordsWhitelist/checkSensitiveWords',
    ])
  })

  it('role 默认 system；非法 role 当场 reject 且**一个请求都不发**', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    expect(String(calls[0]?.url)).toContain(HOT_QUESTION_LIST_PATHS.system)
    await expect(cap.listHotQuestions({ role: 'bogus' as never })).rejects.toThrow(/role/)
    expect(calls).toHaveLength(1)
  })

  it('传了筛选值就插回**原来的位置**（question/createName 在 orderField 之后）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions({ question: '蛋鸡', createName: '张三' })
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order', 'orderField', 'question', 'createName', 'pageNo', 'pageSize', '_t',
    ])
  })

  it('⚠️ 日期区间排在 pageNo/pageSize **之后**（页面是 omit 掉 date 再追加两端）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions({ startInputTime: '2026-09-01 00:00:00', endInputTime: '2026-09-21 23:59:59' })
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order', 'orderField', 'pageNo', 'pageSize', 'startInputTime', 'endInputTime', '_t',
    ])
    // ⚠️ `qs.stringify`（页面与 SDK 用的是同一个）把空格编成 **%20**，不是 `+`
    expect(String(calls[0]?.url)).toContain('startInputTime=2026-09-01%2000%3A00%3A00')
  })

  it('交互历史：没传值的筛选位**整项不出现**，剩下的仍按声明顺序排（date 被 omit，status 顶上来）', async () => {
    const { calls, cap } = build()
    await cap.listChats()
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    await cap.listChats({ status: 1, display: 0, isHot: 0, platform: 'APP' })
    // 声明顺序是 platform, isHot, question, nickname, userName, phone, answer, display, status
    // —— 没传的那五个（question/nickname/userName/phone/answer）是 null，被 qs 丢掉，
    //    但**剩下的相对顺序不变**：platform 仍排在这五个的位置之前、display/status 之后
    expect(keysOf(String(calls[1]?.url))).toEqual([
      'order', 'orderField', 'platform', 'isHot', 'display', 'status', 'pageNo', 'pageSize', '_t',
    ])
  })

  it('⚠️ `0` 与 `-1` 是**有效值**，不能被当成空值丢掉（isHot=0 / display=0 / status=-1 都照发）', async () => {
    const { calls, cap } = build()
    await cap.listChats({ isHot: 0, display: 0, status: -1 })
    const url = String(calls[0]?.url)
    expect(url).toContain('isHot=0')
    expect(url).toContain('display=0')
    expect(url).toContain('status=-1')
  })

  it('交互历史的日期字段是 startDate/endDate，同样排在分页之后', async () => {
    const { calls, cap } = build()
    await cap.listChats({ startDate: '2026-09-01 00:00:00', endDate: '2026-09-21 23:59:59' })
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order', 'orderField', 'pageNo', 'pageSize', 'startDate', 'endDate', '_t',
    ])
  })

  it('敏感词：question/answer 两个**没有表单项**的键被 omit 掉，只剩 word', async () => {
    const { calls, cap } = build()
    await cap.listWhitelist()
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    await cap.listWhitelist({ word: '蛋鸡' })
    const url = String(calls[1]?.url)
    expect(keysOf(url)).toEqual(['order', 'orderField', 'word', 'pageNo', 'pageSize', '_t'])
    expect(url).not.toContain('question=')
    expect(url).not.toContain('answer=')
  })

  it('意见反馈：键序是 nickname → userName → phone → 分页 → startTime/endTime', async () => {
    const { calls, cap } = build()
    await cap.listFeedback()
    expect(keysOf(String(calls[0]?.url))).toEqual(['order', 'orderField', 'pageNo', 'pageSize', '_t'])
    await cap.listFeedback({ nickname: '小', userName: '张', phone: '138', startTime: 'a', endTime: 'b' })
    expect(keysOf(String(calls[1]?.url))).toEqual([
      'order', 'orderField', 'nickname', 'userName', 'phone', 'pageNo', 'pageSize',
      'startTime', 'endTime', '_t',
    ])
  })

  it('四页无筛选时的 query 串**逐字相同**（都是同一份 qs + 同一组 null 初值）', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    const queries = calls.map((c) => String(c.url).replace(/([?&]_t=)\d+/, '$1<ts>').split('?')[1])
    expect(new Set(queries).size).toBe(1)
    expect(queries[0]).toBe(`order=&orderField=&pageNo=1&pageSize=20&_t=<ts>`)
  })

  it('分页可改：pageNo/pageSize 传值后进 URL；默认每页 20', async () => {
    const { calls, cap } = build()
    expect(DEFAULT_PAGE_SIZE).toBe(20)
    await cap.listFeedback({ pageNo: 3, pageSize: 50 })
    expect(String(calls[0]?.url)).toContain('pageNo=3&pageSize=50')
  })

  it('返回值原样透传 {list, total}（不做字段裁剪）', async () => {
    const { cap } = build(() => ({ list: [{ id: 7, question: '蛋鸡' }], total: 42 }))
    const page = await cap.listHotQuestions()
    expect(page.total).toBe(42)
    expect(page.list).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// C. 请求头：module-type **不发**
// ---------------------------------------------------------------------------

describe('C. 这四个页面**不发** module-type（conventions 第 2 条 / D34）', () => {
  it('请求配置上没有 moduleType，头上也没有 module-type', async () => {
    const { calls, cap } = build()
    await cap.listHotQuestions()
    await cap.listChats()
    await cap.listWhitelist()
    await cap.listFeedback()
    expect(calls).toHaveLength(4)
    for (const call of calls) {
      expect(call.moduleType).toBeUndefined()
      expect((call.headers as unknown as Record<string, unknown>)['module-type']).toBeUndefined()
    }
  })

  it('写请求同样不带（写能力与读能力用的是同一个页面上下文）', async () => {
    const { calls, cap } = build()
    await cap.createHotQuestion({ sort: 3, question: 'SDK-TEST-测试' })
    expect(calls[0]?.moduleType).toBeUndefined()
    expect((calls[0]?.headers as unknown as Record<string, unknown>)['module-type']).toBeUndefined()
  })

  it('走的是 platform 实例（`/manage/ai/...` 被补成 `/admin-api/manage/ai/...`）', async () => {
    const { calls, cap } = build()
    await cap.listWhitelist()
    expect(String(calls[0]?.url)).toMatch(/^\/admin-api\/manager\/sensitiveWordsWhitelist\//)
  })
})

// ---------------------------------------------------------------------------
// D. 写链路：method / URL / body 逐字节
// ---------------------------------------------------------------------------

describe('D. 写链路（method / URL / body 逐字节 —— 源码 + 后端 controller 推出，等基准复核）', () => {
  it('新增热门问题：POST /admin-api/manage/ai/addHotQuestion，body 带 id:null', async () => {
    const { calls, cap } = build()
    const prepared = await cap.prepareCreateHotQuestion({ sort: 3, question: 'SDK-TEST-热门问题' })
    expect(prepared.payload).toEqual({ id: null, sort: 3, question: 'SDK-TEST-热门问题' })
    await cap.createHotQuestion({ sort: 3, question: 'SDK-TEST-热门问题' })
    expect(calls[0]?.method).toBe('post')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/addHotQuestion')
    // 键序是 body 的一部分：页面发的是 pick(form,['id','sort','question'])
    expect(bodyOf(calls[0])).toBe('{"id":null,"sort":3,"question":"SDK-TEST-热门问题"}')
  })

  it('⚠️ sort 在页面上是 `a-input type="number"` ⇒ 传字符串就按字符串发', async () => {
    const { calls, cap } = build()
    await cap.createHotQuestion({ sort: '7', question: 'x' })
    expect(bodyOf(calls[0])).toBe('{"id":null,"sort":"7","question":"x"}')
  })

  it('修改热门问题：POST updateHotQuestion，body {id,sort,question}', async () => {
    const { calls, cap } = build()
    await cap.updateHotQuestion({ id: 12, sort: 5, question: '改过的' })
    expect(calls[0]?.method).toBe('post')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/updateHotQuestion')
    expect(bodyOf(calls[0])).toBe('{"id":12,"sort":5,"question":"改过的"}')
  })

  it('删除热门问题 / 撤销新增：DELETE logicalDelete，body 是 JSON **数组**', async () => {
    const { calls, cap } = build()
    await cap.cancelCreatedHotQuestion(31)
    expect(calls[0]?.method).toBe('delete')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/logicalDelete')
    expect(bodyOf(calls[0])).toBe('[31]')
    await cap.removeHotQuestions([31, 32])
    expect(bodyOf(calls[1])).toBe('[31,32]')
  })

  it('改显示：PUT updateChatInfo，body 是**目标值**不是 toggle', async () => {
    const { calls, cap } = build()
    await cap.setChatDisplay(99, 0)
    expect(calls[0]?.method).toBe('put')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/updateChatInfo')
    expect(bodyOf(calls[0])).toBe('{"id":99,"display":0}')
  })

  it('转为热门：POST convertHotQuestion，body 只有 {id,sort}（**没有** question）', async () => {
    const { calls, cap } = build()
    await cap.convertChatToHot({ id: 77, sort: 2 })
    expect(calls[0]?.method).toBe('post')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/convertHotQuestion')
    expect(bodyOf(calls[0])).toBe('{"id":77,"sort":2}')
  })

  it('撤销「转为热门」打的就是那条逻辑删除（后端顺带把问答的 is_hot 改回 0）', async () => {
    const { calls, cap } = build()
    await cap.cancelConvertedHotQuestion(55)
    expect(calls[0]?.method).toBe('delete')
    expect(String(calls[0]?.url)).toBe('/admin-api/manage/ai/logicalDelete')
    expect(bodyOf(calls[0])).toBe('[55]')
  })

  it('新增白名单：POST add，body {id:null,word}', async () => {
    const { calls, cap } = build()
    await cap.createWhitelistWord({ word: 'SDK-TEST-白名单' })
    expect(calls[0]?.method).toBe('post')
    expect(String(calls[0]?.url)).toBe('/admin-api/manager/sensitiveWordsWhitelist/add')
    expect(bodyOf(calls[0])).toBe('{"id":null,"word":"SDK-TEST-白名单"}')
  })

  it('修改白名单：PUT update，body {id,word}', async () => {
    const { calls, cap } = build()
    await cap.updateWhitelistWord({ id: 8, word: 'SDK-TEST-白名单-改' })
    expect(calls[0]?.method).toBe('put')
    expect(String(calls[0]?.url)).toBe('/admin-api/manager/sensitiveWordsWhitelist/update')
    expect(bodyOf(calls[0])).toBe('{"id":8,"word":"SDK-TEST-白名单-改"}')
  })

  it('删除白名单（**物理删除**）：DELETE delete，body 是 JSON 数组', async () => {
    const { calls, cap } = build()
    await cap.removeWhitelistWords(8)
    expect(calls[0]?.method).toBe('delete')
    expect(String(calls[0]?.url)).toBe('/admin-api/manager/sensitiveWordsWhitelist/delete')
    expect(bodyOf(calls[0])).toBe('[8]')
  })

  it('⚠️ 试检敏感词：POST checkSensitiveWords（**只读**，不进列表能力）', async () => {
    const { calls, cap } = build(() => ['傻', '笨'])
    const hits = await cap.checkSensitiveWords('你这只傻蛋鸡真笨')
    expect(calls[0]?.method).toBe('post')
    expect(String(calls[0]?.url)).toBe('/admin-api/manager/sensitiveWordsWhitelist/checkSensitiveWords')
    expect(bodyOf(calls[0])).toBe('{"word":"你这只傻蛋鸡真笨"}')
    expect(hits).toEqual(['傻', '笨'])
    // 后端返回非数组时降级成空数组（不抛），避免调用方拿到 undefined 去 .map
    const { cap: cap2 } = build(() => null)
    await expect(cap2.checkSensitiveWords('x')).resolves.toEqual([])
  })
})

// ---------------------------------------------------------------------------
// D2. 两个真的会读后端的预检
// ---------------------------------------------------------------------------

describe('D2. prepare 里两个**真的读一次后端**的预检', () => {
  it('prepareSetChatDisplay：先按 id 读那一行（pageSize=1），返回当前 display 供撤销', async () => {
    const { calls, cap } = build(() => ({ list: [{ id: 99, display: 1, question: '蛋鸡' }], total: 1 }))
    const prepared = await cap.prepareSetChatDisplay(99, 0)
    expect(calls[0]?.method).toBe('get')
    expect(String(calls[0]?.url)).toContain('/admin-api/manage/ai/getChatListByPage?')
    expect(String(calls[0]?.url)).toContain('pageSize=1')
    expect(String(calls[0]?.url)).toContain('id=99')
    expect(prepared.payload).toEqual({ id: 99, display: 0 })
    expect(prepared.currentDisplay).toBe(1)
    // 读完之后**没有**任何写请求 —— 预检是只读的
    expect(calls).toHaveLength(1)
  })

  it('prepareConvertChatToHot：已热门的行给出一条 warning（后端 saveInfo 不去重）', async () => {
    const { calls, cap } = build(() => ({ list: [{ id: 77, isHot: 1, question: '蛋鸡' }], total: 1 }))
    const prepared = await cap.prepareConvertChatToHot({ id: 77, sort: 2 })
    expect(prepared.alreadyHot).toBe(true)
    expect(prepared.warnings).toHaveLength(1)
    expect(prepared.warnings[0]).toMatch(/不做去重/)
    expect(prepared.payload).toEqual({ id: 77, sort: 2 })
    expect(calls).toHaveLength(1)
  })

  it('未热门的行没有 warning', async () => {
    const { cap } = build(() => ({ list: [{ id: 77, isHot: 0 }], total: 1 }))
    const prepared = await cap.prepareConvertChatToHot({ id: 77, sort: 2 })
    expect(prepared.alreadyHot).toBe(false)
    expect(prepared.warnings).toEqual([])
  })

  it('getChatRow 查不到时抛（并说清这个查询是页面从不发的那一条）', async () => {
    const { calls, cap } = build()
    await expect(cap.getChatRow(123)).rejects.toThrow(/找不到 id=123/)
    expect(calls).toHaveLength(1)
    expect(String(calls[0]?.url)).toContain('pageSize=1')
  })

  it('⚠️ 预检里的本地校验先于请求：sort 非法时**不读也不写**', async () => {
    const { calls, cap } = build()
    await expect(cap.prepareConvertChatToHot({ id: 77, sort: 0 })).rejects.toThrow(/sort/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// E. 本地校验（页面的表单规则）—— 错的时候一个请求都不该发
// ---------------------------------------------------------------------------

describe('E. 参数校验：错了就 reject，**不发请求**', () => {
  it('sort 必须 ≥ 1 的整数（页面的 validator）', async () => {
    const { calls, cap } = build()
    await expect(cap.createHotQuestion({ sort: 0, question: 'x' })).rejects.toThrow(/sort/)
    await expect(cap.createHotQuestion({ sort: '1.5', question: 'x' })).rejects.toThrow(/sort/)
    await expect(cap.createHotQuestion({ sort: '', question: 'x' })).rejects.toThrow(/sort/)
    await expect(cap.createHotQuestion({ sort: Number.NaN, question: 'x' })).rejects.toThrow(/sort/)
    await expect(cap.convertChatToHot({ id: 1, sort: -3 })).rejects.toThrow(/sort/)
    expect(calls).toHaveLength(0)
    // 边界：1 是合法的
    await cap.createHotQuestion({ sort: 1, question: 'x' })
    expect(calls).toHaveLength(1)
  })

  it('question / word 必填且 ≤ 50 字（页面的 `max: 50`），**原样发不 trim**', async () => {
    const { calls, cap } = build()
    await expect(cap.createHotQuestion({ sort: 1, question: '   ' })).rejects.toThrow(/必填/)
    await expect(cap.createHotQuestion({ sort: 1, question: 'a'.repeat(TEXT_MAX_LENGTH + 1) })).rejects.toThrow(/50/)
    await expect(cap.createWhitelistWord({ word: '' })).rejects.toThrow(/必填/)
    await expect(cap.updateWhitelistWord({ id: 1, word: 'a'.repeat(TEXT_MAX_LENGTH + 1) })).rejects.toThrow(/50/)
    expect(calls).toHaveLength(0)
    // 50 字正好合法；两端的空格**照发**（页面不 trim）
    await cap.createHotQuestion({ sort: 1, question: ` ${'a'.repeat(TEXT_MAX_LENGTH - 2)} ` })
    expect(bodyOf(calls[0])).toContain('"question":" ')
  })

  it('display 只能是 0 / 1，且**不做 toggle**', async () => {
    const { calls, cap } = build()
    await expect(cap.setChatDisplay(1, 2)).rejects.toThrow(/display/)
    await expect(cap.setChatDisplay(1, '1' as never)).rejects.toThrow(/display/)
    await expect(cap.setChatDisplay(1, undefined)).rejects.toThrow(/display/)
    expect(calls).toHaveLength(0)
    expect(buildSetChatDisplayPayload(5, 0)).toEqual({ id: 5, display: 0 })
  })

  it('id 为空 / NaN 当场拒绝', async () => {
    const { calls, cap } = build()
    await expect(cap.setChatDisplay('   ', 1)).rejects.toThrow(/不能为空/)
    await expect(cap.getChatRow(Number.NaN)).rejects.toThrow(/有限数字/)
    await expect(cap.removeHotQuestions([])).rejects.toThrow(/至少需要一个 id/)
    await expect(cap.removeWhitelistWords([])).rejects.toThrow(/至少需要一个 id/)
    expect(calls).toHaveLength(0)
  })

  it('checkSensitiveWords 的入参是**待检文本**，空文本拒绝（不是"查某个词"）', async () => {
    const { calls, cap } = build()
    await expect(cap.checkSensitiveWords('')).rejects.toThrow(/必填/)
    expect(calls).toHaveLength(0)
  })

  it('校验失败走 **Promise.reject**（不是同步抛），调用方 await 时才接得住', () => {
    const { cap } = build()
    const pending = cap.listHotQuestions({ role: 'nope' as never })
    expect(pending).toBeInstanceOf(Promise)
    return expect(pending).rejects.toThrow(/role/)
  })
})

// ---------------------------------------------------------------------------
// F. 载荷构造是纯函数（写操作与预检共用同一份，不会分叉）
// ---------------------------------------------------------------------------

describe('F. 载荷构造：预检与提交共用同一份实现', () => {
  it('buildHotQuestionCreatePayload 总是带 id:null（页面 pick 出来的形状）', () => {
    expect(buildHotQuestionCreatePayload({ sort: 4, question: 'q' })).toEqual({ id: null, sort: 4, question: 'q' })
    expect(Object.keys(buildHotQuestionCreatePayload({ sort: 4, question: 'q' }))).toEqual(['id', 'sort', 'question'])
  })

  it('prepare 返回的 payload 与 submit 实际发的 body **逐字节相同**', async () => {
    const { calls, cap } = build()
    const prepared = await cap.prepareCreateHotQuestion({ sort: 9, question: '一致的' })
    await cap.createHotQuestion({ sort: 9, question: '一致的' })
    expect(bodyOf(calls[0])).toBe(JSON.stringify(prepared.payload))
  })

  it('prepare 的参数错误走 **Promise.reject**（不是同步抛），且不发请求', async () => {
    const { calls, cap } = build()
    const pending = cap.prepareCreateHotQuestion({ sort: 0, question: 'x' })
    expect(pending).toBeInstanceOf(Promise)
    await expect(pending).rejects.toThrow(/sort/)
    await expect(cap.prepareUpdateHotQuestion({ id: 1, sort: 0, question: 'x' })).rejects.toThrow(/sort/)
    await expect(cap.prepareUpdateWhitelistWord({ id: 1, word: '' })).rejects.toThrow(/必填/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// G. 等基准才能写的断言
// ---------------------------------------------------------------------------

describe('G. 基准**也**判断不了的那几条（留着，别硬编）', () => {
  /**
   * 第一批 todo 已经被 `baseline/ai-interaction-qa.browser.json` 兑现并落成真断言了
   * （见上面的 B2 组）：四页无筛选 URL 逐字段、键序与 `_t` 位置、空值"整项不出现"、
   * 不发 `module-type`、头逐键一致。**剩下的这五条仍然没有判据** ——
   * 基准只覆盖"每页挂载时那一条无筛选 GET"。
   */
  it.todo(
    '`user`（人工）/ `mix`（预览）两个角色的参数 —— ⚠️ 基准里**没有** getMixedHotQuestion/' +
      'getManualHotQuestion（页面上没人切过那个 a-segmented）。' +
      '所以"mix 到底带不带 pageNo/pageSize"仍然只有源码推导，别拿 getSysHotQuestion 那条当它',
  )
  it.todo('带筛选值的请求形状（question= / isHot=0 / display=0 / status=-1 / 日期区间的落点）—— 基准只抓了"挂载时无筛选"那一条')
  it.todo('写请求的 method / URL / body —— 基准 14 条里 **0 条非 GET**（没人抓过写）')
  it.todo('`getChatRow` 的 `params.id` 分支真机上是否真取回那一行（基准那条 getChatListByPage 没带 id）')
  it.todo('真机写验证（prepare → submit → cancel 的实际请求/响应）—— 这一单未授权，见四份文档的「真实验证」一节')
})
