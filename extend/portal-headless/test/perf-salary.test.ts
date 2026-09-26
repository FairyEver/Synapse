import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/session/types.js'
import {
  ANALYSIS_DEPARTMENT_DETAIL_URLS,
  ANALYSIS_DEPARTMENT_SELF_CHECK_URL,
  ANALYSIS_DEPARTMENT_URLS,
  ANALYSIS_PERSON_URLS,
  buildDeptYearMonth,
  buildPersonYearMonth,
  buildSalaryYearMonth,
  createPerfSalaryCapability,
  perfSalaryCapabilities,
  PERF_ANALYSIS_DEPARTMENT_PAGE_PATH,
  PERF_ANALYSIS_PERSON_PAGE_PATH,
  PERF_BLOCK_MAIN_PAGE_PATH,
  PERF_SALARY_ADJUST_PAGE_PATH,
  PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
  PERF_SALARY_MAIN_PAGE_PATH,
  BLOCK_MAIN_UPDATE_URL,
  SALARY_ADJUST_SAVE_URL,
  SALARY_ADJUST_LIST_URL,
  SALARY_EXAMINE_RESULT_IMPORT_URL,
  SALARY_EXAMINE_RESULT_LIST_URL,
  SALARY_EXAMINE_RESULT_TEMPLATE_URL,
  SALARY_EXAMINE_RESULT_URL,
  SALARY_MAIN_EXPORT_URL,
  SALARY_MAIN_IMPORT_URL,
  SALARY_MAIN_LIST_URL,
  SALARY_MAIN_TEMPLATE_URL,
  BLOCK_MAIN_LIST_URL,
} from '../src/capabilities/perf-salary.js'
import type { SalaryMainRow } from '../src/capabilities/perf-salary.js'
import { PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS } from '../src/catalog/contracts-perf-analysis-department-detail.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string): Baseline => JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

type BaselineRequest = {
  页面: string
  pagePath: string
  method: string
  url: string
  body?: string | null
}
type Baseline = { requests: BaselineRequest[] }

const BASE = load('perf-salary.browser.json')

/** 按页面 + URL 特征取基准里的那一条 */
function reqOf (pagePath: string, match: RegExp): BaselineRequest {
  const hit = BASE.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
  if (!hit) throw new Error(`基准里找不到 ${pagePath} 的 ${match}`)
  return hit
}

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

/** 拆成有序的 [key, value] 列表 —— 与 queryPairs 同一套判据，只是喂的是 JSON body */
function bodyPairs (raw: unknown): Array<[string, unknown]> {
  return Object.entries(JSON.parse(String(raw)) as Record<string, unknown>)
}

/** 取数组第 n 项，取不到就抛 —— 免得 `?.` 让 undefined 静默流进断言里 */
function pick<T> (list: readonly T[], index: number, what: string): T {
  const hit = list[index]
  if (hit === undefined) throw new Error(`基准里没有第 ${index} 条 ${what}`)
  return hit
}

function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

/**
 * 每个页面一个 `request`（与门面的接法一致）：记录 `call` 收到的配置，
 * 这样既能比 URL / body，也能看出请求级声明的实例与 module-type。
 */
function makeSdk (responseData: unknown = { list: [], total: 0 }) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    const isFile = config.responseType === 'arraybuffer'
    return {
      data: isFile
        ? new Uint8Array([0x50, 0x4b, 0x03]).buffer
        : { ret: 'SUCCESS', code: 0, msg: '', data: responseData },
      status: 200,
      statusText: 'OK',
      headers: isFile
        ? {
            'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'content-disposition': "attachment; filename*=UTF-8''portal.xlsx",
          }
        : {},
      config,
    }
  }
  const at = (pagePath: string, extra: Record<string, unknown> = {}): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, { ...(config as object), ...extra } as never)
  return { sdk, calls, at }
}

function build (responseData: unknown = { list: [], total: 0 }) {
  const { calls, at } = makeSdk(responseData)
  const cap = createPerfSalaryCapability(
    at(PERF_SALARY_MAIN_PAGE_PATH),
    at(PERF_SALARY_ADJUST_PAGE_PATH),
    at(PERF_SALARY_EXAMINE_RESULT_PAGE_PATH),
    at(PERF_BLOCK_MAIN_PAGE_PATH),
    at(PERF_ANALYSIS_DEPARTMENT_PAGE_PATH),
    at(PERF_ANALYSIS_PERSON_PAGE_PATH),
  )
  return { cap, calls }
}

const MAIN_PAGE = '/dashboard/salary/main/list'
const XLSX_INPUT = {
  fileName: '导入.xlsx',
  base64: 'UEs=',
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

// ---------------------------------------------------------------------------
// 奖励导入
// ---------------------------------------------------------------------------

describe('奖励导入 —— 与浏览器基准逐字段一致（D20）', () => {
  it('POST body 的键序与基准完全相同', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain()
    const base = reqOf(MAIN_PAGE, /hrsalarymanagement\/page/)
    expect(Object.keys(JSON.parse(String(calls[0]?.data)))).toEqual(
      Object.keys(JSON.parse(String(base.body))),
    )
  })

  it('显式给年月时，body 的**每一个字段（含值）**与基准一致', async () => {
    const { cap, calls } = build()
    // 基准抓的那一次是 year="2026" / month=9（当时是 2026-09）。显式喂同一组值，
    // 就能把**值**也钉进基准 —— 而不是把"抓取当天"钉进测试（那样测试会自己过期）。
    await cap.listSalaryMain({ year: '2026', month: 9 })
    const base = reqOf(MAIN_PAGE, /hrsalarymanagement\/page/)
    expect(bodyPairs(calls[0]?.data)).toEqual(bodyPairs(base.body))
  })

  it('默认年月是**当前年月**（页面写死的 dayjs()），不是空串', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain()
    const now = new Date()
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.year).toBe(String(now.getFullYear()))
    expect(sent.month).toBe(now.getMonth() + 1)
    // ⚠️ 这一页与另外两页薪酬列表的默认值**相反**：那边是空串。
    expect(sent.year).not.toBe('')
  })

  it('是 POST、body 在 data 上、**没有 query**（于是也没有 `_t`）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain()
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).not.toContain('?')
    // 「没有 _t」是 platform 实例的规则：只给 GET 加（platform.js:36-41）
    expect(String(calls[0]?.url)).not.toContain('_t=')
  })

  it('空值照发：name="" / orgIdList=[] 都在 body 里，且 orgIdList 是数组不是逗号串', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain()
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.name).toBe('')
    expect(sent.orgIdList).toEqual([])
    expect(Array.isArray(sent.orgIdList)).toBe(true)
  })

  it('调用方显式传 undefined 的键取默认值，不是被丢掉', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain({ name: undefined, orgIdList: undefined })
    expect(Object.keys(JSON.parse(String(calls[0]?.data)))).toEqual([
      'order',
      'orderField',
      'name',
      'year',
      'month',
      'orgIdList',
      'pageNo',
      'pageSize',
    ])
  })

  it('走 platform（默认实例）、module-type = 13（与基准请求头一致）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryMain()
    expect(calls[0]?.httpInstance).toBeUndefined()
    expect(calls[0]?.headers['module-type']).toBe('13')
  })
})

describe('奖励导入 —— 页面动作与文件规则', () => {
  it('行类型具名覆盖列表工资字段、身份证号和详情页工资明细', () => {
    const row: SalaryMainRow = {
      idCard: 'masked-or-authorized-value',
      basicSalary: '1000.00',
      examineSalary: 200,
      profitSalary: null,
      rewardSalary: '300.00',
      totalSalary: 1500,
      hrRewardSalaryEntity: {
        weekdayOvertime: '10.00',
        goodHealthDeduction: null,
        remark: '无',
      },
    }
    expect(row.hrRewardSalaryEntity?.weekdayOvertime).toBe('10.00')
    expect(row.idCard).toBe('masked-or-authorized-value')
  })

  it('导出 body 只有 name → year → month → orgIdList，组织数组按 Portal 转逗号串', async () => {
    const { cap, calls } = build()
    const file = await cap.exportSalaryMain({ name: '张三', year: '2026', month: 9, orgIdList: ['7', 8] })
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_MAIN_EXPORT_URL}`)
    expect(bodyPairs(calls[0]?.data)).toEqual([
      ['name', '张三'],
      ['year', '2026'],
      ['month', 9],
      ['orgIdList', '7,8'],
    ])
    expect(calls[0]?.responseType).toBe('arraybuffer')
    expect(file).toMatchObject({ fileName: 'portal.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3, base64: 'UEsD' })
  })

  it('模板下载是 GET，fileName 在 _t 前，且页面 module-type=13', async () => {
    const { cap, calls } = build()
    await cap.downloadSalaryMainTemplate()
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual(['fileName', '_t'])
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_MAIN_TEMPLATE_URL}`)
    expect(calls[0]?.headers['module-type']).toBe('13')
    expect(calls[0]?.responseType).toBe('arraybuffer')
  })

  it('导入使用 multipart 的 file 字段，文件名/MIME 与 Portal 一致', async () => {
    const { cap, calls } = build()
    expect(cap.prepareSalaryMainImport(XLSX_INPUT)).toEqual({
      fileName: '导入.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteLength: 2,
    })
    await cap.importSalaryMain(XLSX_INPUT)
    const data = calls[0]?.data as FormData
    const file = data.get('file') as File
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_MAIN_IMPORT_URL}`)
    expect(calls[0]?.headers['module-type']).toBe('13')
    expect(file.name).toBe('导入.xlsx')
    expect(file.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  })

  it('导入拒绝 .xls 或错误 MIME，且拒绝发生在请求之前', async () => {
    const { cap, calls } = build()
    expect(() => cap.prepareSalaryMainImport({ ...XLSX_INPUT, fileName: '导入.xls' })).toThrow(/xlsx/)
    expect(() => cap.prepareSalaryMainImport({ ...XLSX_INPUT, contentType: 'application/vnd.ms-excel' })).toThrow(/MIME/)
    await expect(cap.importSalaryMain({ ...XLSX_INPUT, fileName: '导入.xls' })).rejects.toThrow(/xlsx/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 工资找齐
// ---------------------------------------------------------------------------

describe('工资找齐 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时 body 的键序**与值**都与基准完全相同', async () => {
    const { cap, calls } = build()
    await cap.listSalaryAdjust()
    const base = reqOf('/dashboard/salary/adjust/list', /adjustPage/)
    expect(bodyPairs(calls[0]?.data)).toEqual(bodyPairs(base.body))
  })

  it('⚠️ 这一页的年月默认是**空串**（与奖励导入的"当前年月"相反）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryAdjust()
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.year).toBe('')
    expect(sent.month).toBe('') // 基准确认 month 是空**串**，不是 0、不是 null
    // 整段 body 与基准逐字段一致（上面那条已经比过；这里再钉一次"空串"这个点）
    const base = reqOf('/dashboard/salary/adjust/list', /adjustPage/)
    expect(JSON.parse(JSON.stringify(sent))).toEqual(JSON.parse(String(base.body)))
  })

  it('字段顺序是 year → month → name → staffCode（与奖励导入的 name 打头不同）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryAdjust({ year: '2026', month: 9, name: '张三', staffCode: 'E1' })
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual([
      'order',
      'orderField',
      'year',
      'month',
      'name',
      'staffCode',
      'orgIdList',
      'pageNo',
      'pageSize',
    ])
    expect(sent.staffCode).toBe('E1')
  })

  it('URL 与基准一致（含 /admin-api 前缀由实例补）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryAdjust()
    expect(normalize(String(calls[0]?.url))).toBe(
      normalize(reqOf('/dashboard/salary/adjust/list', /adjustPage/).url),
    )
  })
})

describe('工资找齐 —— 调整表单与显式选中 ID', () => {
  it('prepare 与 save 保持 Portal 的字段键序，并只提交显式 idList', async () => {
    const { cap, calls } = build()
    const prepared = cap.prepareSalaryAdjust({
      adjustScore: '-1.5',
      adjustProfit: 20,
      adjustRemark: '补录',
      idList: ['101', 102],
    })
    expect(Object.keys(prepared.draft)).toEqual(['adjustScore', 'adjustProfit', 'adjustRemark', 'idList'])
    await cap.saveSalaryAdjust(prepared.draft)
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_ADJUST_SAVE_URL}`)
    expect(bodyPairs(calls[0]?.data)).toEqual([
      ['adjustScore', '-1.5'],
      ['adjustProfit', 20],
      ['adjustRemark', '补录'],
      ['idList', ['101', 102]],
    ])
    expect(calls[0]?.headers['module-type']).toBe('13')
  })

  it('空的可选字段按 Portal 初始值提交为空串', () => {
    const { cap } = build()
    expect(cap.prepareSalaryAdjust({ adjustScore: 0, idList: [1] }).draft).toEqual({
      adjustScore: 0,
      adjustProfit: '',
      adjustRemark: '',
      idList: [1],
    })
  })

  it('按 Portal 规则拒绝缺分数、超范围、全空格备注、重复或空 ID', () => {
    const { cap, calls } = build()
    expect(() => cap.prepareSalaryAdjust({ adjustScore: '', idList: [1] } as never)).toThrow(/adjustScore/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 100000, idList: [1] })).toThrow(/-99999/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 1, adjustProfit: -100000, idList: [1] })).toThrow(/adjustProfit/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 1, adjustRemark: '  ', idList: [1] })).toThrow(/adjustRemark/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 1, idList: [1, '1'] })).toThrow(/重复/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 1, idList: [] })).toThrow(/idList/)
    expect(() => cap.prepareSalaryAdjust({ adjustScore: 1, idList: '1,2' } as never)).toThrow(/idList/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 考核导入
// ---------------------------------------------------------------------------

describe('考核导入 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时 body 的键序**与值**都与基准完全相同', async () => {
    const { cap, calls } = build()
    await cap.listSalaryExamineResult()
    const base = reqOf('/dashboard/salary/examine-result/list', /examineresult\/page/)
    expect(bodyPairs(calls[0]?.data)).toEqual(bodyPairs(base.body))
  })

  it('⚠️ 组织字段叫 organizationIdList（另外两页叫 orgIdList）', async () => {
    const { cap, calls } = build()
    await cap.listSalaryExamineResult({ organizationIdList: [7] })
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.organizationIdList).toEqual([7])
    expect(sent.orgIdList).toBeUndefined()
    expect(Object.keys(sent)).toEqual([
      'order',
      'orderField',
      'name',
      'year',
      'month',
      'organizationIdList',
      'pageNo',
      'pageSize',
    ])
  })
})

describe('考核导入 —— 隐藏路由表单、导入和删除动作', () => {
  const FORM = {
    userId: '7',
    staffCode: 'E7',
    year: '2026',
    month: 9,
    name: '利润目标',
    unit: '元',
    forecast: '1.125',
    actual: 1,
    score: '99.50',
    money: 20,
  } as const

  it('新建/编辑草稿按 Portal 表单键序提交，编辑把 id 放在已知字段之后', async () => {
    const { cap, calls } = build()
    const create = cap.prepareSalaryExamineResultCreate(FORM)
    expect(Object.keys(create.draft)).toEqual(['userId', 'staffCode', 'year', 'month', 'name', 'unit', 'forecast', 'actual', 'score', 'money'])
    const update = cap.prepareSalaryExamineResultUpdate({ id: 88, ...FORM })
    expect(Object.keys(update.draft)).toEqual(['userId', 'staffCode', 'year', 'month', 'name', 'unit', 'forecast', 'actual', 'score', 'money', 'id'])
    expect(calls).toHaveLength(0)
    await cap.createSalaryExamineResult(FORM)
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_EXAMINE_RESULT_URL}`)
    expect(bodyPairs(calls[0]?.data)).toEqual([
      ['userId', '7'], ['staffCode', 'E7'], ['year', '2026'], ['month', 9], ['name', '利润目标'],
      ['unit', '元'], ['forecast', '1.125'], ['actual', 1], ['score', '99.50'], ['money', 20],
    ])
    await cap.updateSalaryExamineResult({ id: 88, ...FORM })
    expect(calls[1]?.method?.toUpperCase()).toBe('PUT')
    expect(bodyPairs(calls[1]?.data).slice(-1)).toEqual([['id', 88]])
    expect(calls[0]?.headers['module-type']).toBe('13')
    expect(calls[1]?.headers['module-type']).toBe('13')
  })

  it('编辑详情走 GET /performance/examineresult/{id}，删除即使单条也发送数组', async () => {
    const { cap, calls } = build({ id: '88', year: 2026, name: '利润目标' })
    const detail = await cap.getSalaryExamineResult({ id: '88' })
    expect(detail.year).toBe('2026')
    expect(typeof detail.year).toBe('string')
    await cap.removeSalaryExamineResult({ ids: ['88'] })
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(String(calls[0]?.url)).toContain(`${SALARY_EXAMINE_RESULT_URL}/88`)
    expect(calls[1]?.method?.toUpperCase()).toBe('DELETE')
    expect(String(calls[1]?.url)).toContain(`/admin-api${SALARY_EXAMINE_RESULT_URL}`)
    expect(JSON.parse(String(calls[1]?.data))).toEqual(['88'])
    expect(cap.prepareSalaryExamineResultRemove({ ids: [1, 2] })).toEqual({ ids: [1, 2] })
    expect(() => cap.prepareSalaryExamineResultRemove({ ids: '88' } as never)).toThrow(/ids/)
  })

  it('考核导入使用同一 xlsx multipart 规则，模板 GET 带固定 fileName', async () => {
    const { cap, calls } = build()
    expect(cap.prepareSalaryExamineResultImport(XLSX_INPUT)).toEqual({
      fileName: '导入.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteLength: 2,
    })
    expect(calls).toHaveLength(0)
    await cap.importSalaryExamineResult(XLSX_INPUT)
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(String(calls[0]?.url)).toContain(`/admin-api${SALARY_EXAMINE_RESULT_IMPORT_URL}`)
    expect((calls[0]?.data as FormData).get('file')).toBeTruthy()
    await cap.downloadSalaryExamineResultTemplate()
    expect(calls[1]?.method?.toUpperCase()).toBe('GET')
    expect(String(calls[1]?.url)).toContain(`/admin-api${SALARY_EXAMINE_RESULT_TEMPLATE_URL}`)
    expect(queryPairs(String(calls[1]?.url)).map(([key]) => key)).toEqual(['fileName', '_t'])
  })

  it('表单校验与 Portal 对齐：必填、非空格、长度、非负范围和精度', () => {
    const { cap, calls } = build()
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, name: ' '.repeat(51) })).toThrow(/name/)
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, unit: ' '.repeat(11) })).toThrow(/unit/)
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, forecast: -1 })).toThrow(/forecast/)
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, score: '1.234' })).toThrow(/score/)
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, month: 13 })).toThrow(/month/)
    expect(() => cap.prepareSalaryExamineResultCreate({ ...FORM, userId: '' } as never)).toThrow(/userId/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 组件管理
// ---------------------------------------------------------------------------

describe('组件管理 —— 与浏览器基准逐字段一致（D20）', () => {
  const PAGE = '/dashboard/block/main/list'

  it('无筛选时的 query 与基准完全相同（含键顺序与 `_t` 位次）', async () => {
    const { cap, calls } = build()
    await cap.listBlockMain()
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(reqOf(PAGE, /kpisubassembly\/page/).url))
  })

  it('`_t` 在**最后**（最后一项，不是插在中间）', async () => {
    const { cap, calls } = build()
    await cap.listBlockMain()
    const pairs = queryPairs(String(calls[0]?.url))
    expect(pairs[pairs.length - 1]?.[0]).toBe('_t')
  })

  it('是 GET、参数在 query 上、body 为空 —— 本组唯一的 GET', async () => {
    const { cap, calls } = build()
    await cap.listBlockMain()
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(calls[0]?.data).toBeUndefined()
    expect(String(calls[0]?.url)).toContain('/admin-api/performance/basedata/kpisubassembly/page?')
  })

  it('空值照发：name= / warehouseType= / type= 都在 URL 上', async () => {
    const { cap, calls } = build()
    await cap.listBlockMain()
    const url = String(calls[0]?.url)
    expect(url).toContain('name=&warehouseType=&type=')
  })

  it('type 是数字时照样发出（9 = 月度指标）', async () => {
    const { cap, calls } = build()
    await cap.listBlockMain({ type: 9 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['order', ''],
      ['orderField', ''],
      ['name', ''],
      ['warehouseType', ''],
      ['type', '9'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })
})

describe('组件管理 —— 启停状态动作', () => {
  it('prepare 按 Portal 规则把 0→1、1→0，submit 是 PUT {id,status}', async () => {
    const { cap, calls } = build()
    expect(cap.prepareBlockStatus({ id: '9', currentStatus: 0 })).toEqual({ draft: { id: '9', status: 1 } })
    expect(cap.prepareBlockStatus({ id: 9, currentStatus: 1 })).toEqual({ draft: { id: 9, status: 0 } })
    await cap.setBlockStatus({ id: '9', status: 1 })
    expect(calls[0]?.method?.toUpperCase()).toBe('PUT')
    expect(String(calls[0]?.url)).toContain(`/admin-api${BLOCK_MAIN_UPDATE_URL}`)
    expect(bodyPairs(calls[0]?.data)).toEqual([['id', '9'], ['status', 1]])
    expect(calls[0]?.headers['module-type']).toBe('13')
  })

  it('状态不是 0/1 或 ID 不合法时不发请求', () => {
    const { cap, calls } = build()
    expect(() => cap.prepareBlockStatus({ id: 1, currentStatus: 2 as never })).toThrow(/currentStatus/)
    expect(() => cap.prepareBlockStatus({ id: 0, currentStatus: 0 })).toThrow(/id/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 管理分析
// ---------------------------------------------------------------------------

describe('管理分析 —— 与浏览器基准逐字段一致（D20）', () => {
  const PAGE = '/dashboard/analysis/department/list'

  /** 基准里那四条统计 POST（同一页、同一个 body） */
  function baseStatPosts (): BaselineRequest[] {
    return BASE.requests.filter(
      (r) => r.pagePath === PAGE && r.method === 'POST' && /statistics\/homepage\//.test(r.url),
    )
  }

  it('四条统计 POST 的 URL 与顺序与基准完全相同', async () => {
    const { cap, calls } = build()
    // 基准抓的那一次是 year=2026 / month=8 / organizationIdList=["34"]。
    // 显式喂同一组值，就能把**值**也钉进基准（而不是把"抓取当天"钉进测试）。
    await cap.getAnalysisDepartmentSummary({ year: 2026, month: 8, organizationIdList: ['34'] })
    const base = baseStatPosts()
    expect(base).toHaveLength(4)
    expect(calls.map((c) => normalize(String(c.url)))).toEqual(base.map((r) => normalize(r.url)))
  })

  it('四条 body 的键序**与值**都与基准完全相同（四条共用一个 body）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisDepartmentSummary({ year: 2026, month: 8, organizationIdList: ['34'] })
    const base = baseStatPosts()
    expect(base).toHaveLength(4)
    // 基准里四条 body 逐字相同 —— 这条断言本身就是"它们共用一个 body"的证据
    expect(new Set(base.map((r) => String(r.body))).size).toBe(1)
    for (const [index, call] of calls.entries()) {
      expect(call.method?.toUpperCase()).toBe('POST')
      expect(bodyPairs(call.data)).toEqual(bodyPairs(pick(base, index, "dept stat POST").body))
    }
  })

  it('⚠️ 年月是**数字**（与个人分析页同名字段是字符串相反）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisDepartmentSummary({ year: 2026, month: 8 })
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.year).toBe(2026)
    expect(sent.month).toBe(8)
    expect(typeof sent.year).toBe('number')
    expect(typeof sent.month).toBe('number')
    // 基准里也是裸数字（不是 "2026"），逐字对上
    expect(JSON.parse(String(pick(baseStatPosts(), 0, "dept stat POST").body))).toMatchObject({ year: 2026, month: 8 })
  })

  it('默认年月是**上月**（基准抓于 2026-09-21，抓到的是 month=8）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisDepartmentSummary()
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.year).toBe(lastMonth.getFullYear())
    expect(sent.month).toBe(lastMonth.getMonth() + 1)
    // 基准那条 month=8 是在 2026-09 抓的 ⇒ 就是"上月"，不是"当前月"
    const base = JSON.parse(String(pick(baseStatPosts(), 0, "dept stat POST").body)) as Record<string, number>
    expect(base.month).toBe(8)
    expect(base.month).not.toBe(9)
  })

  it('organizationIdList 收的是**数组**（基准里是 ["34"]）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisDepartmentSummary({ year: 2026, month: 8, organizationIdList: ['34'] })
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(sent.organizationIdList).toEqual(['34'])
    expect(Array.isArray(sent.organizationIdList)).toBe(true)
    expect(bodyPairs(calls[0]?.data)).toEqual(bodyPairs(pick(baseStatPosts(), 0, "dept stat POST").body))
  })

  it('第三条被注释掉的卡片对应的请求**照样发**（页面实际行为，基准里也有它）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisDepartmentSummary({ year: 2026, month: 8, organizationIdList: ['34'] })
    expect(calls.map((c) => normalize(String(c.url)))).toContain(
      `/admin-api${ANALYSIS_DEPARTMENT_URLS.deptScoreStatisticsInfo}`,
    )
    // 基准确认：这一条**确实发出来了**（卡片虽被注释掉）
    expect(baseStatPosts().map((r) => normalize(r.url))).toContain(
      `/admin-api${ANALYSIS_DEPARTMENT_URLS.deptScoreStatisticsInfo}`,
    )
  })

  it('自查分析：body 键序 order → orderField → staffCodeList → year → month，**没有分页**', async () => {
    const { cap, calls } = build()
    await cap.listAnalysisDepartmentSelfCheck({ staffCodeList: ['A1', 'A2'], year: 2026, month: 9 })
    const sent = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(Object.keys(sent)).toEqual(['order', 'orderField', 'staffCodeList', 'year', 'month'])
    expect(sent.staffCodeList).toEqual(['A1', 'A2'])
    // getDataListIsPage 被注释掉 ⇒ 页面不发 pageNo/pageSize
    expect(sent.pageNo).toBeUndefined()
    expect(sent.pageSize).toBeUndefined()
    // yearMonth / staffNameList 被 omit 掉
    expect(sent.yearMonth).toBeUndefined()
    expect(sent.staffNameList).toBeUndefined()
  })

  it('自查分析：staffCodeList 为空时**拒绝发请求**（页面也只在非空时才发）', async () => {
    const { cap, calls } = build()
    // 同步抛（不是返回 rejected promise）—— 抛在发请求之前，一条都不该发出去
    expect(() => cap.listAnalysisDepartmentSelfCheck({ staffCodeList: [] })).toThrow(/staffCodeList/)
    expect(() => cap.listAnalysisDepartmentSelfCheck({} as never)).toThrow(/staffCodeList/)
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 个人分析
// ---------------------------------------------------------------------------

describe('个人分析 —— 与浏览器基准逐字段一致（D20）', () => {
  const PAGE = '/dashboard/analysis/person/list'

  /**
   * 基准里那两条 GET。⚠️ 这一页**连列表请求都没有**：URL 上只有 `year`/`month`/`_t`，
   * 没有 `order`/`orderField`/`pageNo`/`pageSize` —— 因为它不是列表页。
   */
  function baseGets (): BaselineRequest[] {
    return BASE.requests.filter((r) => r.pagePath === PAGE && r.method === 'GET')
  }

  it('两条 GET 的 URL（含键序与 `_t` 位次）与基准完全相同', async () => {
    const { cap, calls } = build()
    // 基准抓的那一次是 year=2026 / month=8（抓于 2026-09-21 ⇒ 上月）。
    // 显式喂同一组值，把**值**也钉进基准，而不是把"抓取当天"钉进测试。
    await cap.getAnalysisPersonSummary({ year: '2026', month: '8' })
    const base = baseGets()
    expect(base).toHaveLength(2)
    expect(calls.map((c) => normalize(String(c.url)))).toEqual(base.map((r) => normalize(r.url)))
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
  })

  it('params 与基准逐项一致：只有 year / month / _t 三项', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisPersonSummary({ year: '2026', month: '8' })
    const base = baseGets()
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(pick(base, 0, "person GET").url))
    // 明确的否定断言：列表页那四项**一个都不该有**
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).toEqual(['year', 'month', '_t'])
    for (const absent of ['order', 'orderField', 'pageNo', 'pageSize']) {
      expect(keys).not.toContain(absent)
    }
  })

  it('默认年月是**上月**（基准抓于 2026-09-21，抓到的是 month=8）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisPersonSummary()
    const now = new Date()
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const sent = queryPairs(String(calls[0]?.url))
    expect(sent).toEqual([
      ['year', String(lastMonth.getFullYear())],
      ['month', String(lastMonth.getMonth() + 1)],
      ['_t', '<ts>'],
    ])
    // 基准那条 month=8 是在 2026-09 抓的 ⇒ 就是"上月"，不是"当前月"
    expect(queryPairs(pick(baseGets(), 0, "person GET").url)).toContainEqual(['month', '8'])
  })

  it('⚠️ 年月是**字符串**、且 month 不补零（format(\'M\') → 9 月是 "9"）', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisPersonSummary(buildPersonYearMonth('2026-09'))
    const url = String(calls[0]?.url)
    expect(url).toContain('year=2026')
    expect(url).toContain('month=9')
    expect(url).not.toContain('month=09')
  })

  it('⚠️ "不补零"这条**有基准佐证**：基准抓到的是 `month=8`（不是 `08`）', async () => {
    const { cap, calls } = build()
    // 用 helper 把"2026-08"喂进去 —— 若实现补零，发出去的就是 `08`，与基准不符
    await cap.getAnalysisPersonSummary(buildPersonYearMonth('2026-08'))
    expect(queryPairs(String(calls[0]?.url))).toEqual([['year', '2026'], ['month', '8'], ['_t', '<ts>']])
    // 基准那一条本身就是单数字的 8
    expect(queryPairs(pick(baseGets(), 0, "person GET").url)).toContainEqual(['month', '8'])
    expect(String(pick(baseGets(), 0, "person GET").url)).not.toContain('month=08')
  })

  it('空值照发：不传时 year= / month= 仍在 URL 上', async () => {
    const { cap, calls } = build()
    await cap.getAnalysisPersonSummary({ year: '', month: '' })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['year', ''],
      ['month', ''],
      ['_t', '<ts>'],
    ])
  })
})

// ---------------------------------------------------------------------------
// 年月 helper：三页三种格式，别互相照抄
// ---------------------------------------------------------------------------

describe('年月 helper —— 三个页面的三种类型', () => {
  it('buildSalaryYearMonth：year 是字符串、month 是数字', () => {
    const out = buildSalaryYearMonth('2026-09')
    expect(out).toEqual({ year: '2026', month: 9 })
    expect(typeof out.year).toBe('string')
    expect(typeof out.month).toBe('number')
  })

  it('buildPersonYearMonth：**两个都是字符串**，month 不补零', () => {
    expect(buildPersonYearMonth('2026-09')).toEqual({ year: '2026', month: '9' })
    expect(buildPersonYearMonth('2026-10')).toEqual({ year: '2026', month: '10' })
  })

  it('buildDeptYearMonth：**两个都是数字**（与个人分析页相反）', () => {
    expect(buildDeptYearMonth('2026-09')).toEqual({ year: 2026, month: 9 })
  })

  it('三个 helper 都接受带日期的同格式字符串', () => {
    expect(buildSalaryYearMonth('2026-09-21')).toEqual({ year: '2026', month: 9 })
    expect(buildPersonYearMonth('2026-09-21')).toEqual({ year: '2026', month: '9' })
    expect(buildDeptYearMonth('2026-09-21')).toEqual({ year: 2026, month: 9 })
  })

  it('格式不对 / 月份越界 → 抛错，不静默算成 NaN', () => {
    expect(() => buildSalaryYearMonth('2026/09')).toThrow(/YYYY-MM/)
    expect(() => buildSalaryYearMonth('')).toThrow(/YYYY-MM/)
    expect(() => buildDeptYearMonth('2026-13')).toThrow(/1\.\.12/)
  })
})

// ---------------------------------------------------------------------------
// 能力定义本身
// ---------------------------------------------------------------------------

describe('能力定义', () => {
  it('新增动作的 ID 参数发布为数组语义', () => {
    const findParam = (id: string, name: string) => {
      const capability = perfSalaryCapabilities.find((item) => item.id === id)
      return capability?.params.find((param) => param.name === name)
    }
    expect(findParam('perf-salary-adjust-save', 'idList')?.description).toContain('(string | number)[]')
    expect(findParam('perf-salary-examine-result-remove', 'ids')?.description).toContain('(string | number)[]')
  })

  it('pagePath 与 page-catalog.json 的 menuPath 逐字相同', () => {
    const catalog = JSON.parse(
      readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
    ) as { items: Array<{ menuPath: string; title: string }> }
    const known = new Set(catalog.items.map((p) => p.menuPath))
    for (const cap of perfSalaryCapabilities) {
      expect(known.has(cap.pagePath), `${cap.id} 的 pagePath 不在 page-catalog 里`).toBe(true)
    }
    // 六页一个不落 —— 少一页就说明 pagePath 写错成了别页的路径
    expect(new Set(perfSalaryCapabilities.map((c) => c.pagePath))).toEqual(
      new Set([
        PERF_SALARY_MAIN_PAGE_PATH,
        PERF_SALARY_ADJUST_PAGE_PATH,
        PERF_SALARY_EXAMINE_RESULT_PAGE_PATH,
        PERF_BLOCK_MAIN_PAGE_PATH,
        PERF_ANALYSIS_DEPARTMENT_PAGE_PATH,
        PERF_ANALYSIS_PERSON_PAGE_PATH,
      ]),
    )
  })

  it('动作能力的读写边界与 Portal 入口一致', () => {
    const writes = perfSalaryCapabilities.filter((c) => c.write).map((c) => c.id)
    expect(writes).toEqual([
      'perf-salary-main-import',
      'perf-salary-adjust-save',
      'perf-salary-examine-result-create',
      'perf-salary-examine-result-update',
      'perf-salary-examine-result-remove',
      'perf-salary-examine-result-import',
      'perf-block-main-set-status',
    ])
    expect(perfSalaryCapabilities.filter((c) => c.id.includes('prepare')).every((c) => c.write === false)).toBe(true)
  })

  it('本节点每条动作能力都有对应的请求/校验测试证据', () => {
    const actionIds = [
      'perf-salary-main-download-template',
      'perf-salary-main-export',
      'perf-salary-main-prepare-import',
      'perf-salary-main-import',
      'perf-salary-adjust-prepare-save',
      'perf-salary-adjust-save',
      'perf-salary-examine-result-get',
      'perf-salary-examine-result-prepare-create',
      'perf-salary-examine-result-create',
      'perf-salary-examine-result-prepare-update',
      'perf-salary-examine-result-update',
      'perf-salary-examine-result-prepare-remove',
      'perf-salary-examine-result-remove',
      'perf-salary-examine-result-prepare-import',
      'perf-salary-examine-result-import',
      'perf-salary-examine-result-download-template',
      'perf-block-main-prepare-status',
      'perf-block-main-set-status',
    ]
    expect(actionIds).toHaveLength(18)
    expect(actionIds.every((id) => perfSalaryCapabilities.some((capability) => capability.id === id))).toBe(true)
    expect(perfSalaryCapabilities.some((capability) => capability.id === 'perf-block-main-list')).toBe(true)
  })

  it('二十八个能力覆盖六个页面（读、prepare 与 Portal 实际写入口）', () => {
    // 25 → 28：新增的是管理分析隐藏下钻页的三条读能力（见下面的专项 describe）。
    expect(perfSalaryCapabilities).toHaveLength(28)
    expect(new Set(perfSalaryCapabilities.map((c) => c.pagePath)).size).toBe(6)
  })

  it('三条下钻能力挂在管理分析页上、都是只读、参数只收 protocolId（外加列表模块的 order/orderField）', () => {
    for (const id of [
      'perf-analysis-department-self-assessment-task-check-detail',
      'perf-analysis-department-index-check-detail',
      'perf-analysis-department-self-check-profit',
    ]) {
      const definition = perfSalaryCapabilities.find((item) => item.id === id)
      expect(definition, `${id} 没有登记`).toBeTruthy()
      expect(definition!.pagePath).toBe(PERF_ANALYSIS_DEPARTMENT_PAGE_PATH)
      expect(definition!.permission).toBe('/dashboard/analysis/department')
      expect(definition!.write).toBe(false)
      expect(definition!.params.some((param) => param.name === 'protocolId')).toBe(true)
      // 分页两项一律没有：这一页的三个端点都不分页
      expect(definition!.params.some((param) => param.name === 'pageNo')).toBe(false)
      expect(definition!.params.some((param) => param.name === 'pageSize')).toBe(false)
    }
    // 「考核任务」那一张表走 useListPageModule，所以多两个排序键；另两条没有
    const taskDetail = perfSalaryCapabilities.find((item) => item.id === 'perf-analysis-department-self-assessment-task-check-detail')!
    expect(taskDetail.params.map((param) => param.name)).toEqual(['order', 'orderField', 'protocolId'])
    const indexDetail = perfSalaryCapabilities.find((item) => item.id === 'perf-analysis-department-index-check-detail')!
    expect(indexDetail.params.map((param) => param.name)).toEqual(['protocolId'])
    const profitDetail = perfSalaryCapabilities.find((item) => item.id === 'perf-analysis-department-self-check-profit')!
    expect(profitDetail.params.map((param) => param.name)).toEqual(['protocolId'])
  })

  it('端点常量不是菜单路径（命名分工：`*_PAGE_PATH` 只给菜单路径）', () => {
    for (const url of [
      SALARY_MAIN_LIST_URL,
      SALARY_ADJUST_LIST_URL,
      SALARY_EXAMINE_RESULT_LIST_URL,
      BLOCK_MAIN_LIST_URL,
      ANALYSIS_DEPARTMENT_SELF_CHECK_URL,
      ...Object.values(ANALYSIS_DEPARTMENT_URLS),
      ...Object.values(ANALYSIS_PERSON_URLS),
    ]) {
      expect(url.startsWith('/dashboard/')).toBe(false)
    }
  })

  it('组织候选那条（getRoleOrganizationTree）**没有**被做成能力', () => {
    expect(perfSalaryCapabilities.some((c) => c.id.includes('org'))).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// 管理分析隐藏下钻页（`./detail/item`）的三条能力
//
// ⚠️ 这里**没有基准可对**：基准抓的是页面挂载时的请求，下钻页要真的点进去才有流量。
// 所以这一组锁的是"源码里的调用形状 + 契约语义"，不是"与浏览器逐字段一致"。
// ---------------------------------------------------------------------------

describe('管理分析下钻页 —— 请求形状与返回透传', () => {
  const PAGE = PERF_ANALYSIS_DEPARTMENT_PAGE_PATH
  const TASK_URL = ANALYSIS_DEPARTMENT_DETAIL_URLS.selfAssessmentTaskCheckDetail
  const INDEX_URL = ANALYSIS_DEPARTMENT_DETAIL_URLS.selfIndexCheckDetail
  const PROFIT_URL = ANALYSIS_DEPARTMENT_DETAIL_URLS.selfCheckProfit

  it('三个端点互不相同，且都不是同页那条自查分析 POST /selfCheck（**不许合并**）', () => {
    expect(new Set([TASK_URL, INDEX_URL, PROFIT_URL]).size).toBe(3)
    for (const url of [TASK_URL, INDEX_URL, PROFIT_URL]) {
      expect(url).not.toBe(ANALYSIS_DEPARTMENT_SELF_CHECK_URL)
      // 同页四条 /selfCheck* 前缀不同：这三条是隐藏下钻，那条是自查列表
      expect(url.startsWith('/performance/statistics/homepage/')).toBe(true)
    }
    expect(TASK_URL).toBe('/performance/statistics/homepage/selfAssessmentTaskCheckDetail')
    expect(INDEX_URL).toBe('/performance/statistics/homepage/selfIndexCheckDetail')
    expect(PROFIT_URL).toBe('/performance/statistics/homepage/selfCheckProfit')
  })

  it('考核任务：GET、参数键序 order → orderField → protocolId、无分页、`_t` 在最后', async () => {
    const { cap, calls } = build([])
    await cap.listAnalysisDepartmentTaskCheckDetail({ protocolId: 77 })
    const sent = queryPairs(String(calls[0]?.url))
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(sent.map(([key]) => key)).toEqual(['order', 'orderField', 'protocolId', '_t'])
    expect(sent[0]?.[1]).toBe('')
    expect(sent[1]?.[1]).toBe('')
    expect(sent[2]?.[1]).toBe('77')
    expect(calls[0]?.url).toContain(TASK_URL)
    // getDataListIsPage 默认 false ⇒ 页面与 SDK 都不发分页
    expect(String(calls[0]?.url)).not.toContain('pageNo')
    expect(String(calls[0]?.url)).not.toContain('pageSize')
  })

  it('考核任务：返回的是**数组本身**（不是 { list, total }），元素与附件原样透传', async () => {
    const row = {
      taskId: 501,
      title: '月度重点工作',
      content: '完成说明',
      baseCore: 10,
      baseCoreOneself: 8,
      baseCoreByLeader: 10,
      isSpecial: 0,
      attachment: [{ id: 9, fileName: 'a.pdf', fileUrl: 'https://example.invalid/a.pdf', fileType: 3 }],
    }
    const { cap } = build([row])
    const list = await cap.listAnalysisDepartmentTaskCheckDetail({ protocolId: 77 })
    // 后端返回数组 ⇒ SDK 也返回数组：不能被包装成 { list, total }
    expect(Array.isArray(list)).toBe(true)
    expect(list).toEqual([row])
    expect(Array.isArray(list[0]?.attachment)).toBe(true)
    expect(list[0]?.attachment?.[0]?.fileUrl).toBe('https://example.invalid/a.pdf')
  })

  it('考核任务：protocolId 缺失或非法时**同步抛错**且一条请求都不发（页面没它同样查不出东西）', async () => {
    const { cap, calls } = build([])
    expect(() => cap.listAnalysisDepartmentTaskCheckDetail({} as never)).toThrow(/protocolId/)
    expect(() => cap.listAnalysisDepartmentTaskCheckDetail({ protocolId: '0' } as never)).toThrow(/protocolId/)
    expect(() => cap.listAnalysisDepartmentTaskCheckDetail({ protocolId: 1.5 } as never)).toThrow(/protocolId/)
    expect(calls).toHaveLength(0)
  })

  it('考核指标：GET、**只有 protocolId**（连 order/orderField 都没有）、`_t` 在最后', async () => {
    const { cap, calls } = build([])
    await cap.listAnalysisDepartmentIndexCheckDetail({ protocolId: '88' })
    const sent = queryPairs(String(calls[0]?.url))
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(sent.map(([key]) => key)).toEqual(['protocolId', '_t'])
    expect(sent[0]?.[1]).toBe('88')
    expect(calls[0]?.url).toContain(INDEX_URL)
  })

  it('考核指标：返回数组，`targetList`/`expected`/`isUserImport` 都不被改写', async () => {
    const row = {
      id: 31,
      name: '出栏量',
      unit: '万只',
      score: 20,
      actualScore: 18,
      actualIndicator: 95,
      resourceType: 1,
      targetList: [{ lineName: '完成线', expected: 100, forecastIndicator: 98, dataList: [1, 2, 3] }],
    }
    const imported = { id: 32, name: '导入指标', score: 5, isUserImport: 1, targetList: [{ lineName: '完成线', forecastIndicator: 7 }] }
    const { cap } = build([row, imported])
    const list = await cap.listAnalysisDepartmentIndexCheckDetail({ protocolId: 88 })
    expect(list).toEqual([row, imported])
    // isUserImport 的行**不补** expected —— SDK 不替后端补字段
    expect(list[1]?.targetList?.[0]?.expected).toBeUndefined()
  })

  it('利润工资：GET、**只有 protocolId**；返回的组件行原样透传（type 恒 15 由后端保证，SDK 不重复过滤）', async () => {
    const row = { id: 61, type: 15, canDel: 0, value: [{ id: 7, name: '利润A', proportion: 60, actualIndicator: 12, profitList: [{ lineName: '完成线', forecastIndicator: 3 }] }] }
    const { cap, calls } = build([row])
    const list = await cap.listAnalysisDepartmentProfitCheck({ protocolId: 99 })
    expect(calls[0]?.method?.toUpperCase()).toBe('GET')
    expect(queryPairs(String(calls[0]?.url)).map(([key]) => key)).toEqual(['protocolId', '_t'])
    expect(calls[0]?.url).toContain(PROFIT_URL)
    expect(list).toEqual([row])
    expect(list[0]?.type).toBe(15)
    // 组件值在 value 里 —— 不是被摊平到行上
    expect(Array.isArray(list[0]?.value)).toBe(true)
  })

  it('三条都走管理分析页的上下文（module-type 13），不是个人分析页', async () => {
    const { cap, calls } = build([])
    await cap.listAnalysisDepartmentTaskCheckDetail({ protocolId: 1 })
    await cap.listAnalysisDepartmentIndexCheckDetail({ protocolId: 1 })
    await cap.listAnalysisDepartmentProfitCheck({ protocolId: 1 })
    expect(calls).toHaveLength(3)
    for (const call of calls) expect(call.headers['module-type']).toBe('13')
    expect(calls.map((call) => normalize(String(call.url)))).toEqual([
      `/admin-api${TASK_URL}?order=&orderField=&protocolId=1&_t=<ts>`,
      `/admin-api${INDEX_URL}?protocolId=1&_t=<ts>`,
      `/admin-api${PROFIT_URL}?protocolId=1&_t=<ts>`,
    ])
  })
})

describe('管理分析下钻页 —— AI 说明契约', () => {
  const IDS = [
    'perf-analysis-department-self-assessment-task-check-detail',
    'perf-analysis-department-index-check-detail',
    'perf-analysis-department-self-check-profit',
  ] as const

  it('三条各有契约，且必填章节都不为空', () => {
    for (const id of IDS) {
      const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS[id]
      expect(contract, `${id} 缺契约`).toBeTruthy()
      expect(contract!.purpose.length).toBeGreaterThan(8)
      expect(contract!.whenToUse.length).toBeGreaterThan(8)
      expect(contract!.boundaries.length).toBeGreaterThan(0)
      expect(contract!.prerequisites.length).toBeGreaterThan(0)
      expect(contract!.consume.length).toBeGreaterThan(0)
      expect(contract!.completion.length).toBeGreaterThan(8)
      expect(contract!.failures.length).toBeGreaterThan(0)
      expect(contract!.evidence.length).toBeGreaterThan(0)
      expect(contract!.gaps?.length, `${id} 必须如实登记缺口`).toBeGreaterThan(0)
      expect(contract!.effect).toBe('read')
      expect(contract!.idempotency).toBeNull()
      expect(contract!.inputs.protocolId?.required).toBe(true)
    }
  })

  it('三条都写明"隐藏路由、只读、返回原序"，并指向自查分析那条的来源', () => {
    for (const id of IDS) {
      const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS[id]!
      const boundaries = contract.boundaries.join('\n')
      expect(boundaries).toContain('detail/item')
      expect(boundaries).toContain('/dashboard/analysis/department')
      expect(contract.inputs.protocolId?.source).toContain('perf-analysis-department-self-check')
      // 来源必须点名 protocolId 这个字段本身（写成 taskId / userId 这类别的 id 会红）
      expect(contract.inputs.protocolId?.source).toContain('protocolId')
      // 「返回的是端点的原数组与原顺序」必须写在说明里（不重排、不改写）
      expect(boundaries).toContain('原顺序')
    }
  })

  it('考核任务的说明写对了两件关键语义：三档重排靠"分量 ≠ 基本分"，特殊行只显示 special*', () => {
    const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS['perf-analysis-department-self-assessment-task-check-detail']!
    const boundary = contract.boundaries.join('\n')
    // ⚠️ 把"分量与基本分比较"写成"分数大小"就会红
    expect(boundary).toContain('分量与基本分的比较')
    expect(boundary).toContain('不是靠分数大小')
    expect(boundary).toContain('isSpecial=1')
    expect(boundary).toContain('special')
    const consume = contract.consume.join('\n')
    expect(consume).toContain('initSortData')
    expect(consume).toContain('baseCoreByLeader 不等于 baseCore')
    expect(consume).toContain('baseCoreOneself 不等于 baseCore')
    // 头部分数不是任务分之和 —— 这句话被写反过，钉住它
    expect(consume).toContain('不是这些任务分之和')
    const isSpecial = contract.output.fields.find(field => field.path === 'isSpecial')!
    expect(isSpecial.values).toEqual({ '0': '普通考核工作', '1': '特殊考核工作' })
    expect(isSpecial.constraints?.join('')).toContain('严格等于')
  })

  it('考核任务的附件说明点明 fileUrl 是外链、SDK 不下载', () => {
    const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS['perf-analysis-department-self-assessment-task-check-detail']!
    const fileUrl = contract.output.fields.find(field => field.path === 'attachment[].fileUrl')!
    expect(fileUrl.meaning).toContain('window.open')
    expect(fileUrl.constraints?.join('')).toContain('外链')
    const attachment = contract.output.fields.find(field => field.path === 'attachment')!
    expect(attachment.meaning).toContain('空数组')
  })

  it('考核指标的说明点明"只返回第一跳 + 页面还要打 targetInfo + 导入行没有 expected"', () => {
    const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS['perf-analysis-department-index-check-detail']!
    const boundary = contract.boundaries.join('\n')
    expect(boundary).toContain('/performance/basedata/kpitarget/targetInfo')
    expect(boundary).toContain('isUserImport === 1')
    expect(boundary).toContain('不设 expected')
    expect(boundary).toContain('actual')
    // 单位回退是页面行为，SDK 不做
    const unit = contract.output.fields.find(field => field.path === 'unit')!
    expect(unit.meaning).toContain('万元')
    expect(unit.meaning).toContain('不做这个回退')
    expect(unit.nullMeaning).toContain('没有写单位')
    // 第二跳缺失必须进 gaps，不能悄悄略过
    expect(contract.gaps?.join('\n')).toContain('targetInfo')
    const expected = contract.output.fields.find(field => field.path === 'targetList[].expected')!
    expect(expected.meaning).toContain('页面「预测指标」一列显示的就是它')
    // ⚠️ 这两个字段最容易写反：forecastIndicator 不是页面「预测指标」列取的字段
    const forecastIndicator = contract.output.fields.find(field => field.path === 'targetList[].forecastIndicator')!
    expect(forecastIndicator.meaning).toContain('**不**取它')
  })

  it('利润工资的说明写对了 Controller 泛型与实现层的差别，以及 type 恒为 15', () => {
    const contract = PERF_ANALYSIS_DEPARTMENT_DETAIL_CONTRACTS['perf-analysis-department-self-check-profit']!
    const boundary = contract.boundaries.join('\n')
    // ⚠️ 把"只能从实现层看"删掉、或把 List<ProtocolSubassemblyDTO> 说成别的，都会红
    expect(boundary).toContain('CommonResult<Object>')
    expect(boundary).toContain('List<ProtocolSubassemblyDTO>')
    expect(boundary).toContain('type == 15')
    // 那个坑：后端根本不会返回 type != 15 的行
    const type = contract.output.fields.find(field => field.path === 'type')!
    expect(type.values).toEqual({ '15': '月度利润组件' })
    // 业务数据在 value 里，页面只取第一条
    const value = contract.output.fields.find(field => field.path === 'value')!
    expect(value.meaning).toContain('利润列表')
    expect(contract.boundaries.join('\n')).toContain('第一条')
    // 空数组不是错误（协议里没有利润组件）
    expect(contract.output.empty).toContain('[]')
    expect(contract.output.empty).toContain('不代表')
  })
})

describe('实际 SDK 接线与写入防重', () => {
  it('invoke 写入要求 requestId，复用同一 requestId 只发一次且不进 Portal body', async () => {
    const { sdk, calls } = makeSdk()
    const draft = { adjustScore: 1, idList: [101] }

    await sdk.capabilities.invoke('perf-salary-adjust-save', { ...draft, requestId: 'perf-salary-save-test-1' })
    await sdk.capabilities.invoke('perf-salary-adjust-save', { ...draft, requestId: 'perf-salary-save-test-1' })

    expect(calls).toHaveLength(1)
    expect(bodyPairs(calls[0]?.data)).toEqual([
      ['adjustScore', 1],
      ['adjustProfit', ''],
      ['adjustRemark', ''],
      ['idList', [101]],
    ])
    expect(JSON.parse(String(calls[0]?.data))).not.toHaveProperty('requestId')
    expect(calls[0]?.headers['module-type']).toBe('13')
  })

  it('invoke 缺少 requestId 时在发请求前失败', async () => {
    const { sdk, calls } = makeSdk()
    await expect(sdk.capabilities.invoke('perf-salary-adjust-save', { adjustScore: 1, idList: [101] })).rejects.toThrow(/requestId/)
    expect(calls).toHaveLength(0)
  })
})
