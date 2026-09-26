import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportCenterInsuranceCapability, REPORT_CENTER_INSURANCE_METHODS, REPORT_CENTER_INSURANCE_PAGE_PATH, reportCenterInsuranceCapabilities } from '../src/capabilities/report-center-insurance.js'
import { REPORT_CENTER_INSURANCE_AI_CONTRACTS as contracts, REPORT_CENTER_INSURANCE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-center-insurance.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) { const calls: RequestConfig[] = []; const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); const next = responses.shift(); if (next instanceof Error) throw next; return next as T }; return { api: createReportCenterInsuranceCapability(request), calls } }
const row = { costCenterName: '一组', costMonth: '2026-09', fiveInsurancePersonNum: 2, providentFundPersonNum: 2, pensionUnitCost: '10.00', fiveInsurancePersonalCostTotal: '20.00', extra: 'keep' }
const fileResponse = { data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': "attachment; filename*=UTF-8''%E4%B8%AD%E5%BF%83%E4%BA%94%E9%99%A9%E4%B8%80%E9%87%91%E6%B1%87%E6%80%BB.xlsx" } }

describe('Portal 人力报表 → 中心五险一金汇总页面能力', () => {
  it('锁定菜单、权限、platform实例和module-type', () => {
    expect(reportCenterInsuranceCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_CENTER_INSURANCE_METHODS))
    expect(reportCenterInsuranceCapabilities.every(item => item.pagePath === REPORT_CENTER_INSURANCE_PAGE_PATH && item.permission === '/dashboard/report/center-insurance' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_CENTER_INSURANCE_PAGE_PATH).moduleType).toBe(14)
  })
  it('源码、菜单、Java Controller和DTO对齐', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'; const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8'); const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/center-insurance/list.vue`, 'utf8'); const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8'); const dto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/ReportSalaryInsuranceCostSelectDTO.java`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_CENTER_INSURANCE_PAGE_PATH}'`); expect(source).toContain("getDataListURL: '/salary/report/salaryInsuranceCostsPage'"); expect(source).toContain('exportSalaryInsuranceCosts'); expect(controller).toContain('@GetMapping("salaryInsuranceCostsPage")'); expect(controller).toContain('@GetMapping("exportSalaryInsuranceCosts")'); for (const field of ['organizationId', 'costMonth', 'costCenterId', 'pageNo', 'pageSize']) expect(dto).toContain(field)
  })
  it('列表只发送页面实际字段，导出不带分页且保留服务端字段', async () => {
    const f = fixture([{ list: [row], total: 1 }, fileResponse]); await expect(f.api.list({ organizationId: 9, costMonth: '2026-09', costCenterId: 4, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 }); expect(f.calls[0]).toEqual({ url: '/salary/report/salaryInsuranceCostsPage', method: 'get', params: { order: '', orderField: '', organizationId: 9, costCenterId: 4, costMonth: '2026-09', pageNo: 2, pageSize: 50 } }); await expect(f.api.export({ organizationId: 9, costMonth: '2026-09', costCenterId: 4 })).resolves.toMatchObject({ fileName: '中心五险一金汇总.xlsx', byteLength: 2 }); expect(f.calls[1]).toEqual({ url: '/admin-api/salary/report/exportSalaryInsuranceCosts', method: 'get', params: { organizationId: 9, costCenterId: 4, costMonth: '2026-09' }, responseType: 'arraybuffer' })
  })
  it('默认月份、坏参数和空文件会失败', async () => {
    const f = fixture([{ list: [], total: 0 }]); await f.api.list(); expect((f.calls[0]!.params as Record<string, unknown>).costMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/); await expect(f.api.list({ costMonth: '2026-13' })).rejects.toThrow('YYYY-MM'); await expect(f.api.list({ costCenterId: 0 })).rejects.toThrow('costCenterId'); await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500'); await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })
  it('AI契约覆盖金额字段与候选边界', () => { expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_CENTER_INSURANCE_METHODS)); expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(REPORT_CENTER_INSURANCE_METHODS).map(method => `reportCenterInsurance.${method}`))]); expect(contracts['report-center-insurance-list']?.output.fields.some(item => item.path === 'list[].fiveInsurancePersonalCostTotal')).toBe(true); expect(contracts['report-center-insurance-list']?.gaps?.join('\n')).toContain('成本中心') })
})
