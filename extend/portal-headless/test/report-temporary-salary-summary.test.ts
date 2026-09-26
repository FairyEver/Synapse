import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportTemporarySalarySummaryCapability,
  REPORT_TEMPORARY_SALARY_SUMMARY_METHODS,
  REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH,
  reportTemporarySalarySummaryCapabilities,
} from '../src/capabilities/report-temporary-salary-summary.js'
import {
  REPORT_TEMPORARY_SALARY_SUMMARY_AI_CONTRACTS as contracts,
  REPORT_TEMPORARY_SALARY_SUMMARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-temporary-salary-summary.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportTemporarySalarySummaryCapability(request), calls }
}

const summary = {
  id: 101,
  useYearMonth: '2026-09',
  staffCount: 2,
  organizationId: 9,
  organizationName: '总部/财务',
  grossSalaryTotal: '100.00',
  individualIncomeTaxTotal: '10.00',
  netSalaryTotal: '90.00',
  paymentDate: '2026-09-15',
  status: 0,
}

const detail = {
  id: 201,
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationId: 9,
  organizationName: '总部/财务',
  entryDate: '2026-08-01',
  bankAccount: 'masked-account',
  openingBank: '示例银行',
  attendanceDays: 20,
  dailyValue: '100.00',
  attendanceSalary: '2000.00',
  otherSalary: '0.00',
  grossSalary: '2000.00',
  individualIncomeTax: '20.00',
  netSalary: '1980.00',
  status: 1,
}

describe('Portal 人力报表 → 临时工工资发放汇总表', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary-summary/list.vue'), 'utf8')
    const detailPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary-summary/ModalContentForDetail.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/temporary-salary-summary'")
    expect(page).toContain("getDataListURL: '/admin-api/hr/temporary-worker-salary-summary/page'")
    expect(page).toContain('organizationIdList: []')
    expect(page).toContain('useYearMonth: null')
    expect(page).toContain('status: null')
    expect(page).toContain("useYearMonth: useYearMonth ? useYearMonth.format('YYYY-MM')  : null")
    expect(page).toContain("path: 'simple/hr/form/016'")
    expect(page).toContain("{ label: '待提交', value: 0 }")
    expect(page).toContain("{ label: '已付款', value: 4 }")
    expect(detailPage).toContain("getDataListURL: '/admin-api/hr/temporary-worker-salary/temporaryWorkerStaffByPage'")
    expect(detailPage).toContain('temporaryWorkerSalarySummaryId: props.id')
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationName', 'entryDate', 'bankAccount', 'openingBank', 'attendanceDays', 'dailyValue', 'attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary']) expect(detailPage).toContain(`dataIndex: '${field}'`)
    expect(reportTemporarySalarySummaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_TEMPORARY_SALARY_SUMMARY_METHODS))
    expect(reportTemporarySalarySummaryCapabilities.every(item => item.pagePath === REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH && item.permission === '/dashboard/report/temporary-salary-summary' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_TEMPORARY_SALARY_SUMMARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段核对Portal、Java Controller/VO/Service/Mapper权限证据和页面动作边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary-summary/list.vue'), 'utf8')
    const detailPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary-summary/ModalContentForDetail.vue'), 'utf8')
    const summaryRoot = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalarysummary')
    const controller = readFileSync(join(summaryRoot, 'TemporaryWorkerSalarySummaryController.java'), 'utf8')
    const pageVo = readFileSync(join(summaryRoot, 'vo/TemporaryWorkerSalarySummaryPageReqVO.java'), 'utf8')
    const responseVo = readFileSync(join(summaryRoot, 'vo/TemporaryWorkerSalarySummaryRespVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/temporaryworkersalarysummary/TemporaryWorkerSalarySummaryServiceImpl.java'), 'utf8')
    const summaryMapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/mysql/temporaryworkersalarysummary/TemporaryWorkerSalarySummaryMapper.java'), 'utf8')
    const detailController = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/TemporaryWorkerSalaryController.java'), 'utf8')
    const selectVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalarysummary/vo/RetireStaffSelectVO.java'), 'utf8')
    const detailMapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/temporaryworkersalary/TemporaryWorkerSalaryMapper.xml'), 'utf8')
    for (const fragment of ['multiple', 'leaf-only', 'organizationIdList: []', 'useYearMonth: null', 'status: null', 'getDataListIsPage: true', "format('YYYY-MM')", "path: 'simple/hr/form/016'", 'summary(\'staffCount\')']) expect(page).toContain(fragment)
    expect(detailPage).toContain('temporaryWorkerSalarySummaryId: props.id')
    for (const fragment of ['@GetMapping("/page")', 'getTemporaryWorkerSalarySummaryPage', '@GetMapping("/temporaryWorkerStaffByPage")', 'temporaryWorkerStaffByPage']) expect(controller + detailController).toContain(fragment)
    for (const field of ['useYearMonth', 'organizationIdList', 'status', 'roleOrganizationIdList']) expect(pageVo).toContain(field)
    for (const field of ['id', 'useYearMonth', 'staffCount', 'organizationId', 'organizationName', 'grossSalaryTotal', 'individualIncomeTaxTotal', 'netSalaryTotal', 'paymentDate', 'status']) expect(responseVo).toContain(field)
    for (const field of ['temporaryWorkerSalarySummaryId', 'name']) expect(selectVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'setRoleOrganizationIdList', 'selectPage']) expect(service).toContain(fragment)
    for (const fragment of ['inIfPresent(TemporaryWorkerSalarySummaryDO::getOrganizationId, reqVO.getOrganizationIdList())', 'inIfPresent(TemporaryWorkerSalarySummaryDO::getOrganizationId, reqVO.getRoleOrganizationIdList())']) expect(summaryMapper).toContain(fragment)
    for (const fragment of ['temporaryWorkerStaffByPage', 'temporaryWorkerSalarySummaryId', 'pageReqVO.name']) expect(detailMapper).toContain(fragment)
    expect(detailController).toContain('RetireStaffSelectVO pageReqVO')
    expect(Object.keys(REPORT_TEMPORARY_SALARY_SUMMARY_METHODS)).not.toContain('report-temporary-salary-summary-export')
  })

  it('按Portal顺序发送列表筛选、组织多选、月份/状态转换和分页参数', async () => {
    const f = fixture([{ list: [summary], total: 1 }])
    await expect(f.api.list({ organizationIdList: [9, '10'], useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [summary], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/hr/temporary-worker-salary-summary/page',
      method: 'get',
      params: { order: '', orderField: '', organizationIdList: [9, '10'], useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'organizationIdList', 'useYearMonth', 'status', 'pageNo', 'pageSize'])
  })

  it('按详情弹窗把汇总行ID映射成 temporaryWorkerSalarySummaryId', async () => {
    const f = fixture([{ list: [detail], total: 1 }])
    await expect(f.api.detail({ summaryId: 101, name: '张', pageNo: 2, pageSize: 20 })).resolves.toEqual({ list: [detail], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/hr/temporary-worker-salary/temporaryWorkerStaffByPage',
      method: 'get',
      params: { order: '', orderField: '', temporaryWorkerSalarySummaryId: 101, name: '张', pageNo: 2, pageSize: 20 },
    })
  })

  it('省略值复现Portal默认空筛选，空组织数组保持数组形状，坏月份/状态/ID/分页和坏响应不会静默成功', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect(f.calls[0]!.params).toEqual({ order: '', orderField: '', organizationIdList: [], useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
    const explicitEmpty = fixture([{ list: [], total: 0 }])
    await explicitEmpty.api.list({ organizationIdList: null, useYearMonth: null, status: null })
    expect(explicitEmpty.calls[0]!.params).toEqual({ order: '', orderField: '', organizationIdList: [], useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
    await expect(f.api.list({ useYearMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ status: 5 as never })).rejects.toThrow('0、1、2、3或4')
    await expect(f.api.list({ organizationIdList: [0] })).rejects.toThrow('organizationIdList')
    await expect(f.api.list({ organizationIdList: 9 as never })).rejects.toThrow('ID数组')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(f.api.detail({ summaryId: 0 })).rejects.toThrow('summaryId')
    await expect(f.api.detail({ summaryId: 101, name: 1 as never })).rejects.toThrow('name')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
  })

  it('AI契约覆盖字段、状态、组织权限、当前页合计、详情映射和证据缺口', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_TEMPORARY_SALARY_SUMMARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportTemporarySalarySummary.list', 'reportTemporarySalarySummary.detail'])
    for (const path of ['list[].grossSalaryTotal', 'list[].individualIncomeTaxTotal', 'list[].netSalaryTotal', 'list[].paymentDate', 'list[].status']) expect(contracts['report-temporary-salary-summary-list']?.output.fields.some(item => item.path === path)).toBe(true)
    for (const path of ['list[].idCard', 'list[].bankAccount', 'list[].attendanceSalary', 'list[].netSalary']) expect(contracts['report-temporary-salary-summary-detail']?.output.fields.some(item => item.path === path)).toBe(true)
    expect(contracts['report-temporary-salary-summary-list']?.inputs.organizationIdList?.type).toBe('(string | number)[]')
    expect(contracts['report-temporary-salary-summary-list']?.boundaries.join('\n')).toContain('roleOrganizationIdList')
    expect(contracts['report-temporary-salary-summary-list']?.consume.join('\n')).toContain('当前页')
    expect(contracts['report-temporary-salary-summary-detail']?.steps[0]?.mapping?.summaryId).toBe('list[].id')
    expect(contracts['report-temporary-salary-summary-list']?.gaps?.join('\n')).toContain('真实测试环境')
  })
})
