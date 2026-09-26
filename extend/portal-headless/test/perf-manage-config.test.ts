import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/session/types.js'

import {
  createPerfManageConfigCapability,
  INDICATOR_SAVE_DATA_URL,
  PERF_MANAGE_CONFIG_METHODS,
  perfManageConfigCapabilities,
  PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
  PERF_MANAGE_INDICATOR_PAGE_PATH,
  PERF_MANAGE_INSURANCE_PAGE_PATH,
  PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
  PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH,
  PERF_MANAGE_STANDARD_PAGE_PATH,
  PROTOCOL_CONFIG_DICT_TYPES,
  PROTOCOL_RULE_CODES,
  STANDARD_MAX_PAGE_SIZE,
  STANDARD_SAVE_DATA_URL,
} from '../src/capabilities/perf-manage-config.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig & { moduleType?: number; httpInstance?: string }

const here = dirname(fileURLToPath(import.meta.url))
const load = (name: string): Baseline => JSON.parse(readFileSync(join(here, `../baseline/${name}`), 'utf8'))

type BaselineRequest = { 页面: string; pagePath: string; method: string; url: string; body?: unknown }
type Baseline = { requests: BaselineRequest[] }

const BASE = load('perf-manage-config.browser.json')

/** 按页面 + URL 片段取基准里的那一条 */
function reqOf (baseline: Baseline, pagePath: string, match: RegExp): BaselineRequest {
  const hit = baseline.requests.find((r) => r.pagePath === pagePath && match.test(r.url))
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

function normalize (rawUrl: string): string {
  return rawUrl.replace(/^https?:\/\/[^/]+/, '').replace(/([?&]_t=)\d+/, '$1<ts>')
}

function readSource (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const keysOf = (rawUrl: string): string[] => queryPairs(rawUrl).map(([key]) => key)

/**
 * 六页各一个 `request`（与门面的接法一致）：记录 `call` 收到的配置，这样既能比 URL，
 * 也能看出请求级声明（实例 / module-type）。
 *
 * `respond` 用来换掉默认的假响应体（默认是 `{list, total}`，够比 URL 了）。
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
    cap: createPerfManageConfigCapability(
      at(PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH),
      at(PERF_MANAGE_INDICATOR_PAGE_PATH),
      at(PERF_MANAGE_INSURANCE_PAGE_PATH),
      at(PERF_MANAGE_STANDARD_PAGE_PATH),
      at(PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH),
      at(PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH),
    ),
  }
}

// ---------------------------------------------------------------------------
// 公式配置（`/dashboard/manage/formula-definition/list`）
// ---------------------------------------------------------------------------

describe('公式配置 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = build()
    await cap.listFormulaDefinitions()
    expect(queryPairs(String(calls[0]?.url))).toEqual(
      queryPairs(reqOf(BASE, PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH, /formula\/definition\/page/).url),
    )
    expect(normalize(String(calls[0]?.url))).toBe(
      normalize(reqOf(BASE, PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH, /formula\/definition\/page/).url),
    )
  })

  it('这一页**没有** order/orderField（它不走 useListPageModule），pageNo 打头', async () => {
    const { calls, cap } = build()
    await cap.listFormulaDefinitions()
    expect(keysOf(String(calls[0]?.url))).toEqual(['pageNo', 'pageSize', 'formulaName', '_t'])
  })

  it('taskType / enabled 不传时**整项不出现**（页面初值是 undefined，qs 的 skipNulls 丢掉）', async () => {
    const { calls, cap } = build()
    await cap.listFormulaDefinitions()
    const url = String(calls[0]?.url)
    expect(url).not.toContain('taskType=')
    expect(url).not.toContain('enabled=')
  })

  it('传了就按 pageNo → pageSize → taskType → formulaName → enabled 的顺序出现；false 照发', async () => {
    const { calls, cap } = build()
    await cap.listFormulaDefinitions({ taskType: 3, formulaName: '计分', enabled: false })
    const url = String(calls[0]?.url)
    expect(keysOf(url)).toEqual(['pageNo', 'pageSize', 'taskType', 'formulaName', 'enabled', '_t'])
    expect(url).toContain('enabled=false') // 布尔 false 不能被当成空值丢掉
    expect(url).toContain('formulaName=' + encodeURIComponent('计分'))
  })

  it('任务类型候选：scene/list 与基准那条逐字段一致（无参数，只有 _t）', async () => {
    const { calls, cap } = build()
    await cap.listFormulaScenes()
    expect(normalize(String(calls[0]?.url))).toBe(
      normalize(reqOf(BASE, PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH, /formula\/scene\/list/).url),
    )
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
  })
})

// ---------------------------------------------------------------------------
// 指标管理（`/dashboard/manage/indicator/list`）
// ---------------------------------------------------------------------------

describe('指标管理 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = build()
    await cap.listIndicators()
    expect(queryPairs(String(calls[0]?.url))).toEqual(
      queryPairs(reqOf(BASE, PERF_MANAGE_INDICATOR_PAGE_PATH, /kpitarget\/page/).url),
    )
  })

  it('**没有** pageNo/pageSize（这一页的 getDataListIsPage 是默认的 false）', async () => {
    const { calls, cap } = build()
    await cap.listIndicators()
    const keys = keysOf(String(calls[0]?.url))
    expect(keys).toEqual(['order', 'orderField', 'name', 'creatorName', 'targetType', 'type', '_t'])
    expect(keys).not.toContain('pageNo')
    expect(keys).not.toContain('pageSize')
  })

  it('四个筛选位都照发（空值也是空串），targetType 传值后进 URL', async () => {
    const { calls, cap } = build()
    await cap.listIndicators({ targetType: 2 })
    const url = String(calls[0]?.url)
    expect(url).toContain('name=&creatorName=&targetType=2&type=')
  })

  it('返回的是**树数组**（不是 {list,total}）', async () => {
    const { cap } = build(() => [{ id: 1, name: '根', children: [{ id: 2 }] }])
    const rows = await cap.listIndicators()
    expect(Array.isArray(rows)).toBe(true)
    expect(rows[0]?.children).toHaveLength(1)
  })

  it('指标详情保存按prepare→submit→cancel发送实际三段body', async () => {
    const { calls, cap } = build()
    const input = {
      targetId: 42,
      actualTarget: {
        year: 2026,
        targetDataList: [{ lineType: 'actual', lineName: '实际', formula: '', dataList: [1, 2] }],
      },
      forecastTarget: {
        year: 2026,
        targetDataList: [{ lineType: 'forecast', lineName: '预测', formula: 'x + 1', dataList: [3, 4], extra: 'keep' }],
      },
    }
    const prepared = cap.prepareIndicatorDataSave(input)
    expect(prepared).toEqual({ draft: input })
    expect(cap.cancelIndicatorDataSave()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)

    await cap.submitIndicatorDataSave(prepared)
    expect(calls[0]).toMatchObject({ url: `/admin-api${INDICATOR_SAVE_DATA_URL}`, method: 'post' })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      actualTarget: input.actualTarget,
      forecastTarget: input.forecastTarget,
      targetId: input.targetId,
    })
  })

  it('指标预测公式校验失败时不发保存请求', async () => {
    const { calls, cap } = build()
    expect(() => cap.prepareIndicatorDataSave({
      targetId: 42,
      actualTarget: { year: 2026, targetDataList: [] },
      forecastTarget: { year: 2026, targetDataList: [{ formula: '' }, { formula: 'x' }] },
    })).toThrow('指标公式不能为空')
    expect(calls).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// 五险一金（`/dashboard/manage/insurance/list`）
// ---------------------------------------------------------------------------

describe('五险一金 —— 与浏览器基准逐字段一致（D20）', () => {
  it('无筛选时的 URL 与基准完全相同（含键顺序，含分页）', async () => {
    const { calls, cap } = build()
    await cap.listInsuranceFunds()
    expect(queryPairs(String(calls[0]?.url))).toEqual(
      queryPairs(reqOf(BASE, PERF_MANAGE_INSURANCE_PAGE_PATH, /hrinsurancefund\/page/).url),
    )
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'order',
      'orderField',
      'name',
      'idcard',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('name / idcard 是真筛选参数，传值后进 URL；分页可改', async () => {
    const { calls, cap } = build()
    await cap.listInsuranceFunds({ name: '张三', idcard: '1101', pageNo: 2, pageSize: 50 })
    const url = String(calls[0]?.url)
    expect(url).toContain('name=' + encodeURIComponent('张三'))
    expect(url).toContain('idcard=1101')
    expect(url).toContain('pageNo=2&pageSize=50')
  })
})

// ---------------------------------------------------------------------------
// 标准管理（`/dashboard/manage/standard/list`）—— ⚠️ 本地检出是旧版，以基准为准
// ---------------------------------------------------------------------------

describe('标准管理（线上版：treePage / searchPage）—— 与浏览器基准逐字段一致（D20）', () => {
  it('无关键词时打 treePage，URL 与基准完全相同（含键顺序）', async () => {
    const { calls, cap } = build()
    await cap.listStandards()
    const base = reqOf(BASE, PERF_MANAGE_STANDARD_PAGE_PATH, /kpistandard\/treePage/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  it('键序是 parentId → keyword → selection → pageNo → pageSize（**没有** order/orderField）', async () => {
    const { calls, cap } = build()
    await cap.listStandards()
    expect(keysOf(String(calls[0]?.url))).toEqual([
      'parentId',
      'keyword',
      'selection',
      'pageNo',
      'pageSize',
      '_t',
    ])
  })

  it('selection 是页面写死的 false（后端那个字段默认 true），调用方改不了', async () => {
    const { calls, cap } = build()
    await cap.listStandards({ selection: true } as never)
    expect(String(calls[0]?.url)).toContain('selection=false')
  })

  it('parentId 默认 0，钻目录时换成节点 id', async () => {
    const { calls, cap } = build()
    await cap.listStandards({ parentId: 4242 })
    expect(String(calls[0]?.url)).toContain('parentId=4242')
  })

  it('关键词非空 → 切 searchPage，且顺带钉上 dataType=2；trim 由能力做', async () => {
    const { calls, cap } = build()
    await cap.listStandards({ keyword: '  蛋鸡  ' })
    const url = String(calls[0]?.url)
    expect(url).toContain('/kpistandard/searchPage')
    expect(url).not.toContain('/treePage')
    expect(keysOf(url)).toEqual(['parentId', 'keyword', 'dataType', 'selection', 'pageNo', 'pageSize', '_t'])
    expect(url).toContain('keyword=' + encodeURIComponent('蛋鸡'))
  })

  it('pageSize 钳到 100（后端硬校验 1..100），0/NaN 落回 20', async () => {
    const { calls, cap } = build()
    await cap.listStandards({ pageSize: 500 })
    expect(String(calls[0]?.url)).toContain('pageSize=100')
    await cap.listStandards({ pageSize: 0 })
    expect(String(calls[1]?.url)).toContain('pageSize=20')
    await cap.listStandards({ pageSize: 50 })
    expect(String(calls[2]?.url)).toContain('pageSize=50')
    expect(STANDARD_MAX_PAGE_SIZE).toBe(100)
  })

  it('返回值是 {list, total}（线上版是后端分页，不再是整棵树）', async () => {
    const { cap } = build(() => ({ list: [{ id: 1, name: '蛋鸡标准', type: 1 }], total: 37 }))
    const page = await cap.listStandards()
    expect(page.total).toBe(37)
    expect(page.list).toHaveLength(1)
  })

  it('标准详情保存按prepare→submit→cancel发送整个formState，不包装body', async () => {
    const { calls, cap } = build()
    const input = {
      id: 88,
      name: '指标标准',
      standardType: 1 as const,
      unit: '分',
      organizationList: [1001, 1002],
      header: ['优秀', '合格'],
      dataList: [{ standardKey: 2001, standardValue: ['90', '60'], extra: 'keep' }],
      orgTreeIdList: [3001],
      orgPostIdList: [4001],
      inheritedField: 'keep',
    }
    const prepared = cap.prepareStandardDataSave(input)
    expect(prepared).toEqual({ draft: input })
    expect(cap.cancelStandardDataSave()).toEqual({ cancelled: true })
    expect(calls).toHaveLength(0)

    await cap.submitStandardDataSave(prepared)
    expect(calls[0]).toMatchObject({ url: `/admin-api${STANDARD_SAVE_DATA_URL}`, method: 'post' })
    expect(JSON.parse(String(calls[0]?.data))).toEqual(input)
  })

  it('标准详情草稿缺字段时不发保存请求', async () => {
    const { calls, cap } = build()
    expect(() => cap.prepareStandardDataSave({
      id: 88,
      name: '指标标准',
      standardType: 1,
      unit: '分',
      organizationList: [],
      header: ['优秀'],
      dataList: [{ standardKey: '', standardValue: ['90'] }],
      orgTreeIdList: [],
      orgPostIdList: [],
    } as never)).toThrow(/standardKey/)
    expect(calls).toHaveLength(0)
  })
})

describe('指标/标准详情保存 —— Portal 表单、权限与 Java DTO 静态证据', () => {
  it('逐页锁定两个POST的来源、字段和当前权限边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readSource(portalRoot, 'app/portal/menus/hr.js')
    const indicator = readSource(portalRoot, 'app/portal/views/dashboard/hr/manage/indicator/indicator-data.vue')
    const indicatorBatch = readSource(portalRoot, 'app/portal/views/dashboard/hr/manage/indicator/indicator-data-bat.vue')
    const indicatorController = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/basedata/controller/KpiTargetController.java')
    const saveTargetDto = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/basedata/dto/SaveTargetDataDTO.java')
    const targetDto = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/basedata/dto/TypeTargetDTO.java')
    const targetDataDto = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/basedata/dto/TargetDataDTO.java')
    const standard = readSource(portalRoot, 'app/portal/views/dashboard/hr/manage/standard/standard-data.vue')
    const standardController = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/standard/controller/KpiStandardController.java')
    const standardDto = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/standard/dto/StandardDataDTO.java')
    const standardRowDto = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/standard/dto/KpiStandardDataDTO.java')
    const standardService = readSource(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/performance/standard/service/impl/KpiStandardServiceImpl.java')

    expect(menu).toContain(`path: '${PERF_MANAGE_INDICATOR_PAGE_PATH}', permission: '/dashboard/manage/indicator'`)
    expect(menu).toContain(`path: '${PERF_MANAGE_STANDARD_PAGE_PATH}', permission: '/dashboard/manage/standard'`)
    for (const source of [indicator, indicatorBatch]) {
      for (const fragment of [
        "import { http } from 'app/portal/utils/http/platform.js'",
        "const data = pick(indicatorState.value, ['actualTarget', 'forecastTarget'])",
        "http.post('/performance/basedata/kpitarget/saveData'",
        'targetId: indicatorState.value.id',
        '$router.back',
      ]) expect(source).toContain(fragment)
    }
    for (const fragment of [
      '@PostMapping("saveData")',
      '@RequestBody SaveTargetDataDTO dto',
      'kpiTargetService.saveTargetData(dto)',
      '//@RequiresPermissions("basedata:kpiprofit:save")',
    ]) expect(indicatorController).toContain(fragment)
    for (const field of ['targetId', 'forecastTarget', 'actualTarget']) expect(saveTargetDto).toContain(`private ${field === 'targetId' ? 'Long' : 'TypeTargetDTO'} ${field};`)
    expect(targetDto).toContain('private Integer year;')
    expect(targetDto).toContain('private List<TargetDataDTO> targetDataList;')
    for (const field of ['lineType', 'lineName', 'formula', 'dataList', 'forecastIndicator', 'floatRatio', 'assessmentStandards']) expect(targetDataDto).toContain(`private ${field === 'dataList' ? 'List<BigDecimal>' : field === 'lineType' || field === 'lineName' || field === 'formula' ? 'String' : 'BigDecimal'} ${field};`)
    expect(targetDataDto).toContain('public BigDecimal expected;')

    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "http.post('/performance/kpistandard/saveStandardData', formState.value)",
      'organizationList: []',
      'header: []',
      'dataList: []',
      'orgTreeIdList: []',
      'orgPostIdList: []',
      'formState.value = {',
      'router.back()',
    ]) expect(standard).toContain(fragment)
    for (const fragment of [
      '@PostMapping("saveStandardData")',
      '@RequestBody StandardDataDTO dto',
      'kpiStandardService.saveStandardData(dto)',
      'ValidatorUtils.validateEntity(dto, AddGroup.class, DefaultGroup.class)',
    ]) expect(standardController).toContain(fragment)
    for (const field of ['id', 'name', 'standardType', 'unit', 'organizationList', 'header', 'dataList', 'orgPostIdList', 'orgTreeIdList']) expect(standardDto).toContain(`private ${field === 'id' ? 'Long' : field === 'standardType' ? 'Integer' : field === 'name' || field === 'unit' ? 'String' : field === 'header' ? 'List<String>' : field === 'dataList' ? 'List<KpiStandardDataDTO>' : 'List<Long>'} ${field};`)
    for (const field of ['standardKey', 'standardValue']) expect(standardRowDto).toContain(`private ${field === 'standardKey' ? 'Long' : 'List<String>'} ${field};`)
    for (const fragment of ['saveDTO.setOrganizationId(dto.getOrganizationList())', 'saveDTO.setOrgPostIdList(dto.getOrgPostIdList())', 'saveHeader(dto.getId(), dto.getHeader())', 'saveStandardData(dto.getId(), dto.getDataList())']) expect(standardService).toContain(fragment)
  })
})

// ---------------------------------------------------------------------------
// 时间节点（`/dashboard/manage/protocol-configuration/list`）—— 纯表单页
// ---------------------------------------------------------------------------

describe('时间节点（协议配置）—— 页面自己发的那两条与基准逐字段一致（D20）', () => {
  for (const dictType of PROTOCOL_CONFIG_DICT_TYPES) {
    it(`dictType=${dictType} 的字典类型请求与基准完全相同`, async () => {
      const { calls, cap } = build()
      await cap.getDictTypeId(dictType)
      const base = reqOf(
        BASE,
        PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
        new RegExp(`dict/type/page\\?dictType=${dictType}`),
      )
      expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    })
  }

  it('⚠️ 基准里**没有** grouped-list 那条（那是 app 外壳的全局字典）——本能力发它时一个筛选参数都不带', async () => {
    const { calls, cap } = build()
    await cap.readProtocolConfig()
    const url = String(calls[0]?.url)
    expect(url).toContain('/system/dict-data/grouped-list')
    expect(keysOf(url)).toEqual(['_t'])
    // 基准里**没有** grouped-list 那条 —— 它是 app 外壳拉的，别当成"基准漏了"。
    expect(BASE.requests.some((r) => /grouped-list/.test(r.url))).toBe(false)
    // ⚠️ 这里**刻意不数**这一页在基准里有几行：同一份基准里混着一条
    // `POST /homePage/save`（门户首页自己的布局自动保存，抓基准时被一起抓进来的噪声），
    // 数行数会让这条用例随"别人重新抓基准"而红，与本能力无关。噪声只在文档里记一笔。
  })

  it('readProtocolConfig 只挑出页面用到的那两组，别的 dictType 不返回', async () => {
    const { cap } = build(() => [
      { dictType: 'protocol_config', dataList: [{ label: '01-15 23:59:59', value: 'year_submit_review_time' }] },
      { dictType: 'template_prompt_content', dataList: [{ label: '写清依据', value: 'prompt' }] },
      { dictType: 'hen_brand', dataList: [{ label: 'x', value: 'y' }] },
    ])
    const both = await cap.readProtocolConfig()
    expect(Object.keys(both).sort()).toEqual(['protocol_config', 'template_prompt_content'])
    const one = await cap.readProtocolConfig('protocol_config')
    expect(Object.keys(one)).toEqual(['protocol_config'])
    // ⚠️ 键在 value、值在 label —— 时间节点的取值就存在 label 里
    expect(one.protocol_config?.[0]?.value).toBe('year_submit_review_time')
    expect(one.protocol_config?.[0]?.label).toBe('01-15 23:59:59')
  })

  it('枚举外的 dictType 当场抛，不发请求', async () => {
    const { calls, cap } = build()
    await expect(cap.readProtocolConfig('hen_brand' as never)).rejects.toThrow(/只认/)
    expect(calls).toHaveLength(0)
  })

  it('保存时先 PUT 日期数组，再 PUT 提示文案对象，body 只保留 Portal 的四个字段', async () => {
    const { calls, cap } = build()
    await cap.updateProtocolConfig({
      dateEntries: [
        { id: 101, dictValue: 'year_submit_review_time', dictLabel: '01-15 23:59:59', dictTypeId: 201 },
        { id: 102, dictValue: 'month_submit_review_time', dictLabel: '20 17:00:00', dictTypeId: 201 },
      ],
      contentEntry: { id: 301, dictValue: 'prompt', dictLabel: '按时完成', dictTypeId: 302 },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]).toMatchObject({ url: '/admin-api/sys/dict/data/updateList', method: 'put' })
    expect(JSON.parse(String(calls[0]?.data))).toEqual([
      { id: 101, dictValue: 'year_submit_review_time', dictLabel: '01-15 23:59:59', dictTypeId: 201 },
      { id: 102, dictValue: 'month_submit_review_time', dictLabel: '20 17:00:00', dictTypeId: 201 },
    ])
    expect(calls[1]).toMatchObject({ url: '/admin-api/sys/dict/data', method: 'put' })
    expect(JSON.parse(String(calls[1]?.data))).toEqual({
      id: 301,
      dictValue: 'prompt',
      dictLabel: '按时完成',
      dictTypeId: 302,
    })
  })
})

// ---------------------------------------------------------------------------
// 考核规则（`/dashboard/manage/protocol-deduct-rule/list`）
// ---------------------------------------------------------------------------

describe('考核规则 —— 与浏览器基准逐字段一致（D20）', () => {
  it('列表接口**零参数**（页面就是 http.get(url)），URL 与基准完全相同', async () => {
    const { calls, cap } = build()
    await cap.listProtocolDeductRules()
    const base = reqOf(BASE, PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH, /protocol-deduct-rule\/list/)
    expect(queryPairs(String(calls[0]?.url))).toEqual(queryPairs(base.url))
    expect(keysOf(String(calls[0]?.url))).toEqual(['_t'])
    expect(normalize(String(calls[0]?.url))).toBe(normalize(base.url))
  })

  it('get / history 的 ruleCode 排在最前（_t 在最后）', async () => {
    const { calls, cap } = build()
    await cap.getProtocolDeductRule('YEAR_PROTOCOL_SIGN')
    await cap.listProtocolDeductRuleHistory('MONTH_PROTOCOL_SCORE')
    expect(keysOf(String(calls[0]?.url))).toEqual(['ruleCode', '_t'])
    expect(String(calls[1]?.url)).toContain('/protocol-deduct-rule/history?ruleCode=MONTH_PROTOCOL_SCORE&')
  })

  it('空 ruleCode 直接拒绝，不发请求（后端是 @NotBlank）', async () => {
    const { calls, cap } = build()
    await expect(cap.getProtocolDeductRule('')).rejects.toThrow(/ruleCode/)
    await expect(cap.listProtocolDeductRuleHistory(undefined as never)).rejects.toThrow(/ruleCode/)
    expect(calls).toHaveLength(0)
  })

  it('固定六条规则的 ruleCode 是页面本地常量', () => {
    expect([...PROTOCOL_RULE_CODES]).toHaveLength(6)
    expect(PROTOCOL_RULE_CODES).toContain('YEAR_PROTOCOL_SIGN')
  })

  it('更新规则复刻编辑抽屉的 PUT body，并在固定六条之外拒绝请求', async () => {
    const { calls, cap } = build()
    await cap.updateProtocolDeductRule({
      ruleCode: 'MONTH_PROTOCOL_SCORE',
      enabled: false,
      deadlineType: 3,
      deadlineMonth: null,
      deadlineDay: 15,
      calculationMode: 2,
      singleScore: '1.5',
      maxScore: '8',
      version: 4,
    })
    expect(calls[0]).toMatchObject({ url: '/admin-api/performance/basedata/protocol-deduct-rule/update', method: 'put' })
    expect(JSON.parse(String(calls[0]?.data))).toEqual({
      ruleCode: 'MONTH_PROTOCOL_SCORE',
      enabled: false,
      deadlineType: 3,
      deadlineMonth: null,
      deadlineDay: 15,
      calculationMode: 2,
      singleScore: '1.5',
      maxScore: '8',
      version: 4,
    })
    const before = calls.length
    await expect(cap.updateProtocolDeductRule({
      ruleCode: 'NOT_A_RULE',
      enabled: true,
      deadlineType: 1,
      deadlineMonth: 1,
      deadlineDay: 1,
      calculationMode: 1,
      singleScore: '1',
      maxScore: '1',
      version: 1,
    })).rejects.toThrow(/固定六条/)
    expect(calls).toHaveLength(before)
  })

  it('更新规则沿用 Portal 的日期、分值和固定模式归一规则', async () => {
    const { calls, cap } = build()
    await cap.updateProtocolDeductRule({
      ruleCode: 'YEAR_PROTOCOL_SIGN',
      enabled: true,
      deadlineType: 1,
      deadlineMonth: 2,
      deadlineDay: 29,
      calculationMode: 1,
      singleScore: '01.50',
      maxScore: '99',
      version: 2,
    })
    expect(JSON.parse(String(calls[0]?.data))).toMatchObject({
      deadlineMonth: 2,
      deadlineDay: 29,
      singleScore: '1.5',
      maxScore: '1.5',
    })
    await expect(cap.updateProtocolDeductRule({
      ruleCode: 'YEAR_PROTOCOL_SIGN',
      enabled: true,
      deadlineType: 1,
      deadlineMonth: 2,
      deadlineDay: 30,
      calculationMode: 1,
      singleScore: '1',
      maxScore: '1',
      version: 2,
    })).rejects.toThrow(/日期/)
    await expect(cap.updateProtocolDeductRule({
      ruleCode: 'MONTH_PROTOCOL_SCORE',
      enabled: true,
      deadlineType: 2,
      deadlineMonth: null,
      deadlineDay: null,
      calculationMode: 2,
      singleScore: '1',
      maxScore: '0.5',
      version: 2,
    })).rejects.toThrow(/maxScore/)
    await expect(cap.updateProtocolDeductRule({
      ruleCode: 'MONTH_PROTOCOL_SCORE',
      enabled: true,
      deadlineType: 1,
      deadlineMonth: 2,
      deadlineDay: 29,
      calculationMode: 1,
      singleScore: '1',
      maxScore: '1',
      version: 2,
    })).rejects.toThrow(/月度规则|deadlineType/)
  })
})

// ---------------------------------------------------------------------------
// 能力定义本身：与目录（page-catalog.json）逐字对齐
// ---------------------------------------------------------------------------

describe('六页能力定义与 page-catalog.json 对齐', () => {
  const catalog = JSON.parse(
    readFileSync(join(here, '../generated/page-catalog.json'), 'utf8'),
  ) as { items: Array<{ menuPath: string; permission: string; title: string }> }

  it('每条定义的 pagePath 在目录里逐字存在（多一个字少一个字都要红）', () => {
    const paths = new Set(catalog.items.map((item) => item.menuPath))
    expect(perfManageConfigCapabilities).toHaveLength(37)
    for (const capability of perfManageConfigCapabilities) {
      expect(paths.has(capability.pagePath), `${capability.id} 的 pagePath 不在目录里：${capability.pagePath}`).toBe(
        true,
      )
    }
    expect([...new Set(perfManageConfigCapabilities.map((c) => c.pagePath))]).toEqual([
      PERF_MANAGE_FORMULA_DEFINITION_PAGE_PATH,
      PERF_MANAGE_INDICATOR_PAGE_PATH,
      PERF_MANAGE_INSURANCE_PAGE_PATH,
      PERF_MANAGE_STANDARD_PAGE_PATH,
      PERF_MANAGE_PROTOCOL_CONFIGURATION_PAGE_PATH,
      PERF_MANAGE_PROTOCOL_DEDUCT_RULE_PAGE_PATH,
    ])
  })

  it('permission 与目录里的权限码一致；读写标记与页面动作一致', () => {
    const byPath = new Map(catalog.items.map((item) => [item.menuPath, item]))
    for (const capability of perfManageConfigCapabilities) {
      const entry = byPath.get(capability.pagePath)
      expect(capability.permission, capability.id).toBe(entry?.permission)
      expect(capability.write, capability.id).toBe([
        'perf-manage-formula-definition-save-and-publish',
        'perf-manage-indicator-save-data',
        'perf-manage-indicator-import',
        'perf-manage-indicator-update-status',
        'perf-manage-indicator-delete',
        'perf-manage-insurance-create',
        'perf-manage-insurance-update',
        'perf-manage-insurance-import',
        'perf-manage-insurance-delete',
        'perf-manage-standard-import',
        'perf-manage-standard-delete',
        'perf-manage-standard-save-data',
        'perf-manage-protocol-config-update',
        'perf-manage-protocol-deduct-rule-update',
      ].includes(capability.id))
    }
  })

  it('能力 id 互不重复', () => {
    const ids = perfManageConfigCapabilities.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(PERF_MANAGE_CONFIG_METHODS['perf-manage-indicator-save-data']).toBe('submitIndicatorDataSave')
    expect(PERF_MANAGE_CONFIG_METHODS['perf-manage-standard-save-data']).toBe('submitStandardDataSave')
  })
})
