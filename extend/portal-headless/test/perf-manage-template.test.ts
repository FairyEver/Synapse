import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, AxiosRequestHeaders, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/session/types.js'
import {
  createPerfManageTemplateCapability,
  filterTreeNodeByName,
  isProfitLeaf,
  isTemplateLeaf,
  normalizeSalaryStructurePage,
  perfManageTemplateCapabilities,
  PERF_MANAGE_TEMPLATE_METHODS,
  PERF_MANAGE_ROUTE_FILES,
  PROFIT_PAGE_PATH,
  SALARY_STRUCTURE_MAX_PAGE_SIZE,
  SALARY_STRUCTURE_PAGE_PATH,
  SALARY_STRUCTURE_SEARCH_PATH,
  SALARY_STRUCTURE_TREE_PATH,
  STUDY_TASK_CONFIG_PAGE_PATH,
  TASK_TYPE_CONFIG_PAGE_PATH,
  TEMPLATE_CONTENT_PAGE_PATH,
  TEMPLATE_STRUCTURE_PAGE_PATH,
  TEMPLATE_TYPE_MONTH,
  TEMPLATE_TYPE_YEAR,
  unwrapTaskTypeList,
} from '../src/capabilities/perf-manage-template.js'
import { createPortalHeadless } from '../src/index.js'

/**
 * 绩效管理域「模板/任务类」六页的回归测试。
 *
 * 基准：`baseline/perf-manage-template.browser.json`（六页各一条真实请求）。
 *
 * ⚠️ 这份测试里有一条**特别重要**的：薪资结构那一页的**本地 Portal 检出是旧版**
 * （`…/kpisalarystructure/page`、无分页、名称本地过滤），线上跑的是另一版
 * （`treePage`/`searchPage` + 按层分页，见 `2f29dd5f291 fix(hr): 适配树数据按层分页与回显`）。
 * 所以这一页的断言**全部以基准为准**，不能拿本地源码去"纠正"它 ——
 * 谁把实现改回 `…/page`，下面那几条就会红。
 *
 * 分工与其余几条线一致：这份管「参数契约与浏览器基准的逐字段一致性」；
 * 真实环境的验证记录在六份 `docs/pages/*.md` 的「真实验证」一节
 * （这一波没有跑冒烟，见各文档如实标注的部分）。
 */

type BaselineRequest = { pagePath: string; method: string; url: string; headers: Record<string, string>; body: unknown }
type Baseline = { requests: BaselineRequest[] }

const here = dirname(fileURLToPath(import.meta.url))
const BASELINE = JSON.parse(
  readFileSync(join(here, '../baseline/perf-manage-template.browser.json'), 'utf8'),
) as Baseline

/** 按页面取基准里那一条（每页恰好一条挂载请求） */
function reqOf (pagePath: string): BaselineRequest {
  const hit = BASELINE.requests.find((r) => r.pagePath === pagePath)
  if (!hit) throw new Error(`基准里找不到 ${pagePath}`)
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

/** 去掉 host + 归一化一次性时间戳 */
function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const ALL_PAGES = [
  PROFIT_PAGE_PATH,
  SALARY_STRUCTURE_PAGE_PATH,
  TEMPLATE_CONTENT_PAGE_PATH,
  TEMPLATE_STRUCTURE_PAGE_PATH,
  STUDY_TASK_CONFIG_PAGE_PATH,
  TASK_TYPE_CONFIG_PAGE_PATH,
]

/**
 * 六页各一个 `request`（与门面的接法一致）。adapter 记下每次调用，
 * 这样既能比 URL，也能比请求头。
 */
function makeSdk (data: unknown = []) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const at = (pagePath: string): PortalRequest =>
    <T,>(config: unknown) => sdk.call<T>(pagePath, config as never)
  const cap = createPerfManageTemplateCapability(
    at(PROFIT_PAGE_PATH),
    at(SALARY_STRUCTURE_PAGE_PATH),
    at(TEMPLATE_CONTENT_PAGE_PATH),
    at(TEMPLATE_STRUCTURE_PAGE_PATH),
    at(STUDY_TASK_CONFIG_PAGE_PATH),
    at(TASK_TYPE_CONFIG_PAGE_PATH),
  )
  return { sdk, calls, cap }
}

/** 一页一条：URL（含键顺序）与基准逐字段一致 */
function expectUrlMatchesBaseline (call: CapturedCall | undefined, pagePath: string): void {
  const base = reqOf(pagePath)
  expect(queryPairs(String(call?.url))).toEqual(queryPairs(base.url))
  expect(normalize(String(call?.url))).toBe(normalize(base.url))
}

// ---------------------------------------------------------------------------
// 逐页：URL 与基准逐字段一致
// ---------------------------------------------------------------------------

describe('六页的 URL 与浏览器基准逐字段一致（D20，含键顺序）', () => {
  it('利润管理 —— GET …/basedata/kpiprofit/page?order=&orderField=&_t=<ts>', async () => {
    const { cap, calls } = makeSdk()
    await cap.listProfits()
    expectUrlMatchesBaseline(calls[0], PROFIT_PAGE_PATH)
  })

  it('薪资结构 —— GET …/kpisalarystructure/treePage?parentId=0&keyword=&selection=false&pageNo=1&pageSize=20&_t=<ts>', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures()
    expectUrlMatchesBaseline(calls[0], SALARY_STRUCTURE_PAGE_PATH)
  })

  it('模板内容 —— GET …/temcontent/kpitemprotocol/page?order=&orderField=&templateType=0&_t=<ts>', async () => {
    const { cap, calls } = makeSdk()
    await cap.listTemplateContents()
    expectUrlMatchesBaseline(calls[0], TEMPLATE_CONTENT_PAGE_PATH)
  })

  it('模板结构 —— GET …/temstructure/kpitemstructure/page?order=&orderField=&templateType=0&_t=<ts>', async () => {
    const { cap, calls } = makeSdk()
    await cap.listTemplateStructures()
    expectUrlMatchesBaseline(calls[0], TEMPLATE_STRUCTURE_PAGE_PATH)
  })

  it('学习任务配置 —— GET …/study-task-config?_t=<ts>（**没有**任何查询参数）', async () => {
    const { cap, calls } = makeSdk({ status: 1 })
    await cap.getStudyTaskConfig()
    expectUrlMatchesBaseline(calls[0], STUDY_TASK_CONFIG_PAGE_PATH)
    // 「没有查询参数」这条要**显式**钉住：只有 _t 一个键
    expect(queryPairs(String(calls[0]?.url)).map(([k]) => k)).toEqual(['_t'])
  })

  it('任务类型配置 —— GET …/task-type-config/list?_t=<ts>（params 是显式空对象）', async () => {
    const { cap, calls } = makeSdk([])
    await cap.listTaskTypeConfigs()
    expectUrlMatchesBaseline(calls[0], TASK_TYPE_CONFIG_PAGE_PATH)
    expect(queryPairs(String(calls[0]?.url)).map(([k]) => k)).toEqual(['_t'])
  })

  it('六页的请求头与基准一致（module-type=13 绩效管理）', async () => {
    const { cap, calls } = makeSdk()
    await cap.listProfits()
    const base = reqOf(PROFIT_PAGE_PATH)
    const bag = calls[0]?.headers as AxiosRequestHeaders
    const sent: Record<string, string> = { ...bag.toJSON(), token: '<redacted>' }
    expect(sent).toEqual(base.headers)
  })
})

// ---------------------------------------------------------------------------
// 利润 / 模板两页：order/orderField 照发，名称本地过滤
// ---------------------------------------------------------------------------

describe('利润 / 模板内容 / 模板结构 —— 三个树页的共同点与各自的 pin', () => {
  it('order / orderField 是**空串也照发**（不是省略）', async () => {
    const { cap, calls } = makeSdk()
    await cap.listProfits()
    const url = String(calls[0]?.url)
    expect(url).toContain('order=&orderField=')
    expect(queryPairs(url).slice(0, 2)).toEqual([
      ['order', ''],
      ['orderField', ''],
    ])
  })

  it('⚠️ 「名称」**不上请求**：能力里没有 name/templateName 参数，传了也不发', async () => {
    const { cap, calls } = makeSdk()
    // 刻意绕开类型：`listProfits()` 本来就**不该**有参数，这里验证"就算塞了也不发"
    await (cap.listProfits as (query?: unknown) => Promise<unknown>)({ templateName: '销售利润' })
    const url = String(calls[0]?.url)
    expect(url).not.toContain('templateName')
    expect(url).not.toContain('name=')
    // 与没传时**完全一样** —— 这就是"本地过滤"的含义
    expectUrlMatchesBaseline(calls[0], PROFIT_PAGE_PATH)
  })

  it('模板两页的 templateType 默认 0（年度），可以换 1（月度）', async () => {
    const { cap, calls } = makeSdk()
    await cap.listTemplateContents()
    await cap.listTemplateContents({ templateType: TEMPLATE_TYPE_MONTH })
    await cap.listTemplateStructures()
    expect(String(calls[0]?.url)).toContain('templateType=0')
    expect(String(calls[1]?.url)).toContain('templateType=1')
    expect(String(calls[2]?.url)).toContain('templateType=0')
  })

  it('templateType 传 undefined 时回到默认 0（与页面下拉的初值一致，不会发空串）', async () => {
    const { cap, calls } = makeSdk()
    await cap.listTemplateStructures({ templateType: undefined })
    expect(String(calls[0]?.url)).toContain('templateType=0')
  })

  it('三个树页都**没有**分页参数（getDataListIsPage 默认 false）', async () => {
    const { cap, calls } = makeSdk()
    await cap.listProfits()
    await cap.listTemplateContents()
    await cap.listTemplateStructures()
    for (const call of calls) {
      expect(String(call.url)).not.toContain('pageNo=')
      expect(String(call.url)).not.toContain('pageSize=')
    }
  })
})

// ---------------------------------------------------------------------------
// 薪资结构：按层分页（与本地源码不一致的那一页）
// ---------------------------------------------------------------------------

describe('薪资结构 —— 按层分页（基准与本地源码不一致，按基准）', () => {
  it('默认打 treePage，而不是本地旧版的 /page', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures()
    expect(String(calls[0]?.url)).toContain(SALARY_STRUCTURE_TREE_PATH)
    expect(String(calls[0]?.url)).not.toMatch(/kpisalarystructure\/page/)
  })

  it('URL 上**没有** order/orderField（customLoad 自己拼的 params，没用模块那份）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures()
    const keys = queryPairs(String(calls[0]?.url)).map(([k]) => k)
    expect(keys).not.toContain('order')
    expect(keys).not.toContain('orderField')
    // 顺序就是页面那个对象字面量的键序
    expect(keys).toEqual(['parentId', 'keyword', 'selection', 'pageNo', 'pageSize', '_t'])
  })

  it('连 key 的**位置**都不能错：parentId 打头、pageNo/pageSize 在最后', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ parentId: 66, pageNo: 3, pageSize: 50 })
    expect(queryPairs(String(calls[0]?.url))).toEqual([
      ['parentId', '66'],
      ['keyword', ''],
      ['selection', 'false'],
      ['pageNo', '3'],
      ['pageSize', '50'],
      ['_t', '<ts>'],
    ])
  })

  it('keyword 非空 → 端点换成 searchPage，并自动带上 dataType=2', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ keyword: '销售' })
    const url = String(calls[0]?.url)
    expect(url).toContain(SALARY_STRUCTURE_SEARCH_PATH)
    expect(queryPairs(url)).toEqual([
      ['parentId', '0'],
      ['keyword', encodeURIComponent('销售')],
      ['dataType', '2'],
      ['selection', 'false'],
      ['pageNo', '1'],
      ['pageSize', '20'],
      ['_t', '<ts>'],
    ])
  })

  it('keyword 只由空格组成时**回到 treePage**（页面先 trim，且 dataType 必须整个不出现）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ keyword: '   ' })
    const url = String(calls[0]?.url)
    expect(url).toContain(SALARY_STRUCTURE_TREE_PATH)
    expect(url).not.toContain('dataType')
    expect(queryPairs(url)).toEqual(queryPairs(reqOf(SALARY_STRUCTURE_PAGE_PATH).url))
  })

  it('keyword 前后空格被 trim 掉（与页面 `(form.templateName || "").trim()` 一致）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ keyword: '  销售  ' })
    expect(String(calls[0]?.url)).toContain(`keyword=${encodeURIComponent('销售')}`)
  })

  it('pageSize 超过 100 会被压到 100（页面的 Math.min，后端也校验 1..100）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ pageSize: 500 })
    expect(String(calls[0]?.url)).toContain(`pageSize=${SALARY_STRUCTURE_MAX_PAGE_SIZE}`)
    expect(String(calls[0]?.url)).not.toContain('pageSize=500')
  })

  it('pageSize 传 0 / 负数 / NaN 时回默认 20（页面是 `Number(…) || 20`）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ pageSize: 0 })
    await cap.listSalaryStructures({ pageSize: -3 })
    await cap.listSalaryStructures({ pageSize: Number('abc') })
    for (const call of calls) expect(String(call.url)).toContain('pageSize=20')
  })

  it('⚠️ selection **钉死 false**：调用方传 true 也改不掉（它是页面身份，不是筛选）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures({ selection: true } as never)
    expect(String(calls[0]?.url)).toContain('selection=false')
    expect(String(calls[0]?.url)).not.toContain('selection=true')
  })

  it('响应里把 children 剥掉（页面最后一句 omit(node, ["children"])）', async () => {
    const { cap } = makeSdk({
      list: [{ id: 1, name: 'A', dataType: 1, children: [{ id: 2, name: 'a' }] }],
      total: 9,
    })
    const page = await cap.listSalaryStructures()
    expect(page).toEqual({ list: [{ id: 1, name: 'A', dataType: 1 }], total: 9 })
  })

  it('⚠️ 响应里没有 list 数组时**当场抛**，不静默返回空列表', async () => {
    // 静默返回空列表会让调用方以为"这一层真的没有薪资结构"，而实际是响应形状变了
    const { cap } = makeSdk({ something: 'else' })
    await expect(cap.listSalaryStructures()).rejects.toThrow(/没有 list 数组/)
    expect(() => normalizeSalaryStructurePage(undefined)).toThrow(/没有 list 数组/)
  })
})

// ---------------------------------------------------------------------------
// 后两页：不是列表页
// ---------------------------------------------------------------------------

describe('任务类型配置 —— 返回体的三种形状都按页面原样收', () => {
  it('unwrapTaskTypeList：数组 / {list} / {records} 都能拆；空则空数组', () => {
    const rows = [{ taskType: 1 }]
    expect(unwrapTaskTypeList(rows)).toEqual(rows)
    expect(unwrapTaskTypeList({ list: rows })).toEqual(rows)
    expect(unwrapTaskTypeList({ records: rows })).toEqual(rows)
    // 页面源码里还有一层 `result?.data || result`：SDK 拆过一次包络后，这里再拆一次
    expect(unwrapTaskTypeList({ data: rows })).toEqual(rows)
    expect(unwrapTaskTypeList(undefined)).toEqual([])
    expect(unwrapTaskTypeList(null)).toEqual([])
    expect(unwrapTaskTypeList({})).toEqual([])
  })

  it('listTaskTypeConfigs 把响应归一成数组（不是原样透传对象）', async () => {
    const { cap } = makeSdk({ list: [{ taskType: 3, taskTypeName: '客户拜访' }] })
    expect(await cap.listTaskTypeConfigs()).toEqual([{ taskType: 3, taskTypeName: '客户拜访' }])
  })

  it('学习任务配置：响应原样返回（不做归一）', async () => {
    const config = { weeklyProgressPercent: 25, morningProgressPercent: 5, status: 1 }
    const { cap } = makeSdk(config)
    expect(await cap.getStudyTaskConfig()).toEqual(config)
  })

  it('学习任务配置保存：POST 同一路径，body 只含页面五个字段并保留数值形状', async () => {
    const { cap, calls } = makeSdk()
    await cap.saveStudyTaskConfig({
      weeklyProgressPercent: 25,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 6,
      weeklyBonusScoreLimit: 2,
      status: 1,
    })
    expect(calls[0]).toMatchObject({
      url: '/admin-api/performance/protocol/kpimonthprotocol/study-task-config',
      method: 'post',
    })
    expect(String(calls[0]?.url)).not.toContain('?')
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      weeklyProgressPercent: 25,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 6,
      weeklyBonusScoreLimit: 2,
      status: 1,
    })
    const before = calls.length
    await expect(cap.saveStudyTaskConfig({
      weeklyProgressPercent: 0,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 6,
      weeklyBonusScoreLimit: 2,
      status: 1,
    })).rejects.toThrow(/weeklyProgressPercent/)
    expect(calls).toHaveLength(before)
    await expect(cap.saveStudyTaskConfig({
      weeklyProgressPercent: 1.234,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 6,
      weeklyBonusScoreLimit: 2,
      status: 1,
    })).rejects.toThrow(/2 位小数/)
    await expect(cap.saveStudyTaskConfig({
      weeklyProgressPercent: 25,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 1.5,
      weeklyBonusScoreLimit: 2,
      status: 1,
    })).rejects.toThrow(/整数/)
  })
})

// ---------------------------------------------------------------------------
// 本轮真实写入口：请求形状、页面校验与 prepare → submit 边界
// ---------------------------------------------------------------------------

describe('绩效模板/任务类型写入口 —— 逐项锁定 Portal 请求形状与坏输入', () => {
  it('利润删除递归收集整棵子树，submit 不会把多个 ids 误判成单条', async () => {
    const { cap, calls } = makeSdk()
    const prepared = cap.prepareProfitDelete({
      record: {
        id: '11',
        children: [
          { id: 22, children: [{ id: 33 }] },
        ],
      },
    })
    expect(prepared).toEqual({ draft: { ids: ['11', 22, 33] } })

    await cap.submitProfitDelete(prepared)
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ ids: ['11', 22, 33] })
    expect(Object.keys(JSON.parse(String(calls[0]?.data)))).toEqual(['ids'])

    await expect(cap.submitProfitDelete({ draft: { ids: [] } })).rejects.toThrow(/非空数组/)
    await expect(cap.submitProfitDelete({ draft: { ids: {} } } as never)).rejects.toThrow(/非空数组/)
    expect(calls).toHaveLength(1)
  })

  it('模板内容删除发送 Java 要求的裸数组，非法对象形状在请求前失败', async () => {
    const { cap, calls } = makeSdk()
    const prepared = cap.prepareTemplateContentDelete({
      record: {
        id: 101,
        children: [{ id: 102, children: [{ id: 103 }] }],
      },
    })
    await cap.submitTemplateContentDelete(prepared)
    expect(JSON.parse(String(calls[0]?.data))).toEqual([101, 102, 103])
    expect(Array.isArray(JSON.parse(String(calls[0]?.data)))).toBe(true)

    await expect(cap.submitTemplateContentDelete({ draft: { ids: {} } } as never)).rejects.toThrow(/不能为空/)
    expect(calls).toHaveLength(1)
  })

  it('利润导入严格保持 multipart 键序 file → type → parentId，并拒绝错误 MIME', async () => {
    const { cap, calls } = makeSdk([])
    const file = {
      fileName: '利润导入.xlsx',
      base64: 'UEs=',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
    const prepared = cap.prepareProfitImport({ file, type: 2, parentId: '' })
    await cap.submitProfitImport(prepared)

    const form = calls[0]?.data as FormData
    const entries = [...form.entries()]
    expect(entries.map(([key]) => key)).toEqual(['file', 'type', 'parentId'])
    expect(entries[0]?.[1]).toMatchObject({ name: '利润导入.xlsx', type: file.contentType })
    expect(entries[1]).toEqual(['type', '2'])
    expect(entries[2]).toEqual(['parentId', ''])

    await expect(cap.submitProfitImport({
      draft: { file: { ...file, contentType: 'application/vnd.ms-excel' }, type: 2, parentId: '' },
    })).rejects.toThrow(/只接受/)
    expect(calls).toHaveLength(1)
  })

  it('任务类型配置保留 Portal 的 id/body 键序，并锁定自评/公式互斥校验', async () => {
    const { cap, calls } = makeSdk(true)
    const input = {
      id: '91',
      taskType: 6,
      selfEditable: true,
      leaderEditable: true,
      progressScoring: false,
      formulaEnabled: false,
    }
    const prepared = cap.prepareTaskTypeConfigUpdate(input)
    expect(prepared).toEqual({
      draft: {
        id: '91',
        taskType: 6,
        selfEditable: true,
        leaderEditable: true,
        progressScoring: false,
      },
      formulaEnabled: false,
    })
    await expect(cap.submitTaskTypeConfigUpdate(prepared)).resolves.toBe(true)
    expect(calls[0]?.method?.toUpperCase()).toBe('PUT')
    const body = JSON.parse(String(calls[0]?.data)) as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['id', 'taskType', 'selfEditable', 'leaderEditable', 'progressScoring'])
    expect(body).toEqual(prepared.draft)

    expect(() => cap.prepareTaskTypeConfigUpdate({ ...input, leaderEditable: false })).toThrow(/领导必须可评分/)
    expect(() => cap.prepareTaskTypeConfigUpdate({ ...input, formulaEnabled: true, progressScoring: true })).toThrow(/公式/)
    expect(() => cap.prepareTaskTypeConfigUpdate({ ...input, taskType: 12 })).toThrow(/taskType/)

    const failed = makeSdk(false)
    await expect(failed.cap.submitTaskTypeConfigUpdate(prepared)).rejects.toThrow(/不是true/)
    expect(failed.calls).toHaveLength(1)
  })

  it('薪资结构启停按当前状态反转，目录与非法状态不能提交', async () => {
    const { cap, calls } = makeSdk()
    const prepared = cap.prepareSalaryStructureStatus({ id: 77, dataType: 2, currentStatus: 1 })
    expect(prepared).toEqual({ draft: { id: 77, status: 0 }, previousStatus: 1 })
    await cap.submitSalaryStructureStatus(prepared)
    expect(calls[0]?.method?.toUpperCase()).toBe('PUT')
    expect(JSON.parse(String(calls[0]?.data))).toEqual({ id: 77, status: 0 })

    expect(() => cap.prepareSalaryStructureStatus({ id: 77, dataType: 1, currentStatus: 1 })).toThrow(/dataType=2/)
    expect(() => cap.prepareSalaryStructureStatus({ id: 77, dataType: 2, currentStatus: 2 } as never)).toThrow(/currentStatus/)
    expect(() => cap.prepareSalaryStructureDelete({ record: { id: 77, dataType: 2, status: 1 } })).toThrow(/启用中/)
    expect(calls).toHaveLength(1)
  })

  it('模板详情保存清理年度任务字段和特殊组件空行，并拒绝缺失关联字段', async () => {
    const { cap, calls } = makeSdk()
    const detail = {
      id: 501,
      templateType: 0 as const,
      temStructureId: 601,
      salaryId: 701,
      orgTreeIdList: [801],
      subsectionList: [{
        title: 'section',
        assemblyList: [
          { type: '7', value: [{ id: 'keep' }, { title: 'keep-title' }, {}] },
          {
            type: '6',
            value: [{
              id: 'year-task',
              taskList: [{ name: 'task', taskType: 1, taskTypeName: '客户拜访', taskTypeOptions: [{ id: 1 }] }],
            }],
          },
        ],
      }],
    }
    const prepared = cap.prepareTemplateContentDetailSave(detail)
    const section = prepared.draft.subsectionList[0]
    expect(section?.assemblyList[0]).toEqual({
      type: '7',
      value: [{ id: 'keep' }, { title: 'keep-title' }],
    })
    expect(section?.assemblyList[1]).toEqual({
      type: '6',
      value: [{ id: 'year-task', taskList: [{ name: 'task' }] }],
    })
    const zeroedSpecial = cap.prepareTemplateContentDetailSave({ ...detail, isSpecial: 0, special: 9 } as never)
    expect(zeroedSpecial.draft.special).toBe(0)
    await cap.submitTemplateContentDetailSave(prepared)
    expect(calls[0]?.method?.toUpperCase()).toBe('POST')
    expect(JSON.parse(String(calls[0]?.data))).toEqual(prepared.draft)

    expect(() => cap.prepareTemplateContentDetailSave({ ...detail, orgTreeIdList: [] } as never)).toThrow(/orgTreeIdList/)
    expect(() => cap.prepareTemplateContentDetailSave({ ...detail, templateType: 1 } as never)).toThrow(/yearProtocolId/)
    expect(() => cap.prepareTemplateContentDetailSave({ ...detail, isSpecial: 1 } as never)).toThrow(/special/)
    expect(calls).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// 本地过滤 helper（三个树页共用；薪资结构那页不在其列）
// ---------------------------------------------------------------------------

describe('filterTreeNodeByName —— 复刻三个树页的客户端过滤', () => {
  const tree = [
    {
      id: 1,
      name: '华东销售',
      type: 1,
      children: [
        { id: 2, name: '销售利润', type: 2 },
        { id: 3, name: '销售费用', type: 2, children: [{ id: 4, name: '销售利润小计', type: 2 }] },
      ],
    },
    { id: 5, name: '其他利润', type: 2 },
  ]

  it('只命中**叶子**（目录名含关键字也不算），且**前序**（父先于子）', () => {
    expect(filterTreeNodeByName(tree, '销售', isProfitLeaf).map((r) => r.id)).toEqual([2, 3, 4])
  })

  it('命中结果里没有 children（页面 omit(item, ["children"])）', () => {
    const hit = filterTreeNodeByName(tree, '销售费用', isProfitLeaf)
    expect(hit).toHaveLength(1)
    expect(hit[0]).not.toHaveProperty('children')
  })

  it('关键字为空串 → 空数组（不是"全部"）', () => {
    expect(filterTreeNodeByName(tree, '', isProfitLeaf)).toEqual([])
  })

  it('模板两页的叶子判据是 type === 1（0 是文件夹）——同一棵树两种判据结果不同', () => {
    const templateTree = [
      { id: 1, name: '年度模板', type: 0, children: [{ id: 2, name: '年度模板内容', type: 1 }] },
    ]
    expect(filterTreeNodeByName(templateTree, '年度', isTemplateLeaf).map((r) => r.id)).toEqual([2])
    expect(filterTreeNodeByName(templateTree, '年度', isProfitLeaf)).toEqual([])
  })

  it('name 为 null 的节点被跳过（页面在这里会直接抛，SDK 选择不崩）', () => {
    expect(filterTreeNodeByName([{ id: 1, name: null as never, type: 2 }], 'x', isProfitLeaf)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// 能力定义
// ---------------------------------------------------------------------------

describe('能力定义：六页的查询与可达写动作，pagePath 与目录逐字一致', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string; title: string }> }

  it('能力定义与方法注册一一对应，覆盖六页全部读写动作', () => {
    expect(perfManageTemplateCapabilities).toHaveLength(Object.keys(PERF_MANAGE_TEMPLATE_METHODS).length)
    const ids = perfManageTemplateCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual(Object.keys(PERF_MANAGE_TEMPLATE_METHODS).sort())
    expect(ids.filter((id) => perfManageTemplateCapabilities.find((capability) => capability.id === id)?.write).length).toBeGreaterThan(0)
  })

  it.each([
    'perf-manage-profit-list',
    'perf-manage-salary-structure-list',
    'perf-manage-template-content-list',
    'perf-manage-template-structure-list',
    'perf-manage-study-task-config-get',
    'perf-manage-task-type-config-list',
  ])('六个查询能力按实际操作标记只读：%s', (id) => {
    // 页面另有编辑入口，不代表这里的查询能力会写数据。
    const definition = perfManageTemplateCapabilities.find((capability) => capability.id === id)
    expect(definition).toBeDefined()
    expect(definition?.write).toBe(false)
  })

  it('学习任务配置保存能力标记为写', () => {
    expect(perfManageTemplateCapabilities.find((c) => c.id === 'perf-manage-study-task-config-save')).toMatchObject({
      pagePath: STUDY_TASK_CONFIG_PAGE_PATH,
      permission: '/dashboard/manage/study-task-config',
      write: true,
    })
  })

  it('每个 pagePath 都在目录里，且**一页一条**', () => {
    for (const def of perfManageTemplateCapabilities) {
      expect(catalog.items.some((i) => i.menuPath === def.pagePath), `${def.id} 的 pagePath 不在目录里`).toBe(true)
    }
    const used = perfManageTemplateCapabilities.map((c) => c.pagePath)
    expect(new Set(used).size).toBe(6)
    expect([...new Set(used)].sort()).toEqual([...ALL_PAGES].sort())
  })

  it('六页都算得出 module-type = 13 绩效管理', () => {
    const { sdk } = makeSdk()
    for (const pagePath of ALL_PAGES) {
      const resolved = sdk.resolveModuleType(pagePath)
      expect(resolved.moduleType, pagePath).toBe(13)
    }
  })

  it('路由文件常量指向存在的路径形状（写文档时用）', () => {
    expect(PERF_MANAGE_ROUTE_FILES.profit).toBe('app/portal/views/dashboard/hr/manage/profit/list.vue')
    expect(PERF_MANAGE_ROUTE_FILES.salaryStructure).toContain('salary-structure/list.vue')
  })

  it('薪资结构是六页里唯一带业务参数的一页（其余三页树只有 pin、两页自定义页零参数）', () => {
    const byId = Object.fromEntries(perfManageTemplateCapabilities.map((c) => [c.id, c]))
    expect(byId['perf-manage-salary-structure-list']?.params.map((p) => p.name)).toEqual([
      'parentId',
      'keyword',
      'pageNo',
      'pageSize',
    ])
    expect(byId['perf-manage-profit-list']?.params).toEqual([])
    expect(byId['perf-manage-template-content-list']?.params.map((p) => p.name)).toEqual(['templateType'])
    // selection / dataType 是页面身份，**不在**参数表里 —— 它们由实现钉死
    expect(byId['perf-manage-salary-structure-list']?.params.map((p) => p.name)).not.toContain('selection')
    expect(byId['perf-manage-salary-structure-list']?.params.map((p) => p.name)).not.toContain('dataType')
  })
})

// ---------------------------------------------------------------------------
// 边界：这一页**不是** `page` 端点
// ---------------------------------------------------------------------------

describe('薪资结构那一页的旧契约必须**再也发不出来**', () => {
  it('不管怎么传，URL 里都不会出现 `kpisalarystructure/page`（本地旧版形状）', async () => {
    const { cap, calls } = makeSdk({ list: [], total: 0 })
    await cap.listSalaryStructures()
    await cap.listSalaryStructures({ keyword: 'x' })
    await cap.listSalaryStructures({ parentId: 1, pageNo: 2 })
    for (const call of calls) {
      expect(String(call.url)).not.toMatch(/kpisalarystructure\/page\?/)
    }
  })

  it('TEMPLATE_TYPE_MONTH 与 TEMPLATE_TYPE_YEAR 是 1 / 0（页面 define.js 的取值）', () => {
    expect(TEMPLATE_TYPE_YEAR).toBe(0)
    expect(TEMPLATE_TYPE_MONTH).toBe(1)
  })
})
