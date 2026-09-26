import { describe, expect, it } from 'vitest'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'

import type { PortalRequest } from '../src/session/types.js'
import {
  createPerfManageTemplateCapability,
  PROFIT_PAGE_PATH,
  SALARY_STRUCTURE_PAGE_PATH,
  STUDY_TASK_CONFIG_PAGE_PATH,
  TASK_TYPE_CONFIG_PAGE_PATH,
  TEMPLATE_CONTENT_PAGE_PATH,
  TEMPLATE_STRUCTURE_PAGE_PATH,
  TEMPLATE_TYPE_MONTH,
  TEMPLATE_TYPE_YEAR,
} from '../src/capabilities/perf-manage-template.js'
import type { TemplateContentDetail, TemplateNodeForm, TemplateStructureDetail } from '../src/capabilities/perf-manage-template.js'
import { createPortalHeadless } from '../src/index.js'

type CapturedCall = InternalAxiosRequestConfig

type FixtureOptions = {
  data?: unknown
  dataFactory?: (config: CapturedCall) => unknown
  failed?: boolean
}

function makeFixture ({ data = true, dataFactory, failed = false }: FixtureOptions = {}) {
  const calls: CapturedCall[] = []
  const sdk = createPortalHeadless({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'tk-test', tenantId: 1 },
  })
  ;(sdk.http as AxiosInstance).defaults.adapter = async (config) => {
    calls.push(config as CapturedCall)
    const responseData = dataFactory ? dataFactory(config as CapturedCall) : data
    return {
      data: {
        ret: failed ? 'FAIL' : 'SUCCESS',
        code: failed ? 500 : 0,
        msg: failed ? 'denied' : '',
        data: responseData,
      },
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
  return { cap, calls }
}

function queryPairs (rawUrl: string): Array<[string, string]> {
  const query = rawUrl.split('?')[1] ?? ''
  if (!query) return []
  return query.split('&').map((part) => {
    const index = part.indexOf('=')
    const key = index === -1 ? part : part.slice(0, index)
    const value = index === -1 ? '' : part.slice(index + 1)
    return [key, value] as [string, string]
  }).filter(([key]) => key !== '_t')
}

function expectRequest (
  call: CapturedCall | undefined,
  path: string,
  method: string,
  query: Array<[string, string]> = [],
): void {
  expect(String(call?.url).split('?')[0]).toBe(`/admin-api${path}`)
  expect(call?.method?.toUpperCase()).toBe(method)
  expect(queryPairs(String(call?.url))).toEqual(query)
}

function jsonBody (call: CapturedCall | undefined): Record<string, unknown> | unknown[] {
  return JSON.parse(String(call?.data)) as Record<string, unknown> | unknown[]
}

function expectNoRequest (calls: CapturedCall[], action: () => unknown): void {
  const before = calls.length
  action()
  expect(calls).toHaveLength(before)
}

const profitCreateForm = {
  name: 'Profit A',
  type: 2 as const,
  unit: '元',
  parent: 0,
  lineType: 3,
  roleIdList: [7],
  organizationCodeList: ['8'],
}

const salaryCreateForm = {
  name: 'Salary A',
  dataType: 2 as const,
  parent: 0,
  roleIdList: [7],
  organizationCodeList: ['8'],
}

const templateNodeForm: TemplateNodeForm = {
  name: 'Template A',
  type: 1 as const,
  templateType: TEMPLATE_TYPE_YEAR,
  parent: 0,
  roleIdList: [7],
  organizationCodeList: ['8'],
}

const templateContentDetail: TemplateContentDetail = {
  id: 501,
  templateType: TEMPLATE_TYPE_YEAR,
  temStructureId: 601,
  salaryId: 701,
  orgTreeIdList: [801],
  subsectionList: [],
}

const templateStructureDetail: TemplateStructureDetail = {
  id: 601,
  title: 'Structure A',
  templateType: TEMPLATE_TYPE_YEAR,
  subsectionList: [{ blocks: [{ type: 6 }, { type: '7' }] }],
}

const salaryConfig = {
  id: 77,
  name: 'Salary A',
  baseWageBaseNum: 30,
  baseWageRangeLow: 0,
  baseWageRangeHigh: 100,
  assessmentWageBaseNum: 30,
  assessmentWageRangeLow: 0,
  assessmentWageRangeHigh: 100,
  profitWageBaseNum: 40,
  profitWageRangeLow: 0,
  profitWageRangeHigh: 100,
  isEqual: false,
}

describe('绩效模板六页新增读能力：实际 URL、方法与参数形状', () => {
  it('六页首页读能力分别命中列表/配置接口', async () => {
    const { cap, calls } = makeFixture({
      dataFactory: (config) => {
        const url = String(config.url)
        if (url.includes('/kpisalarystructure/treePage')) return { list: [], total: 0 }
        if (url.includes('/task-type-config/list')) return { data: [] }
        return []
      },
    })

    await cap.listProfits()
    expectRequest(calls[0], '/performance/basedata/kpiprofit/page', 'GET', [['order', ''], ['orderField', '']])
    await cap.listSalaryStructures()
    expectRequest(calls[1], '/performance/basedata/kpisalarystructure/treePage', 'GET', [
      ['parentId', '0'],
      ['keyword', ''],
      ['selection', 'false'],
      ['pageNo', '1'],
      ['pageSize', '20'],
    ])
    await cap.listTemplateContents()
    expectRequest(calls[2], '/performance/temcontent/kpitemprotocol/page', 'GET', [['order', ''], ['orderField', ''], ['templateType', '0']])
    await cap.listTemplateStructures()
    expectRequest(calls[3], '/performance/temstructure/kpitemstructure/page', 'GET', [['order', ''], ['orderField', ''], ['templateType', '0']])
    await cap.getStudyTaskConfig()
    expectRequest(calls[4], '/performance/protocol/kpimonthprotocol/study-task-config', 'GET')
    await cap.listTaskTypeConfigs()
    expectRequest(calls[5], '/performance/task-type-config/list', 'GET')
  })

  it('利润详情、公式辅助数据与使用情况分别命中对应 GET/POST 接口', async () => {
    const { cap, calls } = makeFixture()

    await cap.getProfit(11)
    expectRequest(calls[0], '/performance/basedata/kpiprofit/11', 'GET')
    await cap.getProfitLineList(2)
    expectRequest(calls[1], '/performance/basedata/kpiprofit/getLineList', 'GET', [['lineType', '2']])
    await cap.getProfitVariables(3)
    expectRequest(calls[2], '/performance/basedata/kpiprofit/getVariableList', 'GET', [['lineType', '3']])
    await cap.getProfitYears(11)
    expectRequest(calls[3], '/performance/basedata/kpiprofit/getProfitYear', 'GET', [['profitId', '11']])
    await cap.getProfitData(11)
    expectRequest(calls[4], '/performance/basedata/kpiprofit/getProfitData', 'GET', [['profitId', '11']])
    await cap.getProfitDataByYearAndDataType({ profitId: 11, year: 2025, dataType: 2 })
    expectRequest(calls[5], '/performance/basedata/kpiprofit/getProfitDataByYearAndDataType', 'GET', [
      ['dataType', '2'],
      ['year', '2025'],
      ['profitId', '11'],
    ])

    await cap.listProfitTemplateUsage({ id: 11, templateType: TEMPLATE_TYPE_YEAR, name: 'Profit A', pageNo: 2, pageSize: 30, limit: 50 })
    expectRequest(calls[6], '/performance/basedata/kpiprofit/usedInfo', 'POST')
    expect(jsonBody(calls[6])).toEqual({ id: 11, limit: 50, pageNo: 2, pageSize: 30, subassemblyType: 1, name: 'Profit A', templateType: 0 })

    await cap.listProfitPeopleUsage({ id: 11, templateType: TEMPLATE_TYPE_YEAR, year: 2025, realName: 'Li', pageNo: 1, pageSize: 20, limit: 50 })
    expectRequest(calls[7], '/performance/basedata/kpiprofit/PeopleYearUsedInfo', 'POST')
    expect(jsonBody(calls[7])).toEqual({ id: 11, limit: 50, pageNo: 1, pageSize: 20, subassemblyType: 1, realName: 'Li', templateType: 0, year: '2025' })

    await cap.listProfitPeopleUsage({ id: 11, templateType: TEMPLATE_TYPE_MONTH, year: 2025, month: 3, pageNo: 1, pageSize: 20 })
    expectRequest(calls[8], '/performance/basedata/kpiprofit/PeopleMonthUsedInfo', 'POST')
    expect(jsonBody(calls[8])).toEqual({ id: 11, pageNo: 1, pageSize: 20, subassemblyType: 1, realName: '', templateType: 1, year: '2025', month: '3' })
  })

  it('薪资结构详情、使用情况、薪资标准与列表查询锁定 query 键形状', async () => {
    const { cap, calls } = makeFixture({ data: { list: [], total: 0 } })

    await cap.getSalaryStructure({ id: 11, specialProportion: 7.5 })
    expectRequest(calls[0], '/performance/basedata/kpisalarystructure/11', 'GET', [['specialProportion', '7.5']])
    await cap.listSalaryStructureUsage({ id: 11, templateType: TEMPLATE_TYPE_MONTH, name: 'Salary A', pageNo: 2, pageSize: 30, limit: 50 })
    expectRequest(calls[1], '/performance/basedata/kpisalarystructure/usedInfo', 'POST')
    expect(jsonBody(calls[1])).toEqual({ id: 11, limit: 50, pageNo: 2, pageSize: 30, subassemblyType: 2, name: 'Salary A', templateType: 1 })
    await cap.listSalaryStandards({ pageNo: 2, pageSize: 30, keyword: 'Senior' })
    expectRequest(calls[2], '/performance/basedata/hrsalarystandard/selectPage', 'GET', [
      ['pageNo', '2'],
      ['pageSize', '30'],
      ['keyword', 'Senior'],
    ])
    await cap.getSalaryStandard(12)
    expectRequest(calls[3], '/performance/basedata/hrsalarystandard/12', 'GET')
    await cap.listSalaryStructures({ parentId: 9, keyword: 'Salary', pageNo: 2, pageSize: 30 })
    expectRequest(calls[4], '/performance/basedata/kpisalarystructure/searchPage', 'GET', [
      ['parentId', '9'],
      ['keyword', 'Salary'],
      ['dataType', '2'],
      ['selection', 'false'],
      ['pageNo', '2'],
      ['pageSize', '30'],
    ])
  })

  it('模板内容读取、候选、月信息与年度/月度使用情况锁定接口和 body', async () => {
    const { cap, calls } = makeFixture()

    await cap.getTemplateContent(11)
    expectRequest(calls[0], '/performance/temcontent/kpitemprotocol/11', 'GET')
    await cap.getTemplateContentDetail(11)
    expectRequest(calls[1], '/performance/temcontent/kpitemprotocol/getProtocolInfo', 'GET', [['id', '11']])
    await cap.listTemplateContentProtocolOptions({ salaryId: 22 })
    expectRequest(calls[2], '/performance/temcontent/kpitemprotocol/getProtocolList', 'GET', [['templateType', '0'], ['salaryId', '22']])
    await cap.getTemplateContentMonthInfo(11)
    expectRequest(calls[3], '/performance/temcontent/kpitemprotocol/getMonthInfoByYearProtocol', 'GET', [['id', '11']])
    await cap.listTemplateContentUsage({ id: 11, templateType: TEMPLATE_TYPE_YEAR, year: 2025, realName: 'Li', pageNo: 2, pageSize: 30, limit: 50 })
    expectRequest(calls[4], '/performance/temcontent/kpitemprotocol/YearUsedInfo', 'POST')
    expect(jsonBody(calls[4])).toEqual({ id: 11, limit: 50, pageNo: 2, pageSize: 30, templateType: 0, realName: 'Li', year: '2025' })
    await cap.listTemplateContentUsage({ id: 11, templateType: TEMPLATE_TYPE_MONTH, year: 2025, month: 3, pageNo: 1, pageSize: 20 })
    expectRequest(calls[5], '/performance/temcontent/kpitemprotocol/MonthUsedInfo', 'POST')
    expect(jsonBody(calls[5])).toEqual({ id: 11, pageNo: 1, pageSize: 20, templateType: 1, realName: '', year: '2025', month: '3' })
  })

  it('模板结构读取、候选与使用情况锁定接口和 body', async () => {
    const { cap, calls } = makeFixture()

    await cap.getTemplateStructure(11)
    expectRequest(calls[0], '/performance/temstructure/kpitemstructure/11', 'GET')
    await cap.getTemplateStructureDetail(11)
    expectRequest(calls[1], '/performance/temstructure/kpitemstructure/getStructureInfo', 'GET', [['id', '11']])
    await cap.listTemplateStructureOptions({ templateType: TEMPLATE_TYPE_MONTH })
    expectRequest(calls[2], '/performance/temstructure/kpitemstructure/page', 'GET', [['templateType', '1']])
    await cap.listTemplateStructureUsage({ id: 11, templateType: TEMPLATE_TYPE_YEAR, name: 'Structure A', pageNo: 2, pageSize: 30, limit: 50 })
    expectRequest(calls[3], '/performance/temstructure/kpitemstructure/usedInfo', 'POST')
    expect(jsonBody(calls[3])).toEqual({ id: 11, limit: 50, pageNo: 2, pageSize: 30, subassemblyType: 3, name: 'Structure A', templateType: 0 })
  })
})

describe('利润新增/编辑/删除/导入/利润数据保存/公式同步', () => {
  it('每个利润写入口都经过 prepare→submit，prepare/cancel 不发请求且 body 形状固定', async () => {
    const { cap, calls } = makeFixture({
      dataFactory: (config) => String(config.url).includes('/import') ? [] : String(config.url).endsWith('/kpiprofit') ? 101 : true,
    })

    const create = cap.prepareProfitCreate(profitCreateForm)
    expect(calls).toHaveLength(0)
    expectNoRequest(calls, () => cap.cancelProfitSave())
    await cap.submitProfitCreate({ draft: create.draft })
    expectRequest(calls[0], '/performance/basedata/kpiprofit', 'POST')
    expect(jsonBody(calls[0])).toEqual({
      name: 'Profit A', type: 2, unit: '元', parent: '0', lineType: 3, roleIdList: [7], organizationCodeList: ['8'],
    })

    const update = cap.prepareProfitUpdate({ id: 101, ...profitCreateForm })
    expectNoRequest(calls, () => cap.cancelProfitSave())
    await cap.submitProfitUpdate({ draft: update.draft })
    expectRequest(calls[1], '/performance/basedata/kpiprofit', 'PUT')
    expect(jsonBody(calls[1])).toEqual({
      id: 101, name: 'Profit A', type: 2, unit: '元', parent: '0', lineType: 3, roleIdList: [7], organizationCodeList: ['8'],
    })

    const deletion = cap.prepareProfitDelete({ record: { id: 101, children: [{ id: 102 }] } })
    expectNoRequest(calls, () => cap.cancelProfitSave())
    await cap.submitProfitDelete(deletion)
    expectRequest(calls[2], '/performance/basedata/kpiprofit', 'DELETE')
    expect(jsonBody(calls[2])).toEqual({ ids: [101, 102] })

    const imported = cap.prepareProfitImport({
      file: { fileName: 'profit.xlsx', base64: 'UEs=', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      type: 2,
      parentId: 101,
    })
    expectNoRequest(calls, () => cap.cancelProfitImport())
    await cap.submitProfitImport({ draft: imported.draft })
    expectRequest(calls[3], '/performance/basedata/kpiprofit/import', 'POST')
    const form = calls[3]?.data as FormData
    expect([...form.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : value.name])).toEqual([
      ['file', 'profit.xlsx'],
      ['type', '2'],
      ['parentId', '101'],
    ])

    const dataSave = cap.prepareProfitDataSave({
      profitId: 101,
      forecastProfit: { year: 2025, targetDataList: [{ formula: 'x' }] },
      actualProfit: { year: 2024, targetDataList: [] },
    })
    expectNoRequest(calls, () => cap.cancelProfitDataSave())
    await cap.submitProfitDataSave(dataSave)
    expectRequest(calls[4], '/performance/basedata/kpiprofit/saveData', 'POST')
    expect(jsonBody(calls[4])).toEqual({
      profitId: 101,
      forecastProfit: { year: 2025, targetDataList: [{ formula: 'x' }] },
      actualProfit: { year: 2024, targetDataList: [] },
    })

    const formula = cap.prepareProfitFormulaSync({ name: 'Profit A', year: 2025, month: 3 })
    expectNoRequest(calls, () => cap.cancelProfitSave())
    await cap.submitProfitFormulaSync(formula)
    expectRequest(calls[5], '/performance/basedata/kpiprofit/formulaUpdates', 'GET', [
      ['name', 'Profit%20A'],
      ['year', '2025'],
      ['month', '3'],
    ])
  })
})

describe('薪资结构新增/编辑/状态/删除/配置保存/薪资标准', () => {
  it('薪资结构写入口锁定 POST/PUT/DELETE、状态 body 与配置 body', async () => {
    const { cap, calls } = makeFixture({
      dataFactory: (config) => String(config.url).endsWith('/kpisalarystructure') && config.method === 'post' ? 77 : true,
    })

    const create = cap.prepareSalaryStructureCreate(salaryCreateForm)
    expect(calls).toHaveLength(0)
    expectNoRequest(calls, () => cap.cancelSalaryStructureSave())
    await cap.submitSalaryStructureCreate({ draft: create.draft })
    expectRequest(calls[0], '/performance/basedata/kpisalarystructure', 'POST')
    expect(jsonBody(calls[0])).toEqual({ name: 'Salary A', dataType: 2, parent: '0', roleIdList: [7], organizationCodeList: ['8'] })

    const update = cap.prepareSalaryStructureUpdate({ id: 77, ...salaryCreateForm })
    expectNoRequest(calls, () => cap.cancelSalaryStructureSave())
    await cap.submitSalaryStructureUpdate({ draft: update.draft })
    expectRequest(calls[1], '/performance/basedata/kpisalarystructure', 'PUT')
    expect(jsonBody(calls[1])).toEqual({ id: 77, name: 'Salary A', dataType: 2, parent: '0', roleIdList: [7], organizationCodeList: ['8'] })

    const status = cap.prepareSalaryStructureStatus({ id: 77, dataType: 2, currentStatus: 1 })
    expectNoRequest(calls, () => cap.cancelSalaryStructureSave())
    await cap.submitSalaryStructureStatus(status)
    expectRequest(calls[2], '/performance/basedata/kpisalarystructure/updateStatus', 'PUT')
    expect(jsonBody(calls[2])).toEqual({ id: 77, status: 0 })

    const deletion = cap.prepareSalaryStructureDelete({ record: { id: 77, dataType: 2, status: 0 } })
    expectNoRequest(calls, () => cap.cancelSalaryStructureSave())
    await cap.submitSalaryStructureDelete(deletion)
    expectRequest(calls[3], '/performance/basedata/kpisalarystructure', 'DELETE')
    expect(jsonBody(calls[3])).toEqual({ ids: [77] })

    const config = cap.prepareSalaryStructureConfigUpdate(salaryConfig)
    expectNoRequest(calls, () => cap.cancelSalaryStructureSave())
    await cap.submitSalaryStructureConfigUpdate(config)
    expectRequest(calls[4], '/performance/basedata/kpisalarystructure', 'PUT')
    expect(jsonBody(calls[4])).toEqual({ ...salaryConfig, salaryStandardId: null })
  })
})

describe('模板内容基础 CRUD 与详情读写', () => {
  it('基础 CRUD 和深层详情读写锁定路径、方法、裸数组与 body', async () => {
    const { cap, calls } = makeFixture({
      dataFactory: (config) => String(config.url).endsWith('/kpitemprotocol') && config.method === 'post' ? 901 : true,
    })

    await cap.listTemplateContents({ templateType: TEMPLATE_TYPE_MONTH })
    expectRequest(calls[0], '/performance/temcontent/kpitemprotocol/page', 'GET', [
      ['order', ''],
      ['orderField', ''],
      ['templateType', '1'],
    ])
    await cap.getTemplateContent(901)
    expectRequest(calls[1], '/performance/temcontent/kpitemprotocol/901', 'GET')

    const create = cap.prepareTemplateContentCreate(templateNodeForm)
    expectNoRequest(calls, () => cap.cancelTemplateContentSave())
    await cap.submitTemplateContentCreate({ draft: create.draft })
    expectRequest(calls[2], '/performance/temcontent/kpitemprotocol', 'POST')
    expect(jsonBody(calls[2])).toEqual({
      name: 'Template A', type: 1, templateType: 0, parent: '0', roleIdList: [7], organizationCodeList: ['8'],
    })

    const update = cap.prepareTemplateContentUpdate({ id: 901, ...templateNodeForm })
    expectNoRequest(calls, () => cap.cancelTemplateContentSave())
    await cap.submitTemplateContentUpdate({ draft: update.draft })
    expectRequest(calls[3], '/performance/temcontent/kpitemprotocol', 'PUT')
    expect(jsonBody(calls[3])).toEqual({
      id: 901, name: 'Template A', type: 1, templateType: 0, parent: '0', roleIdList: [7], organizationCodeList: ['8'],
    })

    const deletion = cap.prepareTemplateContentDelete({ record: { id: 901, children: [{ id: 902 }] } })
    expectNoRequest(calls, () => cap.cancelTemplateContentSave())
    await cap.submitTemplateContentDelete(deletion)
    expectRequest(calls[4], '/performance/temcontent/kpitemprotocol', 'DELETE')
    expect(jsonBody(calls[4])).toEqual([901, 902])

    await cap.getTemplateContentDetail(901)
    expectRequest(calls[5], '/performance/temcontent/kpitemprotocol/getProtocolInfo', 'GET', [['id', '901']])
    const detail = cap.prepareTemplateContentDetailSave(templateContentDetail)
    expectNoRequest(calls, () => cap.cancelTemplateContentSave())
    await cap.submitTemplateContentDetailSave(detail)
    expectRequest(calls[6], '/performance/temcontent/kpitemprotocol/saveProtocolInfo', 'POST')
    expect(jsonBody(calls[6])).toEqual(templateContentDetail)
  })
})

describe('模板结构基础 CRUD 与详情读写', () => {
  it('基础 CRUD 和深层详情读写锁定路径、方法、裸数组与归一化 body', async () => {
    const { cap, calls } = makeFixture({
      dataFactory: (config) => String(config.url).endsWith('/kpitemstructure') && config.method === 'post' ? 601 : true,
    })

    await cap.listTemplateStructures({ templateType: TEMPLATE_TYPE_YEAR })
    expectRequest(calls[0], '/performance/temstructure/kpitemstructure/page', 'GET', [
      ['order', ''],
      ['orderField', ''],
      ['templateType', '0'],
    ])
    await cap.getTemplateStructure(601)
    expectRequest(calls[1], '/performance/temstructure/kpitemstructure/601', 'GET')

    const create = cap.prepareTemplateStructureCreate(templateNodeForm)
    expectNoRequest(calls, () => cap.cancelTemplateStructureSave())
    await cap.submitTemplateStructureCreate({ draft: create.draft })
    expectRequest(calls[2], '/performance/temstructure/kpitemstructure', 'POST')
    expect(jsonBody(calls[2])).toEqual({
      name: 'Template A', type: 1, templateType: 0, parent: '0', roleIdList: [7], organizationCodeList: ['8'],
    })

    const update = cap.prepareTemplateStructureUpdate({ id: 601, ...templateNodeForm })
    expectNoRequest(calls, () => cap.cancelTemplateStructureSave())
    await cap.submitTemplateStructureUpdate({ draft: update.draft })
    expectRequest(calls[3], '/performance/temstructure/kpitemstructure', 'PUT')
    expect(jsonBody(calls[3])).toEqual({
      id: 601, name: 'Template A', type: 1, templateType: 0, parent: '0', roleIdList: [7], organizationCodeList: ['8'],
    })

    const deletion = cap.prepareTemplateStructureDelete({ record: { id: 601, children: [{ id: 602 }] } })
    expectNoRequest(calls, () => cap.cancelTemplateStructureSave())
    await cap.submitTemplateStructureDelete(deletion)
    expectRequest(calls[4], '/performance/temstructure/kpitemstructure', 'DELETE')
    expect(jsonBody(calls[4])).toEqual([601, 602])

    await cap.getTemplateStructureDetail(601)
    expectRequest(calls[5], '/performance/temstructure/kpitemstructure/getStructureInfo', 'GET', [['id', '601']])
    const detail = cap.prepareTemplateStructureDetailSave(templateStructureDetail)
    expectNoRequest(calls, () => cap.cancelTemplateStructureSave())
    await cap.submitTemplateStructureDetailSave(detail)
    expectRequest(calls[6], '/performance/temstructure/kpitemstructure/saveStructure', 'POST')
    expect(jsonBody(calls[6])).toEqual({
      ...templateStructureDetail,
      subsectionList: [{ blocks: [{ type: 6 }, { type: '7' }], title: '', subassemblyTypes: '6,7' }],
    })
  })
})

describe('学习任务与任务类型的 prepare→submit→cancel', () => {
  it('学习任务配置 prepare/cancel 不请求，submit 只发五个字段', async () => {
    const { cap, calls } = makeFixture()
    const form = {
      weeklyProgressPercent: 25,
      morningProgressPercent: 5,
      weeklyFlowerBaseline: 6,
      weeklyBonusScoreLimit: 2,
      status: 1,
    }
    const prepared = cap.prepareStudyTaskConfigSave(form)
    expect(calls).toHaveLength(0)
    expectNoRequest(calls, () => cap.cancelStudyTaskConfigSave())
    await cap.submitStudyTaskConfigSave(prepared)
    expectRequest(calls[0], '/performance/protocol/kpimonthprotocol/study-task-config', 'POST')
    expect(jsonBody(calls[0])).toEqual(form)
  })

  it('任务类型配置 prepare/cancel 不请求，submit 使用 PUT 和页面五个 body 键', async () => {
    const { cap, calls } = makeFixture({ data: true })
    const prepared = cap.prepareTaskTypeConfigUpdate({
      id: 91,
      taskType: 6,
      selfEditable: true,
      leaderEditable: true,
      progressScoring: false,
      formulaEnabled: false,
    })
    expect(calls).toHaveLength(0)
    expectNoRequest(calls, () => cap.cancelTaskTypeConfigUpdate())
    await cap.submitTaskTypeConfigUpdate(prepared)
    expectRequest(calls[0], '/performance/task-type-config/update', 'PUT')
    expect(jsonBody(calls[0])).toEqual({
      id: 91,
      taskType: 6,
      selfEditable: true,
      leaderEditable: true,
      progressScoring: false,
    })
  })
})

describe('错误响应与零请求边界', () => {
  it('HTTP 200 但 ret=FAIL 的响应严格失败，不被当成成功', async () => {
    const { cap, calls } = makeFixture({ failed: true })
    const prepared = cap.prepareProfitUpdate({ id: 11, ...profitCreateForm })
    await expect(cap.submitProfitUpdate({ draft: prepared.draft })).rejects.toThrow()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.method?.toUpperCase()).toBe('PUT')
  })
})
