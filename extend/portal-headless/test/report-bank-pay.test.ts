import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportBankPayCapability,
  REPORT_BANK_PAY_METHODS,
  REPORT_BANK_PAY_PAGE_PATH,
  reportBankPayCapabilities,
} from '../src/capabilities/report-bank-pay.js'
import { REPORT_BANK_PAY_AI_CONTRACTS as contracts, REPORT_BANK_PAY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-bank-pay.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportBankPayCapability(request), calls }
}

const row = { salaryMonth: '2026-09', name: '张三', fullPath: '总部-财务', idCard: 'x', cardIssuingBank: '农业', bankAccount: '1', realPaySalary: '100.00', hidden: 'keep' }
const fileResponse = (name: string) => ({ data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}` } })

describe('Portal 人力报表 → 银行代发页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    expect(reportBankPayCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_BANK_PAY_METHODS))
    expect(reportBankPayCapabilities.every(item => item.pagePath === REPORT_BANK_PAY_PAGE_PATH && item.permission === '/dashboard/report/bank-pay' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_BANK_PAY_PAGE_PATH).moduleType).toBe(14)
  })

  it('源码和Java DTO锚定页面真实接口、字段和权限', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/bank-pay/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8')
    const dto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/BankDropshippingSelectDTO.java`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_BANK_PAY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/bank-pay'")
    expect(source).toContain(`getDataListURL: '${'/admin-api/salary/report/bankDropshippingPage'}'`)
    expect(source).toContain("url: '/admin-api/salary/report/exportBankDropshipping'")
    expect(source).toContain("url: '/admin-api/salary/report/exportByBank'")
    for (const field of ['orgId', 'salaryMonth', 'ledgerIds', 'pageNo', 'pageSize']) expect(dto).toContain(field)
    expect(controller).toContain('@GetMapping("bankDropshippingPage")')
    expect(controller).toContain('@GetMapping("exportBankDropshipping")')
    expect(controller).toContain('@GetMapping("exportByBank")')
  })

  it('列表按页面顺序转换月份、账套数组和分页；保留服务端扩展字段', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ orgId: 9, salaryMonth: '2026-09', ledgerIds: [11, '12'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/salary/report/bankDropshippingPage', method: 'get',
      params: { order: '', orderField: '', orgId: 9, salaryMonth: '2026-09', ledgerIds: '11,12', pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'orgId', 'salaryMonth', 'ledgerIds', 'pageNo', 'pageSize'])
  })

  it('导出只发送页面表单字段，模式2/3映射为农业/建设银行', async () => {
    const f = fixture([fileResponse('银行代发表.xlsx'), fileResponse('中国农业银行代发表.xlsx'), fileResponse('中国建设银行代发表.xlsx')])
    await expect(f.api.export({ orgId: 9, salaryMonth: '2026-09', ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '银行代发表.xlsx', byteLength: 3 })
    await expect(f.api.exportByBank({ mode: 2, orgId: 9, salaryMonth: '2026-09', ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '中国农业银行代发表.xlsx', byteLength: 3 })
    await expect(f.api.exportByBank({ mode: 3, orgId: 9, salaryMonth: '2026-09', ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '中国建设银行代发表.xlsx', byteLength: 3 })
    expect(f.calls).toEqual([
      { url: '/admin-api/salary/report/exportBankDropshipping', method: 'get', params: { orgId: 9, salaryMonth: '2026-09', ledgerIds: '11,12' }, responseType: 'arraybuffer' },
      { url: '/admin-api/salary/report/exportByBank', method: 'get', params: { orgId: 9, salaryMonth: '2026-09', ledgerIds: '11,12', cardIssuingBank: '农业' }, responseType: 'arraybuffer' },
      { url: '/admin-api/salary/report/exportByBank', method: 'get', params: { orgId: 9, salaryMonth: '2026-09', ledgerIds: '11,12', cardIssuingBank: '建设' }, responseType: 'arraybuffer' },
    ])
  })

  it('当前月默认值、坏分页/月份/模式/文件不会静默成功', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect((f.calls[0]!.params as Record<string, unknown>).salaryMonth).toMatch(/^\d{4}-(0[1-9]|1[0-2])$/)
    await expect(f.api.list({ salaryMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(f.api.exportByBank({ mode: 1 as 2 })).rejects.toThrow('mode')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
  })

  it('AI契约与方法路径完整登记，并明确模式映射和敏感字段', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_BANK_PAY_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(REPORT_BANK_PAY_METHODS).map(method => `reportBankPay.${method}`))])
    expect(contracts['report-bank-pay-list']?.output.fields.some(item => item.path === 'list[].realPaySalary')).toBe(true)
    expect(contracts['report-bank-pay-export-by-bank']?.consume.join('\n')).toContain('cardIssuingBank=农业或建设')
    expect(contracts['report-bank-pay-list']?.gaps?.join('\n')).toContain('真实测试环境')
  })
})
