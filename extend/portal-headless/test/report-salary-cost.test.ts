import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportSalaryCostCapability,
  REPORT_SALARY_COST_METHODS,
  REPORT_SALARY_COST_PAGE_PATH,
  reportSalaryCostCapabilities,
} from '../src/capabilities/report-salary-cost.js'
import {
  REPORT_SALARY_COST_AI_CONTRACTS as contracts,
  REPORT_SALARY_COST_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-salary-cost.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportSalaryCostCapability(request), calls }
}

const row = {
  orgName: '财务部',
  deptPath: '总部-财务部',
  monthPay: '2026-09',
  level: 2,
  staffNum: 3,
  baseSalary: '100.00',
  bonusSalary: '20.00',
  netSalary: '90.00',
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.ms-excel',
    'content-disposition': 'attachment;filename=%E8%96%AA%E8%B5%84%E6%88%90%E6%9C%AC%E6%B1%87%E6%80%BB%E8%A1%A8.xlsx',
  },
}

describe('Portal 人力报表 → 薪资成本汇总', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/salary-cost/list.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_SALARY_COST_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/salary-cost'")
    expect(page).toContain("getDataListURL: '/admin-api/salary/report/salaryCostSummaryPage'")
    expect(page).toContain("url: '/admin-api/salary/report/exportSalaryCostSummary'")
    expect(page).toContain("monthPay: data.monthPay ? data.monthPay.format('YYYY-MM') : ''")
    expect(page).toContain("ledgerIds: data.ledgerIds && data.ledgerIds.length ? data.ledgerIds.join(',') : ''")
    expect(reportSalaryCostCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_SALARY_COST_METHODS))
    expect(reportSalaryCostCapabilities.every(item => item.pagePath === REPORT_SALARY_COST_PAGE_PATH && item.permission === '/dashboard/report/salary-cost' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_SALARY_COST_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页核对Java Controller/DTO/Service/Mapper/Excel字段和权限规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const reportRoot = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report')
    const controller = readFileSync(join(reportRoot, 'controller/ReportSalaryController.java'), 'utf8')
    const selectDto = readFileSync(join(reportRoot, 'dto/SalaryCostSummarySelectDTO.java'), 'utf8')
    const rowDto = readFileSync(join(reportRoot, 'dto/SalaryCostSummaryDTO.java'), 'utf8')
    const excel = readFileSync(join(reportRoot, 'excel/SalaryCostSummaryExcel.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryDocumentDao.xml'), 'utf8')
    expect(controller).toContain('@GetMapping("salaryCostSummaryPage")')
    expect(controller).toContain('@GetMapping("exportSalaryCostSummary")')
    for (const field of ['orgId', 'monthPay', 'level', 'ledgerIds', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['orgName', 'deptPath', 'monthPay', 'level', 'staffNum', 'baseSalary', 'bonusSalary', 'netSalary']) {
      expect(rowDto).toContain(field)
      expect(excel).toContain(field)
      expect(mapper).toContain(field)
    }
    for (const fragment of ['getWebLedgerList', 'getDescendantByAncestor', '@DataScope', 'dto.setPageSize(DEFAULT_BATCH_SIZE)', 'getSalaryCostSummaryPage(dto)', 'getSalaryCostSummaryTotal']) expect(service).toContain(fragment)
    for (const fragment of ['dto.level', 'dto.ledgerIds', 'dto.monthPay', 'ORDER BY t3.`level`']) expect(mapper).toContain(fragment)
  })

  it('按Portal顺序投影年月、层级和账套，导出不发送分页字段', async () => {
    const f = fixture([{ list: [row], total: 1 }, fileResponse])
    await expect(f.api.list({ orgId: 9, monthPay: '2026-09', level: 2, ledgerIds: [11, 12], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/salary/report/salaryCostSummaryPage', method: 'get', params: { order: '', orderField: '', orgId: 9, monthPay: '2026-09', level: 2, ledgerIds: '11,12', pageNo: 2, pageSize: 50 } })
    await expect(f.api.export({ orgId: 9, monthPay: '2026-09', level: 2, ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '薪资成本汇总表.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/salary/report/exportSalaryCostSummary', method: 'get', params: { orgId: 9, monthPay: '2026-09', level: 2, ledgerIds: '11,12' }, responseType: 'arraybuffer' })
  })

  it('默认当前月、清空筛选和坏参数保持页面边界', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    const params = f.calls[0]!.params as Record<string, unknown>
    expect(params.monthPay).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    expect(params.orgId).toBe('')
    expect(params.level).toBe('')
    expect(params.ledgerIds).toBe('')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ monthPay: null, level: null, ledgerIds: null })).resolves.toEqual({ list: [], total: 0 })
    await expect(f.api.list({ monthPay: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ orgId: 0 })).rejects.toThrow('orgId')
    await expect(f.api.list({ level: 0 })).rejects.toThrow('level')
    await expect(f.api.list({ ledgerIds: [0] })).rejects.toThrow('ledgerIds')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约锁定字段、组织/账套权限边界和导出汇总语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_SALARY_COST_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_SALARY_COST_METHODS).map(method => `reportSalaryCost.${method}`))
    expect(contracts['report-salary-cost-list']?.output.fields.some(item => item.path === 'list[].netSalary')).toBe(true)
    expect(contracts['report-salary-cost-list']?.boundaries.join('\n')).toContain('@DataScope')
    expect(contracts['report-salary-cost-export']?.inputs.pageNo).toBeUndefined()
    expect(contracts['report-salary-cost-export']?.consume.join('\n')).toContain('汇总行')
    expect(contracts['report-salary-cost-list']?.gaps?.join('\n')).toContain('账套')
  })
})
