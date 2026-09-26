import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportRetirementSalarySummaryCapability,
  REPORT_RETIREMENT_SALARY_SUMMARY_METHODS,
  REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH,
  reportRetirementSalarySummaryCapabilities,
} from '../src/capabilities/report-retirement-salary-summary.js'
import {
  REPORT_RETIREMENT_SALARY_SUMMARY_AI_CONTRACTS as contracts,
  REPORT_RETIREMENT_SALARY_SUMMARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-retirement-salary-summary.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportRetirementSalarySummaryCapability(request), calls }
}

const summary = {
  id: 101,
  organizationId: 9,
  organizationName: '总部/财务',
  staffCount: 2,
  useYearMonth: '2026-09',
  enterpriseSalary: '100.00',
  actualAmount: '180.00',
  status: 0,
}

const detail = {
  id: 201,
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationName: '总部/财务',
  actualAmount: '90.00',
  status: 0,
}

describe('Portal 人力报表 → 退休人员工资发放汇总表', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary-summary/list.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/retirement-salary-summary'")
    expect(page).toContain("getDataListURL: '/admin-api/hr/retire-staff-salary-summary/page'")
    expect(page).toContain("path: 'simple/hr/form/015'")
    const detailPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary-summary/ModalContentForDetail.vue'), 'utf8')
    expect(detailPage).toContain("getDataListURL: '/admin-api/hr/retire-staff-salary-summary/retireStaffByPage'")
    expect(reportRetirementSalarySummaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_RETIREMENT_SALARY_SUMMARY_METHODS))
    expect(reportRetirementSalarySummaryCapabilities.every(item => item.pagePath === REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH && item.permission === '/dashboard/report/retirement-salary-summary' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_RETIREMENT_SALARY_SUMMARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页核对Portal、Java Controller/VO/Service/Mapper证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary-summary/list.vue'), 'utf8')
    const detailPage = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary-summary/ModalContentForDetail.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalarysummary/RetireStaffSalarySummaryController.java'), 'utf8')
    const pageVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalarysummary/vo/RetireStaffSalarySummaryPageReqVO.java'), 'utf8')
    const responseVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalarysummary/vo/RetireStaffSalarySummaryRespVO.java'), 'utf8')
    const selectVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalarysummary/vo/RetireStaffSelectVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/retirestaffsalarysummary/RetireStaffSalarySummaryServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/retirestaffsalarysummary/RetireStaffSalarySummaryMapper.xml'), 'utf8')
    for (const fragment of ["organizationId: null", "useYearMonth: null", "status: null", "getDataListIsPage: true", "format('YYYY-MM')", 'summary']) expect(page).toContain(fragment)
    expect(detailPage).toContain("retireStaffSalarySummaryId: props.id")
    expect(detailPage).toContain("name: ''")
    for (const fragment of ['@GetMapping("/page")', '@GetMapping("/retireStaffByPage")', 'getRetireStaffSalarySummaryPage', 'retireStaffByPage']) expect(controller).toContain(fragment)
    for (const field of ['organizationId', 'useYearMonth', 'status', 'roleOrganizationIdList']) expect(pageVo).toContain(field)
    for (const field of ['id', 'organizationName', 'staffCount', 'enterpriseSalary', 'actualAmount', 'status']) expect(responseVo).toContain(field)
    for (const field of ['retireStaffSalarySummaryId', 'name']) expect(selectVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'retireStaffByPage', 'setStatus(0)', 'selectPage']) expect(service).toContain(fragment)
    expect(mapper).toContain('selectRetireStaffByPage')
  })

  it('按Portal顺序发送列表筛选、月份/状态转换和分页参数', async () => {
    const f = fixture([{ list: [summary], total: 1 }])
    await expect(f.api.list({ organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [summary], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/hr/retire-staff-salary-summary/page',
      method: 'get',
      params: { order: '', orderField: '', organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'organizationId', 'useYearMonth', 'status', 'pageNo', 'pageSize'])
  })

  it('按详情弹窗把汇总行ID映射成 retireStaffSalarySummaryId', async () => {
    const f = fixture([{ list: [detail], total: 1 }])
    await expect(f.api.detail({ summaryId: 101, name: '张', pageNo: 2, pageSize: 20 })).resolves.toEqual({ list: [detail], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/hr/retire-staff-salary-summary/retireStaffByPage',
      method: 'get',
      params: { order: '', orderField: '', retireStaffSalarySummaryId: 101, name: '张', pageNo: 2, pageSize: 20 },
    })
  })

  it('省略值复现Portal默认空筛选，坏月份/状态/ID/分页和坏响应不会静默成功', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect(f.calls[0]!.params).toEqual({ order: '', orderField: '', organizationId: null, useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
    await expect(f.api.list({ useYearMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ status: 5 as never })).rejects.toThrow('0、1、2、3或4')
    await expect(f.api.list({ organizationId: 0 })).rejects.toThrow('organizationId')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(f.api.detail({ summaryId: 0 })).rejects.toThrow('summaryId')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
  })

  it('AI契约覆盖字段、当前页合计边界、详情映射和证据缺口', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_RETIREMENT_SALARY_SUMMARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportRetirementSalarySummary.list', 'reportRetirementSalarySummary.detail'])
    expect(contracts['report-retirement-salary-summary-list']?.output.fields.some(item => item.path === 'list[].actualAmount')).toBe(true)
    expect(contracts['report-retirement-salary-summary-list']?.consume.join('\n')).toContain('当前页')
    expect(contracts['report-retirement-salary-summary-detail']?.steps[0]?.mapping?.summaryId).toBe('list[].id')
    expect(contracts['report-retirement-salary-summary-list']?.gaps?.join('\n')).toContain('真实测试环境')
  })
})
