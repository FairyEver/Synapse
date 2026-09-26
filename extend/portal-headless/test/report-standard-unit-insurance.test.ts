import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportStandardUnitInsuranceCapability, REPORT_STANDARD_UNIT_INSURANCE_METHODS, REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH, reportStandardUnitInsuranceCapabilities } from '../src/capabilities/report-standard-unit-insurance.js'
import { REPORT_STANDARD_UNIT_INSURANCE_AI_CONTRACTS as contracts, REPORT_STANDARD_UNIT_INSURANCE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-standard-unit-insurance.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) { const calls: RequestConfig[] = []; const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); const next = responses.shift(); if (next instanceof Error) throw next; return next as T }; return { api: createReportStandardUnitInsuranceCapability(request), calls } }
const row = { standardUnitName: '孵化1厅', standardUnitId: 225, costMonth: '2026-09', fiveInsurancePersonNum: 2, providentFundPersonNum: 2, pensionUnitCost: '10.00', unemploymentUnitCost: '2.00', workInjuryUnitCost: '1.00', maternityUnitCost: '0.50', medicalUnitCost: '3.00', fiveInsuranceUnitCostTotal: '16.50', providentFundUnitCost: '4.00', pensionPersonalCost: '5.00', unemploymentPersonalCost: '1.00', medicalPersonalCost: '2.00', majorMedicalPersonalCost: '0.50', fiveInsurancePersonalCostTotal: '8.50', providentFundPersonalCost: '4.00', extra: 'keep' }

describe('Portal 人力报表 → 五险一金汇总表（标准化单元维度）', () => {
  it('锁定菜单、权限、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH}'`)
    expect(reportStandardUnitInsuranceCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_STANDARD_UNIT_INSURANCE_METHODS))
    expect(reportStandardUnitInsuranceCapabilities.every(item => item.pagePath === REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH && item.permission === '/dashboard/report/insurance-summary' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_STANDARD_UNIT_INSURANCE_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal页面、Java Controller、DTO和聚合SQL', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/insurance-summary/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8')
    const selectDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/ReportSalaryInsuranceCostSelectDTO.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/ReportSalaryInsuranceCostsDTO.java`, 'utf8')
    const service = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentServiceImpl.java`, 'utf8')
    const sql = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryDocumentDao.xml`, 'utf8')
    expect(source).toContain("getDataListURL: '/admin-api/salary/report/standardUnitCostsPage'")
    expect(source).toContain('standardUnitId: null')
    expect(source).toContain('costMonth: dayjs()')
    expect(source).toContain("costMonth: costMonth ? costMonth.format('YYYY-MM')  : null")
    expect(controller).toContain('@GetMapping("standardUnitCostsPage")')
    for (const field of ['costMonth', 'standardUnitId', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['standardUnitName', 'standardUnitId', 'pensionUnitCost', 'maternityUnitCost', 'providentFundPersonalCost', 'companyBase', 'staffCode']) expect(resultDto).toContain(field)
    expect(service).toContain('salaryInsuranceCostsService.selectCount')
    expect(service).toContain('salaryFundCostsService.selectCount')
    for (const field of ['selectStandardUnitCostsPage', 'pension_unit_cost', 'basic_medical_unit_cost', 'company_base', 'individual_ratio']) expect(sql).toContain(field)
  })

  it('按Portal顺序发送筛选和分页参数，保留服务端额外字段', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ standardUnitId: 225, costMonth: '2026-09', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/report/standardUnitCostsPage', method: 'get', params: { order: '', orderField: '', standardUnitId: 225, costMonth: '2026-09', pageNo: 2, pageSize: 50 } })
  })

  it('默认当前月和空筛选值与Portal一致，坏参数和坏响应会失败', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect(f.calls[0]?.params).toMatchObject({ standardUnitId: null, costMonth: expect.stringMatching(/^\d{4}-(0[1-9]|1[0-2])$/) })
    await expect(f.api.list({ standardUnitId: 0 })).rejects.toThrow('standardUnitId')
    await expect(f.api.list({ costMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ list: {}, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
  })

  it('AI契约覆盖页面字段和只读边界', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_STANDARD_UNIT_INSURANCE_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportStandardUnitInsurance.list'])
    expect(contracts['report-standard-unit-insurance-list']?.output.fields.some(item => item.path === 'list[].fiveInsuranceUnitCostTotal')).toBe(true)
    expect(contracts['report-standard-unit-insurance-list']?.output.fields.some(item => item.path === 'list[].providentFundPersonalCost')).toBe(true)
    expect(contracts['report-standard-unit-insurance-list']?.boundaries.join('\n')).toContain('没有导出')
  })
})
