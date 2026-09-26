import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createPerfAgreementCapability,
  perfAgreementCapabilities,
  splitPerfYearMonth,
  PERF_AGREEMENT_CHANGE_PAGE_PATH,
  PERF_AGREEMENT_CHANGE_PATHS,
  PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH,
  PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH,
  PERF_MONTH_PROTOCOL_LIST_PATH,
  PERF_MONTH_PROTOCOL_OTHERS_PATH,
  PERF_MONTH_PROTOCOL_SIGNATORY_PATH,
  PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
  PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH,
  PERF_YEAR_PROTOCOL_CONFIG_PATH,
  PERF_YEAR_PROTOCOL_LIST_PATH,
  PERF_YEAR_PROTOCOL_OTHERS_PATH,
  type PerfAgreementCapability,
} from '../src/capabilities/perf-agreement.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 绩效管理域「协议类」五页（状态变更 / 个人月度 / 所辖月度 / 个人年度 / 所辖年度）
 * 的**基准回归**。逐字段判据是 `baseline/perf-agreement.browser.json`（2026-09-21 抓于测试环境）。
 *
 * 四条最要紧的断言，正是契约里最容易写错的地方（详见能力文件头 §二）：
 *
 * 1. `organizationCode` 在「所辖月度」上**不在 URL 里**（页面初值 `null`，被 `skipNulls` 丢掉），
 *    在「所辖年度」上**是空串**（初值 `''`）。**两页不是一回事**。
 * 2. `month` 的键位置落在 `organizationCode` **之后**（`convertFetchForm` 里 `month` 是追加的，
 *    其余三个键是覆盖赋值、位置不动）。
 * 3. 两个 `main` 页的 `form` 是空的 ⇒ URL 上只有 `order/orderField/pageNo/pageSize`。
 * 4. `agreement-change` 声明的 `getDataListURL` 是**死的**（同页的 `customLoad` 赢），
 *    它实际打 `othersPage`，**从不**打 `/page`。
 *
 * ## 一处**刻意**的偏离：`signatory` 的默认值
 *
 * 基准里 `signatory` 是**当前登录用户的 id**（已脱敏），页面替用户把「审核人 = 我」填好了。
 * 无头不知道调用者是谁，所以本能力默认**空串**。这一处**不能**用"两边都归一化成占位符
 * 再比"糊过去 —— 那会让断言变成恒真。所以：
 *
 * - `signatory` 的**值**在逐字段比较里用 `maskSignatory()` 归一（键**位置**照旧参与比较），
 *   否则五页里的两页永远红；
 * - 另有一条**专门的**断言，直接锁住"本 SDK 默认空串"与"基准是非空 id"这两件事。
 */

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string): Baseline =>
  JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

type BaselineRequest = { 页面: string; pagePath: string; method: string; url: string; body?: unknown }
type Baseline = { requests: BaselineRequest[] }

const BASE = load('perf-agreement.browser.json')

/** 按页面取基准里的那一条（用正则把同页的其它请求排除掉） */
function reqOf (pagePath: string, match: RegExp): BaselineRequest {
  const hits = BASE.requests.filter((r) => r.pagePath === pagePath && match.test(r.url))
  if (hits.length !== 1) {
    throw new Error(`基准里 ${pagePath} 匹配 ${match} 的请求应恰好 1 条，实际 ${hits.length} 条`)
  }
  return hits[0]!
}

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

function normalize (rawUrl: string): string {
  return rawUrl
    .replace(/^https?:\/\/[^/]+/, '')
    .replace(/([?&]_t=)\d+/, '$1<ts>')
    // 唯一一处刻意偏离（见文件头）：`signatory` 的值。**只抹值、不抹键**，
    // 所以"键在不在、排第几"照旧参与比较；值那一处另有专门断言盯着。
    .replace(/([?&]signatory=)[^&]*/, '$1<uid>')
}

/**
 * 逐字段比较用：把 `signatory` 的**值**归一成 `<uid>`（**键的位置不动**）。
 *
 * ⚠️ 这不是"放松断言"：它只掩盖那一处**已在文件头写明的刻意偏离**，而那一处另有
 * 一条专门的断言（`signatory 默认空串`）盯着。除此之外所有键（含顺序）都照旧逐字比。
 */
/** 把 `signatory` **整项**删掉之后再做归一：用来确认 `normalize()` 只抹了那一处值、没抹多 */
function withoutSignatory (rawUrl: string): string {
  return normalize(rawUrl).replace(/[?&]signatory=[^&]*/, '')
}

function maskSignatory (pairs: Array<[string, string]>): Array<[string, string]> {
  return pairs.map(([key, value]) => (key === 'signatory' ? ([key, '<uid>'] as [string, string]) : [key, value]))
}

/** 每个页面一个 `request`（与门面的接法一致）：记录 `call` 收到的配置 */
function makeSdk () {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [], total: 0 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const at = (pagePath: string): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object) } as never)
  return { sdk, calls, at }
}

/** 五页各建一次能力（每页一个 `PortalRequest`，与门面一致） */
function makeCap () {
  const { calls, at } = makeSdk()
  return {
    calls,
    cap: createPerfAgreementCapability(
      at(PERF_AGREEMENT_CHANGE_PAGE_PATH),
      at(PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH),
      at(PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH),
      at(PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH),
      at(PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH),
    ),
  }
}

// ---------------------------------------------------------------------------
// 一、五页逐字段一致（含键顺序）
// ---------------------------------------------------------------------------

/**
 * 五页的基准条目。`method` 是能力上的方法名 —— 用 `PerfAgreementCapability` 的键
 * 而不是字符串自由写，方法改名时这里会编译不过。
 */
const PAGES: Array<{
  name: string
  pagePath: string
  method: keyof PerfAgreementCapability
  match: RegExp
  /** 基准里 `signatory` 是真实用户 id，本能力默认空串 —— 这两页要比值就得归一 */
  maskSignatory: boolean
}> = [
  {
    name: '状态变更',
    pagePath: PERF_AGREEMENT_CHANGE_PAGE_PATH,
    method: 'listAgreementChange',
    match: /kpimonthprotocol\/othersPage/,
    maskSignatory: false,
  },
  {
    name: '个人月度',
    pagePath: PERF_MONTH_AGREEMENT_MAIN_PAGE_PATH,
    method: 'listMonthAgreements',
    match: /kpimonthprotocol\/page/,
    maskSignatory: false,
  },
  {
    name: '所辖月度',
    pagePath: PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH,
    method: 'listMonthAgreementsOthers',
    match: /kpimonthprotocol\/othersPage/,
    maskSignatory: true,
  },
  {
    name: '个人年度',
    pagePath: PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
    method: 'listYearAgreements',
    match: /kpiyearprotocol\/page/,
    maskSignatory: false,
  },
  {
    name: '所辖年度',
    pagePath: PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH,
    method: 'listYearAgreementsOthers',
    match: /kpiyearprotocol\/othersPage/,
    maskSignatory: true,
  },
]

describe('协议五页 —— 与浏览器基准逐字段一致（D20）', () => {
  for (const { name, pagePath, method, match, maskSignatory: mask } of PAGES) {
    it(`${name}：无筛选时的 URL 与基准完全相同（含键顺序）`, async () => {
      const { cap, calls } = makeCap()
      await (cap[method] as () => Promise<unknown>)()
      const base = reqOf(pagePath, match)
      const got = queryPairs(String(calls[0]?.url))
      const want = queryPairs(base.url)
      // 键**顺序**单独锁一条：toEqual 在数组上已经比顺序，这里额外把键序拎出来，
      // 好让失败信息一眼看出是"顺序错了"还是"值错了"
      expect(got.map(([key]) => key)).toEqual(want.map(([key]) => key))
      expect(mask ? maskSignatory(got) : got).toEqual(mask ? maskSignatory(want) : want)
      expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
      // 上面那条 `normalize()` 会把 signatory 的值抹平 —— 这里反向确认它**只**抹了那一处：
      // 把 signatory 整项从两边删掉之后，仍然逐字节相同（含 `_t` 归一）
      expect(withoutSignatory(String(calls[0]?.url))).toBe(withoutSignatory(base.url))
    })

    it(`${name}：module-type 头 = 13（绩效管理），与基准一致`, async () => {
      const { cap, calls } = makeCap()
      await (cap[method] as () => Promise<unknown>)()
      expect(calls[0]?.moduleType).toBe(13)
    })
  }

  it('五页的方法各打各的端点，没有串台', async () => {
    const { cap, calls } = makeCap()
    await cap.listAgreementChange()
    await cap.listMonthAgreements()
    await cap.listMonthAgreementsOthers()
    await cap.listYearAgreements()
    await cap.listYearAgreementsOthers()
    const urls = calls.map((c) => normalize(String(c.url)).split('?')[0])
    expect(urls).toEqual([
      `/admin-api${PERF_MONTH_PROTOCOL_OTHERS_PATH}`,
      `/admin-api${PERF_MONTH_PROTOCOL_LIST_PATH}`,
      `/admin-api${PERF_MONTH_PROTOCOL_OTHERS_PATH}`,
      `/admin-api${PERF_YEAR_PROTOCOL_LIST_PATH}`,
      `/admin-api${PERF_YEAR_PROTOCOL_OTHERS_PATH}`,
    ])
  })
})

// ---------------------------------------------------------------------------
// 二、四条最该被卡的差异
// ---------------------------------------------------------------------------

describe('组织参数 organizationCode：两页的行为**相反**', () => {
  it('所辖月度：默认**不在 URL 上**（页面初值 null，被 skipNulls 丢掉）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers()
    const url = String(calls[0]?.url)
    expect(url).not.toContain('organizationCode')
    // 基准同样没有这一项（不是"我少发了"）
    expect(reqOf(PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH, /kpimonthprotocol\/othersPage/).url)
      .not.toContain('organizationCode')
  })

  it('所辖月度：调用方给了 id 就照发（默认值不挡参数）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers({ organizationCode: 'A01' })
    expect(String(calls[0]?.url)).toContain('organizationCode=A01')
  })

  it('所辖年度：默认**是空串、键在**（页面初值 ""，不是 null）', async () => {
    const { cap, calls } = makeCap()
    await cap.listYearAgreementsOthers()
    const url = String(calls[0]?.url)
    expect(url).toContain('organizationCode=')
    expect(url).not.toContain('organizationCode=A01')
    expect(reqOf(PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH, /kpiyearprotocol\/othersPage/).url)
      .toContain('organizationCode=&')
  })
})

describe('month 的键位置与语义', () => {
  it('所辖月度：month 排在 organizationCode **之后**（追加，不是插在中间）', async () => {
    const { cap, calls } = makeCap()
    // 这一页默认把 organizationCode 丢掉了，所以要**给一个值**才看得见相对位置
    await cap.listMonthAgreementsOthers({ organizationCode: 'A01', month: '09' })
    const keys = queryPairs(String(calls[0]?.url)).map(([key]) => key)
    const atOrg = keys.indexOf('organizationCode')
    const atMonth = keys.indexOf('month')
    expect(atOrg).toBeGreaterThan(-1)
    expect(atMonth).toBe(atOrg + 1)
    // 页面的 convertFetchForm 是 `{...form, year, month, signatory, status}`：
    // month 是**唯一**的追加键，其余三个是覆盖赋值（位置留在原处）
    expect(keys.slice(atOrg, atMonth + 1)).toEqual(['organizationCode', 'month'])
  })

  it('所辖月度的 month 是**补零字符串**，状态变更是**数字**（两页别混）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers({ month: splitPerfYearMonth('2026-09').month })
    await cap.listAgreementChange('month', { month: 3 })
    expect(String(calls[0]?.url)).toContain('month=09')
    expect(String(calls[1]?.url)).toContain('month=3')
    expect(String(calls[1]?.url)).not.toContain('month=03')
  })

  it('年度协议没有 month 这个键（所辖年度 / 个人年度都没有）', async () => {
    const { cap, calls } = makeCap()
    await cap.listYearAgreementsOthers()
    await cap.listYearAgreements()
    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).not.toContain('month')
    expect(queryPairs(String(calls[1]?.url)).map(([key]) => key)).not.toContain('month')
  })
})

describe('两个 main 页：form 是空的，URL 上只剩 order/orderField + 分页', () => {
  it('个人月度', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreements()
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('个人年度', async () => {
    const { cap, calls } = makeCap()
    await cap.listYearAgreements()
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('分页参数可改，且 pageNo/pageSize 排在最后（_t 之前）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreements({ pageNo: 3, pageSize: 50 })
    const pairs = queryPairs(String(calls[0]?.url))
    expect(pairs.slice(-3)).toEqual([['pageNo', '3'], ['pageSize', '50'], ['_t', '<ts>']])
  })
})

describe('状态变更页：getDataListURL 是死的，实际打 othersPage', () => {
  it('从没打过 /page —— 基准 15 条里也没有一条 /page', async () => {
    const { cap, calls } = makeCap()
    await cap.listAgreementChange()
    expect(String(calls[0]?.url)).toContain('kpimonthprotocol/othersPage')
    expect(String(calls[0]?.url)).not.toMatch(/kpimonthprotocol\/page\?/)
    // 反面证据：基准里**这一页**的请求只有 othersPage。
    // ⚠️ 别把断言写成"基准里没有任何 kpimonthprotocol/page" —— 「个人月度」页打的
    // 就是 `/page`，那是它对的接口，不是反例。
    const own = BASE.requests.filter((r) => r.pagePath === PERF_AGREEMENT_CHANGE_PAGE_PATH)
    expect(own).toHaveLength(1)
    expect(own[0]!.url).toContain('kpimonthprotocol/othersPage')
    expect(own.some((r) => /kpimonthprotocol\/page\?/.test(r.url))).toBe(false)
  })

  it('kind 决定端点：month / year 各一条，且都带同一套表单字段', async () => {
    const { cap, calls } = makeCap()
    await cap.listAgreementChange('month')
    await cap.listAgreementChange('year')
    expect(String(calls[0]?.url)).toContain(PERF_MONTH_PROTOCOL_OTHERS_PATH)
    expect(String(calls[1]?.url)).toContain(PERF_YEAR_PROTOCOL_OTHERS_PATH)
    // ⚠️ 年度那一支**也带 month**：`form` 里一直有这个键，页面没有 convertFetchForm 去删它
    //    （切换时那一项会不会被清空成 '' —— 没实测，本能力只保证"键一定在"）
    expect(queryPairs(String(calls[1]?.url)).map(([key]) => key)).toEqual([
      'order', 'orderField', 'year', 'month', 'status', 'creator', 'include', 'pageNo', 'pageSize', '_t',
    ])
    expect(PERF_AGREEMENT_CHANGE_PATHS).toEqual({
      month: PERF_MONTH_PROTOCOL_OTHERS_PATH,
      year: PERF_YEAR_PROTOCOL_OTHERS_PATH,
    })
  })

  it('include 默认照抄页面的 1，可以改', async () => {
    const { cap, calls } = makeCap()
    await cap.listAgreementChange()
    await cap.listAgreementChange('month', { include: 0 })
    expect(String(calls[0]?.url)).toContain('include=1')
    expect(String(calls[1]?.url)).toContain('include=0')
  })

  it('kind 非法 → reject（不是静默打到月度）', async () => {
    const { cap } = makeCap()
    await expect(cap.listAgreementChange('weekly' as never)).rejects.toThrow(/kind 只能是 month \/ year/)
  })

  it('年份/创建人原样透传', async () => {
    const { cap, calls } = makeCap()
    await cap.listAgreementChange('year', { year: '2026', creator: '张三' })
    const url = String(calls[0]?.url)
    expect(queryPairs(url)).toContainEqual(['year', '2026'])
    expect(queryPairs(url)).toContainEqual(['creator', '张三'])
  })
})

// ---------------------------------------------------------------------------
// 三、多选字段必须 join(',') —— 数组直接透传会变成 xxx[0]=
// ---------------------------------------------------------------------------

describe('signatory / status：数组要先 join(\',\')', () => {
  it('所辖月度：数组 → 逗号串（不是 signatory[0]=）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers({ signatory: [327208, 5], status: [1, 2] })
    const url = String(calls[0]?.url)
    // ⚠️ 逗号在 URL 上是 `%2C`（qs 的编码），所以比的是**解码后**的键值对，不是裸串
    expect(queryPairs(url)).toContainEqual(['signatory', '327208,5'])
    expect(queryPairs(url)).toContainEqual(['status', '1,2'])
    expect(url).not.toContain('signatory[0]')
    expect(url).not.toContain('status[0]')
  })

  it('所辖年度：signatory 一样 join；status 是单选，标量原样', async () => {
    const { cap, calls } = makeCap()
    await cap.listYearAgreementsOthers({ signatory: [1, 2, 3], status: 'DONE' })
    const url = String(calls[0]?.url)
    expect(queryPairs(url)).toContainEqual(['signatory', '1,2,3'])
    expect(queryPairs(url)).toContainEqual(['status', 'DONE'])
    expect(url).not.toContain('signatory[0]')
  })

  it('空数组与不传等价：都是空串', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers({ signatory: [], status: [] })
    await cap.listMonthAgreementsOthers({})
    expect(normalize(String(calls[0]?.url))).toBe(normalize(String(calls[1]?.url)))
    expect(String(calls[0]?.url)).toContain('signatory=&')
  })
})

// ---------------------------------------------------------------------------
// 四、刻意偏离：signatory 的默认值
// ---------------------------------------------------------------------------

describe('signatory 默认值 —— **刻意**偏离页面（不是漏写）', () => {
  it('基准里 signatory 是**非空**的（当前登录用户 id），页面替用户筛好了', () => {
    const url = reqOf(PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH, /kpimonthprotocol\/othersPage/).url
    expect(url).toMatch(/[?&]signatory=[^&]+/)
  })

  it('本能力默认发**空串**，调用方改不了这一点（只能自己给 id）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers()
    await cap.listYearAgreementsOthers()
    expect(String(calls[0]?.url)).toContain('signatory=&')
    expect(String(calls[1]?.url)).toContain('signatory=&')
  })

  it('复刻页面的办法：把当前用户 id 传进来，就与基准同形', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers({ signatory: 327208 })
    const got = queryPairs(String(calls[0]?.url))
    const want = queryPairs(
      reqOf(PERF_MONTH_AGREEMENT_OTHERS_PAGE_PATH, /kpimonthprotocol\/othersPage/).url,
    )
    expect(got.map(([k]) => k)).toEqual(want.map(([k]) => k))
    // 归一化之后逐字段一致 —— 说明"只差 signatory 的值"这一句是真的
    expect(maskSignatory(got)).toEqual(maskSignatory(want))
  })
})

// ---------------------------------------------------------------------------
// 五、年度协议页的第二个读：时间节点配置
// ---------------------------------------------------------------------------

describe('个人年度：时间节点配置（页面挂载时自己发的第二个请求）', () => {
  it('URL 与基准 [7] 逐字段一致（零业务参数，只有 _t）', async () => {
    const { cap, calls } = makeCap()
    await cap.getYearProtocolConfig()
    const base = reqOf(PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH, /sys\/dict\/data\/getYearProtocolConfig/)
    expect(queryPairs(String(calls[0]?.url))).toEqual([['_t', '<ts>']])
    expect(queryPairs(base.url)).toEqual([['_t', '<ts>']])
    expect(normalize(String(calls[0]?.url))).toBe(`/admin-api${PERF_YEAR_PROTOCOL_CONFIG_PATH}?_t=<ts>`)
    expect(base.method).toBe('GET')
  })

  it('它**只**出现在个人年度页（基准里其它四页没有这条）', () => {
    const owners = new Set(
      BASE.requests
        .filter((r) => /getYearProtocolConfig/.test(r.url))
        .map((r) => r.pagePath),
    )
    expect([...owners]).toEqual([PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH])
  })

  it('它走的是**个人年度页**的上下文（module-type 13）', async () => {
    const { cap, calls } = makeCap()
    await cap.getYearProtocolConfig()
    expect(calls[0]?.moduleType).toBe(13)
  })
})

describe('页面挂载时的全量候选：基线里有，本 SDK **不发**', () => {
  it('signatoryByPage 一次都不发（包括**年度**页那条走月度端点的）', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers()
    await cap.listYearAgreementsOthers()
    expect(calls.every((c) => !String(c.url).includes('signatoryByPage'))).toBe(true)
    // 基准里它们是有的：月度页翻 3 页、**年度页也在翻月度那个端点**
    const pullers = BASE.requests.filter((r) => r.url.includes(PERF_MONTH_PROTOCOL_SIGNATORY_PATH))
    expect(pullers.length).toBeGreaterThan(0)
    expect(pullers.some((r) => r.pagePath === PERF_YEAR_AGREEMENT_OTHERS_PAGE_PATH)).toBe(true)
  })

  it('组织树全量拉取一次都不发', async () => {
    const { cap, calls } = makeCap()
    await cap.listMonthAgreementsOthers()
    await cap.listYearAgreementsOthers()
    expect(calls.every((c) => !String(c.url).includes('getRoleOrganizationTree'))).toBe(true)
    expect(BASE.requests.some((r) => r.url.includes('getRoleOrganizationTree'))).toBe(true)
  })

  it('基准里那条 homePage/save（工作台自动保存）不是本页的读路径，本 SDK 不发', async () => {
    const { cap, calls } = makeCap()
    await cap.listYearAgreementsOthers()
    expect(calls.every((c) => !String(c.url).includes('homePage/save'))).toBe(true)
    expect(BASE.requests.some((r) => r.url.includes('homePage/save'))).toBe(true)
    // 它是 POST，且挂在「所辖年度」名下 —— 是"只改 hash 导航"留下的首页自动保存
    const noise = BASE.requests.find((r) => r.url.includes('homePage/save'))!
    expect(noise.method).toBe('POST')
  })
})

// ---------------------------------------------------------------------------
// 六、helper 与能力定义
// ---------------------------------------------------------------------------

describe('splitPerfYearMonth', () => {
  it('YYYY-MM → 补零的 year / month', () => {
    expect(splitPerfYearMonth('2026-09')).toEqual({ year: '2026', month: '09' })
    expect(splitPerfYearMonth('2026-12')).toEqual({ year: '2026', month: '12' })
  })

  it('带时分秒的字符串取前两位月份', () => {
    expect(splitPerfYearMonth('2026-01-31 23:59:59')).toEqual({ year: '2026', month: '01' })
  })

  it('非法输入抛错，不返回半个对象', () => {
    expect(() => splitPerfYearMonth('2026/09')).toThrow(/YYYY-MM/)
    expect(() => splitPerfYearMonth('')).toThrow(/YYYY-MM/)
    expect(() => splitPerfYearMonth('2026-13')).toThrow(/1~12/)
    expect(() => splitPerfYearMonth('2026-00')).toThrow(/1~12/)
  })
})

describe('能力定义：pagePath 与目录逐字一致、全是只读、id 不重复', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string }> }

  it('六条能力的 pagePath 都在目录里，且 write 全为 false', () => {
    for (const def of perfAgreementCapabilities) {
      expect(
        catalog.items.some((item) => item.menuPath === def.pagePath),
        `${def.id} 的 pagePath 不在目录里：${def.pagePath}`,
      ).toBe(true)
      expect(def.write).toBe(false)
    }
  })

  it('id 互不重复；只有"年度页的两条读"共用同一个 pagePath（有意）', () => {
    const ids = perfAgreementCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual([
      'perf-agreement-change-list',
      'perf-month-agreement-list',
      'perf-month-agreement-others-list',
      'perf-year-agreement-list',
      'perf-year-agreement-others-list',
      'perf-year-protocol-config-get',
    ])
    const byPage = new Map<string, string[]>()
    for (const def of perfAgreementCapabilities) {
      byPage.set(def.pagePath, [...(byPage.get(def.pagePath) ?? []), def.id])
    }
    const shared = [...byPage.entries()].filter(([, list]) => list.length > 1)
    expect(shared).toEqual([
      [
        PERF_YEAR_AGREEMENT_MAIN_PAGE_PATH,
        ['perf-year-agreement-list', 'perf-year-protocol-config-get'],
      ],
    ])
  })

  it('五页的 pagePath 与目录里的 menuPath **逐字**相同（不是"看起来一样"）', () => {
    const byPath = new Map(catalog.items.map((item) => [item.menuPath, item]))
    const expected = [
      '/dashboard/agreement-change/main/list',
      '/dashboard/month-agreement/main/list',
      '/dashboard/month-agreement/others/list',
      '/dashboard/year-agreement/main/list',
      '/dashboard/year-agreement/others/list',
    ]
    for (const path of expected) {
      expect(byPath.has(path), `${path} 不在目录里`).toBe(true)
    }
  })
})
