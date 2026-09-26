/**
 * 批量生成器（`tools/generate/batch-capabilities.mjs` + `src/capabilities/generated/**`）。
 *
 * 这份测试要守住的是**"463 个可以批量"这个结论到底站不站得住**，不是"生成器能跑"：
 *
 * - 生成物**可重复**（同输入跑两次逐字节一致），且磁盘上没有过期
 * - 抽出来的**接口路径与查询参数与浏览器真实请求一致** —— 断言的期望值取自
 *   `baseline/*.browser.json` 与 2026-09-20 用 bsk 实测的 URL，不是从生成器自己推的
 * - 抽不出来的页面**如实缺席**，不编一个路径顶上
 * - 判定口径分得开：`auto` 的契约必须是完整的；`partial` / `failed` 必须能被报出来
 *
 * 锚点写的是**具体路径**，Portal 发版改了页面它们会红——那时该做的是重跑生成器并
 * 重新去浏览器验一次，不是改断言。
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import axios, { type AxiosInstance, type InternalAxiosRequestConfig } from 'axios'
import qs from 'qs'
import { afterEach, describe, expect, it } from 'vitest'

import { createPortalHeadless } from '../src/index.js'
import { ALL_CAPABILITY_DEFINITIONS } from '../src/capabilities/index.js'
import type { PortalRequestConfig } from '../src/http/client.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import {
  BATCH_CAPABILITIES,
  BATCH_ENDPOINTS,
  BATCH_GENERATED_META,
  BATCH_IN_SCOPE_CAPABILITIES,
  BATCH_OUT_OF_SCOPE_CAPABILITIES,
  BATCH_SDK_CAPABILITIES,
  batchMethodName,
  createBatchCapabilityHost,
  createBatchListCapability,
  type BatchEndpoint,
} from '../src/capabilities/generated/index.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const GENERATOR = join(PKG_ROOT, 'tools/generate/batch-capabilities.mjs')
const GENERATED_DIR = join(PKG_ROOT, 'src/capabilities/generated')
/**
 * 取「全量外推」那一节。
 *
 * ⚠️ 键名里的页数是**算出来的**（`全量外推（${页数} 个声明式列表页同一条代码路径）`），
 * 会随清单变（2026-09-21：255 → 241）。所以类型里不写死这个键，靠这个函数按前缀取，
 * 取不到就当场抛 —— 免得写死的键名在清单变了之后变成一句假话还不知道。
 */
type Extrapolation = {
  total: number
  auto: number
  partial: number
  failed: number
  partialKind: Record<string, number>
}

function extrapolationOf (report: BatchReport): Extrapolation {
  const key = Object.keys(report).find((k) => k.startsWith('全量外推（'))
  if (key === undefined) throw new Error('报告里没有「全量外推」那一节')
  return (report as unknown as Record<string, Extrapolation>)[key]!
}

const OUTPUT_FILES = ['batch-capabilities.ts', 'index.ts', 'batch-report.json'] as const
const PAGE_CATALOG = join(PKG_ROOT, 'generated/page-catalog.json')
const originalAdapter = axios.defaults.adapter
afterEach(() => { axios.defaults.adapter = originalAdapter })
type RequestConfig = PortalRequestConfig

type BatchReport = {
  抽样页数: number
  抽样判定: { total: number; auto: number; partial: number; failed: number; partialKind: Record<string, number> }

  非自动样本明细: Array<{
    pagePath: string
    verdict: string
    partialKind?: string
    rawUrl: string | null
    resolvedPath: string | null
    issues: string[]
  }>
  抽样依据: Array<{ pagePath: string; stratum: string }>
  浏览器实测核对: {
    核对页数: number
    一致页数: number
    明细: Array<{ pagePath: string; note: string; 浏览器发出的: string; 按生成契约还原的: string; 一致: boolean }>
  }
}

/** 跑一次生成器，写到独立的临时目录（不碰 src/） */
function runGenerator (): { dir: string; files: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'ph-batch-'))
  execFileSync(process.execPath, [GENERATOR], {
    cwd: PKG_ROOT,
    env: { ...process.env, BATCH_OUT_DIR: dir },
    stdio: 'pipe',
  })
  const files: Record<string, string> = {}
  for (const name of readdirSync(dir)) files[name] = readFileSync(join(dir, name), 'utf8')
  return { dir, files }
}

let cachedRun: ReturnType<typeof runGenerator> | null = null
function firstRun (): ReturnType<typeof runGenerator> {
  if (!cachedRun) cachedRun = runGenerator()
  return cachedRun
}

function readReport (): BatchReport {
  return JSON.parse(readFileSync(join(GENERATED_DIR, 'batch-report.json'), 'utf8')) as BatchReport
}

function endpoint (pagePath: string): BatchEndpoint {
  const found = Object.values(BATCH_ENDPOINTS).find((e) => e.pagePath === pagePath)
  if (!found) throw new Error(`生成物里没有 ${pagePath} 的契约（它被判成 failed 了？）`)
  return found
}

/**
 * 按 SDK 真实拼装顺序还原一次请求的 query：
 * inline query 先合并 → `endpoint.query` 逐项（未传就取默认值）→ qs 序列化（skipNulls）。
 *
 * `_t` 不参与比对：它是 platform.js 的防缓存时间戳，位置在不同 http 模块下不一样，
 * 且 SDK 自己会加（`src/http/client.ts`），与契约正确性无关。
 */
function serializeQuery (e: BatchEndpoint): string {
  const params: Record<string, unknown> = {}
  for (const item of e.staticQuery) params[item.name] = item.defaultValue
  for (const item of e.query) params[item.name] = item.defaultValue
  return qs.stringify(params, { allowDots: true, skipNulls: true })
}

/** 在线 query 参数名顺序（丢掉 null/undefined/空数组之后），用于逐字段一致比对 */
function orderedParamNames (e: BatchEndpoint): string[] {
  const names: string[] = []
  const all = [...e.staticQuery, ...e.query]
  for (const item of all) {
    if (item.defaultValue === null || item.defaultValue === undefined) continue
    if (Array.isArray(item.defaultValue) && item.defaultValue.length === 0) continue
    names.push(item.name)
  }
  return names
}

/** 从浏览器实测 URL 里取 query 参数名顺序（去掉 _t） */
function browserParamNames (url: string): string[] {
  const query = url.split('?')[1]
  if (!query) return []
  return query
    .split('&')
    .map((pair) => pair.split('=')[0] ?? '')
    .filter((name) => name !== '' && name !== '_t')
    .map((name) => decodeURIComponent(name))
}

// ---------------------------------------------------------------------------
// 0. 生成器本身
// ---------------------------------------------------------------------------

describe('批量生成器：可重复、不过期', () => {
  it('同一输入跑两次，三份生成物逐字节一致（幂等）', () => {
    const a = runGenerator()
    const b = runGenerator()
    for (const name of OUTPUT_FILES) {
      expect(a.files[name], `${name} 两次生成不一致`).toBe(b.files[name])
    }
    expect(Object.keys(a.files).sort()).toEqual([...OUTPUT_FILES].sort())
  })

  it('磁盘上的生成物就是生成器现在的产出（没有手改、没有过期）', () => {
    const fresh = firstRun()
    for (const name of OUTPUT_FILES) {
      const onDisk = readFileSync(join(GENERATED_DIR, name), 'utf8')
      expect(onDisk, `${name} 与重跑结果不一致：请重跑 node tools/generate/batch-capabilities.mjs`).toBe(fresh.files[name])
    }
  })

  it('新鲜度判据是内容哈希而不是时间戳（目录只是重跑了一次，产物必须逐字节不变）', () => {
    const fresh = firstRun()
    const content = fresh.files['batch-capabilities.ts'] ?? ''
    const catalog = JSON.parse(readFileSync(PAGE_CATALOG, 'utf8')) as { generatedAt: string }

    // 这条是**反证式**的：只要有人把目录的 generatedAt 写回产物，产物就会因为
    // 「有人重跑了一次 pnpm generate」而变化——2026-09-20 过夜实测踩到过
    // （conventions 第 23 条：新鲜度判据是内容哈希，不是时间戳）。
    // 它比被它替掉的那条断言更严：旧那条要求时间戳**在**产物里，锁的正是这个缺陷。
    expect(content).not.toContain(catalog.generatedAt)
    // 真正的两个新鲜度信号：接口快照的哈希 + 目录内容的哈希（都不含时间戳）
    expect(content).toContain(BATCH_GENERATED_META.contentHash)
    expect(content).toContain(BATCH_GENERATED_META.catalogContentHash)
    expect(BATCH_GENERATED_META.catalogContentHash).toMatch(/^[0-9a-f]{12}$/)
  })
})

// ---------------------------------------------------------------------------
// 1. 锚点：路径与参数必须一字不差
// ---------------------------------------------------------------------------

describe('锚点：抽出来的接口路径与参数', () => {
  it('绝对 /admin-api 路径原样保留，分页是 pageNo + pageSize', () => {
    const e = endpoint('/dashboard/org/org-propType/list')
    expect(e.url).toBe('/admin-api/hr/org/organizationProperty/page')
    expect(e.resolvedPath).toBe('/admin-api/hr/org/organizationProperty/page')
    expect(e.baseUrlEnv).toBe('VITE_ZHDJ_PLATFORM_API')
    expect(e.httpModule).toBe('platform.js')
    expect(e.pageParam).toBe('pageNo')
    expect(e.sizeParam).toBe('pageSize')
    expect(orderedParamNames(e)).toEqual(['order', 'orderField', 'name', 'pageNo', 'pageSize'])
    expect(e.verdict).toBe('auto')
  })

  it('相对路径 /org/... 补上 /admin-api 前缀（platform.js 的拦截器规则）', () => {
    const e = endpoint('/dashboard/attendance/attendance-sheet/list')
    expect(e.url).toBe('/org/hrAttendanceSheet/page')
    expect(e.resolvedPath).toBe('/admin-api/org/hrAttendanceSheet/page')
    expect(e.verdict).toBe('auto')
  })

  it('/mall-manage-api 与 /adminmanage-api 前缀透传，不会再套一层 /admin-api', () => {
    const mall = endpoint('/dashboard/platform/activity/monitor/list')
    expect(mall.resolvedPath).toBe('/mall-manage-api/sys/coupon/page')

    const dict = endpoint('/dashboard/platform/setting/category-dict/list')
    expect(dict.resolvedPath).toBe('/adminmanage-api/system/category-dict/tree')
  })

  it('模板串 URL 里的文件内常量能解出来', () => {
    // 源码：getDataListURL: `${categoryDictApiPrefix}/system/category-dict/tree`
    //       const categoryDictApiPrefix = '/adminmanage-api'
    expect(endpoint('/dashboard/platform/setting/category-dict/list').url)
      .toBe('/adminmanage-api/system/category-dict/tree')
  })

  it('getDataListIsPage 缺省/为 false 时不编造分页参数', () => {
    const dict = endpoint('/dashboard/platform/setting/category-dict/list')
    expect(dict.pageParam).toBeNull()
    expect(dict.sizeParam).toBeNull()
    expect(orderedParamNames(dict)).not.toContain('pageNo')
    expect(orderedParamNames(dict)).not.toContain('pageSize')
  })

  it('URL 自带 query string 时，那段 query 单独记下来（不混进 form 字段）', () => {
    const e = endpoint('/dashboard/course/text-course/list')
    expect(e.url).toBe('/study/course/studycourse/courseList')
    expect(e.staticQuery).toEqual([{ name: 'type', defaultValue: '1', kind: 'string' }])
  })

  it('单页覆写 fieldNamePageSize 时以覆写值为准（不是全局的 pageSize）', () => {
    const e = endpoint('/dashboard/flow/old/model/list')
    expect(e.sizeParam).toBe('limit')
    expect(orderedParamNames(e)).toEqual(['order', 'orderField', 'key', 'name', 'category', 'pageNo', 'limit'])
  })

  it('显式传 http 的页面：base 域名与分页名都跟着那个 http 模块走', () => {
    // 这是最容易抽错的一处：文件 import 的 http ≠ 列表用的 http。
    // 该页 `useListPageModule({ http, ... })` 用的是 sale.js。
    const e = endpoint('/dashboard/sale/customer-service/after-sale/list')
    expect(e.httpModule).toBe('sale.js')
    expect(e.baseUrlEnv).toBe('VITE_SHOP_ADMIN_API')
    // sale.js 没有 platform.js 的补前缀拦截器，所以路径不补 /admin-api
    expect(e.resolvedPath).toBe('/admin/aftersales/page')
    // sale.js 的拦截器把 pageSize 改名成 limit
    expect(e.sizeParam).toBe('limit')
    expect(e.verdict).toBe('partial')
    expect(e.partialKind).toBe('base')
  })

  it('文件 import 了别的 http 但列表没传 http 时，仍按全局默认 platform.js 判定', () => {
    const e = endpoint('/dashboard/platform/activity/monitor/list')
    expect(e.httpModule).toBe('platform.js')
    expect(e.httpSource).toBe('global-default')
    expect(e.baseUrlEnv).toBe('VITE_ZHDJ_PLATFORM_API')
    expect(e.sizeParam).toBe('pageSize')
    // 并把"文件 import 的不是它"这件事显式记下来
    expect(e.issues.some((i) => i.includes('platform-mall-admin.js'))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 2. 与浏览器真实请求逐字段比对
// ---------------------------------------------------------------------------

/**
 * 2026-09-20 用 bsk 在测试环境（webtest01 / biz-api-test）实测抓到的**真实请求 URL**，
 * 以及仓库里已有的基准文件。这里的期望值全部来自浏览器，不来自生成器。
 *
 * 这不是抽样核对——它覆盖了生成器里每一处会抽错的判断：
 * 补前缀 / 前缀透传 / 不补前缀（sale.js）/ pageSize 与 limit / 模板串 / URL 自带 query。
 */
/**
 * 测试环境各 baseURL 的取值，来自 Portal 的 `build/env/.env.build.test`。
 * 生成物的 `baseUrlEnv` 只有变量名，真实域名在这里补上——这一步同时也在校验
 * "这一页到底打到了哪个后端"。
 */
const TEST_ENV_BASE_URL: Record<string, string> = {
  VITE_ZHDJ_PLATFORM_API: 'https://biz-api-test.wodecorp.cn',
  VITE_SHOP_ADMIN_API: 'https://biz-api-test.wodecorp.cn/admin-shop-api',
  VITE_MALL_ADMIN_API: 'https://biz-api-test.wodecorp.cn/mall-manage-api',
}

/**
 * 独立还原一条请求 URL：不信任生成物里那份 `按生成契约还原的` 字符串，
 * 而是拿 `BATCH_ENDPOINTS` 走一遍 SDK 真正用的 qs 序列化。
 */
function reproduceUrl (e: BatchEndpoint): string {
  const base = TEST_ENV_BASE_URL[e.baseUrlEnv]
  if (!base) throw new Error(`${e.pagePath} 的 baseUrlEnv=${e.baseUrlEnv} 不在测试环境表里`)
  const query = serializeQuery(e)
  return `${base}${e.resolvedPath}${query ? `?${query}` : ''}`
}

describe('与浏览器真实请求比对（路径 + query 逐字段）', () => {
  const verified = readReport().浏览器实测核对.明细

  it('报告里的实测记录本身是"全部一致"（不是挑了几条好看的）', () => {
    expect(verified.length).toBeGreaterThanOrEqual(7)
    expect(verified.every((v) => v.一致)).toBe(true)
    expect(new Set(verified.map((v) => v.pagePath)).size).toBe(verified.length)
  })

  it.each(verified.map((v) => [v.pagePath, v.浏览器发出的, v.note] as const))(
    '%s —— %s（%s）',
    (pagePath, browserUrl) => {
      const e = endpoint(pagePath)

      // 1) base + resolvedPath 必须拼出浏览器那条的 origin + pathname
      const browser = new URL(browserUrl)
      expect(reproduceUrl(e).split('?')[0]).toBe(`${browser.origin}${browser.pathname}`)

      // 2) query：值逐字段相同……
      //    先确认这条断言不是空转（两边都空也算"相等"）
      expect(orderedParamNames(e).length, `${pagePath} 抽出来的 query 是空的`).toBeGreaterThan(0)
      expect(qs.parse(serializeQuery(e))).toEqual(qs.parse(browser.search.slice(1)))

      // 3) ……顺序也相同（D20 的"逐字段一致"包含顺序，顺序错了 URL 就不一样）
      expect(orderedParamNames(e)).toEqual(browserParamNames(browserUrl))
    },
  )

  it('会议室这一条同时与仓库里已有的基准文件对得上', () => {
    const baseline = JSON.parse(
      readFileSync(join(PKG_ROOT, 'baseline/meeting-room-page.browser.json'), 'utf8'),
    ) as { url: string }
    const e = endpoint('/dashboard/meeting-room/list')
    const baselineUrl = baseline.url.replace('_t=<ts>', '').replace(/[?&]$/, '')
    const browser = new URL(baselineUrl)
    expect(reproduceUrl(e).split('?')[0]).toBe(`${browser.origin}${browser.pathname}`)
    expect(qs.parse(serializeQuery(e))).toEqual(qs.parse(browser.search.slice(1)))
  })

  it('生成的契约与手写能力定义不打架（同一页两条定义必须指向同一个接口）', () => {
    // 手写版见 src/capabilities/meeting-room.ts: createMeetingRoomCapability().list
    const e = endpoint('/dashboard/meeting-room/list')
    expect(e.url).toBe('/admin-api/hr/meeting-room/page')
    expect(e.pageParam).toBe('pageNo')
    expect(e.sizeParam).toBe('pageSize')
  })
})

// ---------------------------------------------------------------------------
// 3. 抽不出来时如实跳过
// ---------------------------------------------------------------------------

describe('抽不出来就缺席，不编一个', () => {
  const report = readReport()
  const failed = report.非自动样本明细.filter((s) => s.verdict === 'failed')

  it('运行期变量拼出来的 URL 被判 failed，且不进能力定义', () => {
    // 源码：getDataListURL: `/admin/applyCat/page?shopId=${shopInfo.shopId}`
    // shopId 是运行时的店铺信息，静态解不出——必须缺席，而不是给个 /admin/applyCat/page
    const sample = report.非自动样本明细.find((s) => s.pagePath === '/dashboard/sale/shop/apply-cat/list')
    expect(sample, '这个页面必须出现在失败清单里').toBeDefined()
    expect(sample?.verdict).toBe('failed')
    expect(sample?.issues.join(' ')).toContain('shopInfo.shopId')
    expect(sample?.resolvedPath).toBeNull()

    expect(Object.values(BATCH_ENDPOINTS).some((e) => e.pagePath === '/dashboard/sale/shop/apply-cat/list')).toBe(false)
    expect(BATCH_CAPABILITIES.some((c) => c.pagePath === '/dashboard/sale/shop/apply-cat/list')).toBe(false)
  })

  it('没有 getDataListURL、只有 http + columns 的页面也不算声明式列表页', () => {
    // 源码：useListPageModule({ http, getDataListIsPage: false, columns })，
    // 数据其实来自另一条 useAsyncState(http.get(...))——清单按"有 useListPageModule 且无 customLoad"
    // 分类，在这里出现了假阳性。
    const sample = report.非自动样本明细.find((s) => s.pagePath === '/dashboard/sale/customer-service/evaluation-overview/list')
    expect(sample?.verdict).toBe('failed')
    expect(sample?.issues.join(' ')).toContain('getDataListURL')
  })

  it('failed 的页面一条都不在生成物里；在的页面都有可用的路径', () => {
    const failedPaths = new Set(failed.map((s) => s.pagePath))
    expect(failedPaths.size).toBeGreaterThan(0)
    for (const e of Object.values(BATCH_ENDPOINTS)) {
      expect(failedPaths.has(e.pagePath)).toBe(false)
      expect(e.url, `${e.pagePath} 的 url 是空的`).not.toBe('')
      expect(e.resolvedPath.startsWith('/'), `${e.pagePath} 的 resolvedPath 不是绝对路径`).toBe(true)
      expect(e.verdict === 'auto' || e.verdict === 'partial').toBe(true)
    }
  })

  it('BATCH_CAPABILITIES 与 BATCH_ENDPOINTS 一一对应，没有半条能力', () => {
    expect(BATCH_CAPABILITIES.length).toBe(Object.keys(BATCH_ENDPOINTS).length)
    for (const c of BATCH_CAPABILITIES) {
      expect(BATCH_ENDPOINTS[c.id], `能力 ${c.id} 没有对应契约`).toBeDefined()
      expect(BATCH_ENDPOINTS[c.id]?.pagePath).toBe(c.pagePath)
    }
    const ids = BATCH_CAPABILITIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

// ---------------------------------------------------------------------------
// 4. 判定口径本身
// ---------------------------------------------------------------------------

describe('判定口径：auto 必须是真能直接用，partial 必须能看出缺哪一层', () => {
  const report = readReport()

  it('每个 partial 都带 partialKind，且四档都出现过', () => {
    for (const e of Object.values(BATCH_ENDPOINTS)) {
      if (e.verdict !== 'partial') continue
      expect(e.partialKind, `${e.pagePath} 是 partial 但没标缺哪一层`).toBeDefined()
      expect(['contract', 'base', 'path', 'defaults']).toContain(e.partialKind)
      expect(e.issues.length).toBeGreaterThan(0)
    }
    const kinds = new Set(Object.values(BATCH_ENDPOINTS).filter((e) => e.verdict === 'partial').map((e) => e.partialKind))
    // 抽样里至少出现 contract（convertFetchForm）、base（sale.js）、defaults（dayjs 初值）
    expect(kinds.has('contract')).toBe(true)
    expect(kinds.has('base')).toBe(true)
    expect(kinds.has('defaults')).toBe(true)
  })

  it('auto 的页面不许留"需要人补"的 issue', () => {
    for (const e of Object.values(BATCH_ENDPOINTS)) {
      if (e.verdict !== 'auto') continue
      const blockers = e.issues.filter((i) =>
        i.includes('convertFetchForm') ||
        i.includes('不是静态对象') ||
        i.includes('运行时表达式'),
      )
      expect(blockers, `${e.pagePath} 被判 auto 但仍有阻塞项`).toEqual([])
    }
  })

  it('覆盖率数字如实反映"没做完"：全量里 auto 只是多数，不是全部', () => {
    const full = extrapolationOf(report)
    // 2026-09-22 / Portal 82651c98c5：241 → 240。
    // 声明式列表新增资产盘点，删除常用摘要与旧 technology/setting/project 菜单。
    expect(full.total).toBe(240)
    expect(full.auto + full.partial + full.failed).toBe(full.total)
    // 这条是这份报告的核心结论，别被"全绿"掩盖：多数 ≠ 全部
    expect(full.auto).toBeLessThan(full.total)
    expect(full.partial).toBeGreaterThan(0)
    expect(full.failed).toBeGreaterThan(0)
    // 明细行数要和统计对得上（防止统计与明细各说各话）
    expect(report.非自动样本明细.length).toBe(full.partial + full.failed)
  })

  it('抽样 20 页覆盖了多个业务域与多种路径形态', () => {
    expect(report.抽样页数).toBe(20)
    expect(report.抽样依据.length).toBe(20)
    const domains = new Set(Object.values(BATCH_ENDPOINTS).map((e) => e.domain))
    expect(domains.size).toBeGreaterThanOrEqual(8)
    const bases = new Set(Object.values(BATCH_ENDPOINTS).map((e) => e.baseUrlEnv))
    expect(bases.has('VITE_ZHDJ_PLATFORM_API')).toBe(true)
    expect(bases.has('VITE_SHOP_ADMIN_API')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// 5. 运行时：契约真的能拼出请求
// ---------------------------------------------------------------------------

/** 一个只记录调用、不发请求的 PortalRequest 替身 */
function recordingRequest (sink: Array<{ url: string; method: string; params?: unknown }>): PortalRequest {
  return (async (config: { url: string; method: string; params?: unknown }) => {
    sink.push(config)
    return null
  }) as unknown as PortalRequest
}

describe('createBatchListCapability：按契约拼请求', () => {
  it('默认参数原样发出，跟浏览器一致', async () => {
    const e = endpoint('/dashboard/meeting-room/list')
    const calls: Array<{ url: string; method: string; params?: unknown }> = []
    const cap = createBatchListCapability(e, recordingRequest(calls))
    await cap.list()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe('/admin-api/hr/meeting-room/page')
    expect(calls[0]?.method).toBe('get')
    expect(qs.stringify(calls[0]?.params, { allowDots: true, skipNulls: true }))
      .toBe('order=&orderField=&name=&pageNo=1&pageSize=20')
  })

  it('调用方传的参数覆盖默认值，且不改变参数顺序', async () => {
    const e = endpoint('/dashboard/meeting-room/list')
    const calls: Array<{ url: string; method: string; params?: unknown }> = []
    const cap = createBatchListCapability(e, recordingRequest(calls))
    await cap.list({ name: '博创', pageSize: 50 })
    expect(qs.stringify(calls[0]?.params, { allowDots: true, skipNulls: true }))
      .toBe('order=&orderField=&name=%E5%8D%9A%E5%88%9B&pageNo=1&pageSize=50')
  })

  it('静态 query（URL 里写死的）也一并发出，且排在 form 参数之前', async () => {
    const e = endpoint('/dashboard/course/text-course/list')
    const calls: Array<{ url: string; method: string; params?: unknown }> = []
    const cap = createBatchListCapability(e, recordingRequest(calls))
    await cap.list()
    const params = calls[0]?.params as Record<string, unknown>
    expect(params.type).toBe('1')
    expect(Object.keys(params).indexOf('type')).toBeLessThan(Object.keys(params).indexOf('order'))
  })
})

// ---------------------------------------------------------------------------
// 6. 抽出的页面确实来自清单里的"声明式列表页"
// ---------------------------------------------------------------------------

describe('输入口径：只碰清单里判定为声明式列表页的页面', () => {
  it('生成物里的每一页都能在 page-catalog 里找到且分类正确', () => {
    const catalog = JSON.parse(readFileSync(PAGE_CATALOG, 'utf8')) as {
      items: Array<{ menuPath: string | null; kind: string; domain: string }>
    }
    const byPath = new Map(catalog.items.filter((i) => i.menuPath).map((i) => [i.menuPath as string, i]))
    for (const e of Object.values(BATCH_ENDPOINTS)) {
      const row = byPath.get(e.pagePath)
      expect(row, `${e.pagePath} 不在页面清单里`).toBeDefined()
      expect(row?.kind).toBe('列表页(声明式 getDataListURL)')
      expect(e.domain).toBe(row?.domain)
    }
  })
})

describe('批量生成能力 SDK 接线', () => {
  it('只接入范围内且 auto 的能力，partial/范围外不进入主目录', () => {
    expect(BATCH_SDK_CAPABILITIES.length).toBeGreaterThan(0)
    for (const capability of BATCH_SDK_CAPABILITIES) {
      const endpoint = BATCH_ENDPOINTS[capability.id]
      expect(endpoint?.scope, capability.id).toBe('in-scope')
      expect(endpoint?.menuScope, capability.id).toBe('retained')
      expect(endpoint?.verdict, capability.id).toBe('auto')
      expect(capability.write, capability.id).toBe(false)
    }

    const registered = new Set(ALL_CAPABILITY_DEFINITIONS.map((capability) => capability.id))
    expect(BATCH_SDK_CAPABILITIES.every((capability) => registered.has(capability.id))).toBe(true)
    expect(BATCH_IN_SCOPE_CAPABILITIES.some((capability) =>
      BATCH_ENDPOINTS[capability.id]?.verdict !== 'auto' &&
      registered.has(capability.id),
    )).toBe(false)
    expect(BATCH_OUT_OF_SCOPE_CAPABILITIES.some((capability) => registered.has(capability.id))).toBe(false)
  })

  it('页面上下文 host 保留 pagePath，并按生成契约合并默认查询参数', async () => {
    const calls: Array<{ pagePath: string; config: RequestConfig }> = []
    const host = createBatchCapabilityHost(async (pagePath, config) => {
      calls.push({ pagePath, config })
      return { list: [], total: 0 }
    })
    const capability = BATCH_SDK_CAPABILITIES.find((item) => item.id === 'batch:org-org-propType-list')
    expect(capability).toBeDefined()
    if (capability === undefined) return
    const endpoint = BATCH_ENDPOINTS[capability.id]!
    const method = batchMethodName(capability.id)

    await host[method]!.list()

    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual({
      pagePath: endpoint.pagePath,
      config: {
        url: endpoint.url,
        method: 'get',
        params: Object.fromEntries([
          ...endpoint.staticQuery.map((item) => [item.name, item.defaultValue]),
          ...endpoint.query.map((item) => [item.name, item.defaultValue]),
        ]),
      },
    })
  })

  it('单用户门面和目录/绑定表暴露同一批量方法，调用仍带页面 module-type', async () => {
    let captured: InternalAxiosRequestConfig | undefined
    const sdk = createPortalHeadless({
      baseUrl: 'https://sdk-batch-capability.invalid',
      credential: { token: 'batch-test', tenantId: 1 },
    })
    ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
      captured = config
      return {
        data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    const bindingIds = new Set(CAPABILITY_BINDINGS.map((binding) => binding.capabilityId))
    for (const capability of BATCH_SDK_CAPABILITIES) {
      const methodPath = 'batch.' + batchMethodName(capability.id) + '.list'
      expect(bindingIds.has(capability.id), capability.id).toBe(true)
      expect(typeof sdk.batch[batchMethodName(capability.id)]?.list, methodPath).toBe('function')

      const described = sdk.catalog.describe(capability.id)
      expect(described.ok, capability.id).toBe(true)
      if (described.ok) expect(described.invoke?.sdkPath).toBe(methodPath)
      expect(sdk.catalog.describeMethod(methodPath).ok, methodPath).toBe(true)
    }

    await sdk.batch[batchMethodName('batch:org-org-propType-list')]!.list()

    expect(captured?.url).toContain('/admin-api/hr/org/organizationProperty/page')
    expect(String((captured?.headers as unknown as Record<string, string>)['module-type'])).toBe('11')
  })

  it('范围外契约仍然硬拒绝，不能借批量 host 绕过后端范围', () => {
    const endpoint = BATCH_ENDPOINTS[BATCH_OUT_OF_SCOPE_CAPABILITIES[0]?.id ?? '']
    expect(endpoint).toBeDefined()
    if (endpoint === undefined) return
    const request: PortalRequest = async <T>() => ({}) as T
    expect(() => createBatchListCapability(endpoint, request)).toThrow(/不在 SDK 的 Portal 主后端范围内/)
  })
})
