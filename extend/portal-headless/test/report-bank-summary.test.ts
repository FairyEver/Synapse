import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportBankSummaryCapability, REPORT_BANK_SUMMARY_METHODS, REPORT_BANK_SUMMARY_PAGE_PATH, reportBankSummaryCapabilities } from '../src/capabilities/report-bank-summary.js'
import { REPORT_BANK_SUMMARY_AI_CONTRACTS as contracts, REPORT_BANK_SUMMARY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-bank-summary.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => { calls.push(config); const next = responses.shift(); if (next instanceof Error) throw next; return next as T }
  return { api: createReportBankSummaryCapability(request), calls }
}
const row = { cardIssuingBank: '农业', number: 2, salaryMonth: '2026-09', realPaySalary: '200.00', extra: 'keep' }
const fileResponse = { data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': "attachment; filename*=UTF-8''%E9%93%B6%E8%A1%8C%E6%B1%87%E6%80%BB.xlsx" } }

describe('Portal 人力报表 → 银行汇总页面能力', () => {
  it('锁定菜单、权限、platform实例和module-type', () => {
    expect(reportBankSummaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_BANK_SUMMARY_METHODS))
    expect(reportBankSummaryCapabilities.every(item => item.pagePath === REPORT_BANK_SUMMARY_PAGE_PATH && item.permission === '/dashboard/report/bank-summary' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_BANK_SUMMARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('源码和Java锚定列表/导出与筛选字段', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/bank-summary/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8')
    const dto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/BankSummarySelectDTO.java`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_BANK_SUMMARY_PAGE_PATH}'`)
    expect(source).toContain("getDataListURL: '/salary/report/getBankSummaryPage'")
    expect(source).toContain('exportBankSummary')
    expect(controller).toContain('@GetMapping("getBankSummaryPage")')
    expect(controller).toContain('@GetMapping("exportBankSummary")')
    for (const field of ['organization', 'cardIssuingBank', 'salaryMonth', 'ledgerIds', 'pageNo', 'pageSize']) expect(dto).toContain(field)
  })

  it('列表和导出严格复现Portal的字段顺序与月份/账套投影', async () => {
    const f = fixture([{ list: [row], total: 1 }, fileResponse])
    await expect(f.api.list({ organization: 9, cardIssuingBank: '农', salaryMonth: '2026-09', ledgerIds: [11, 12], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/report/getBankSummaryPage', method: 'get', params: { order: '', orderField: '', organization: 9, cardIssuingBank: '农', salaryMonth: '2026-09', ledgerIds: '11,12', pageNo: 2, pageSize: 50 } })
    await expect(f.api.export({ organization: 9, cardIssuingBank: '农', salaryMonth: '2026-09', ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '银行汇总.xlsx', byteLength: 2 })
    expect(f.calls[1]).toEqual({ url: '/salary/report/exportBankSummary', method: 'get', params: { organization: 9, cardIssuingBank: '农', salaryMonth: '2026-09', ledgerIds: '11,12' }, responseType: 'arraybuffer' })
  })

  it('默认当前月份、坏参数和空文件会失败', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect((f.calls[0]!.params as Record<string, unknown>).salaryMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    await expect(f.api.list({ salaryMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ organization: 0 })).rejects.toThrow('organization')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖当前页面动作、返回字段和长候选边界', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_BANK_SUMMARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(REPORT_BANK_SUMMARY_METHODS).map(method => `reportBankSummary.${method}`))])
    expect(contracts['report-bank-summary-list']?.output.fields.some(item => item.path === 'list[].realPaySalary')).toBe(true)
    expect(contracts['report-bank-summary-list']?.gaps?.join('\n')).toContain('组织树')
  })
})
