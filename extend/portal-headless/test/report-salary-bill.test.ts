import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportSalaryBillCapability,
  REPORT_SALARY_BILL_METHODS,
  REPORT_SALARY_BILL_PAGE_PATH,
  REPORT_SALARY_BILL_PAYROLL_FIELDS,
  reportSalaryBillCapabilities,
} from '../src/capabilities/report-salary-bill.js'
import {
  REPORT_SALARY_BILL_AI_CONTRACTS as contracts,
  REPORT_SALARY_BILL_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-salary-bill.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportSalaryBillCapability(request), calls }
}

const row = {
  name: '张三',
  staffCode: 1001,
  idCard: 'masked',
  legalPersonName: '法人',
  payrollUnit: '总部',
  postName: '会计',
  orgName: '总部/财务',
  documentName: '2026年9月工资单',
  ledgerName: '默认账套',
  salaryYearMonth: '2026-09',
  basicSalary: '100.00',
  realPaySalary: '90.00',
  shouldAttendanceDays: 21,
  actualAttendanceDays: 20,
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment;filename*=UTF-8''%E3%80%902026-09%E3%80%91%E5%B7%A5%E8%B5%84%E5%8D%95.xlsx",
  },
}

describe('Portal 人力报表 → 工资单查询', () => {
  it('锁定菜单、权限、platform实例、module-type、只读动作和工资字段', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/salary-bill/list.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_SALARY_BILL_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/salary-bill'")
    expect(page).toContain("getDataListURL: '/salary/report/selectPayrollPage'")
    expect(page).toContain("url: '/admin-api/salary/report/exportPayrollPage'")
    expect(page).toContain("year: data.yearMonth ? data.yearMonth.format('YYYY') : ''")
    expect(page).toContain("month: data.yearMonth ? data.yearMonth.format('MM') : ''")
    expect(page).toContain("postId: data.id ? data.postId : ''")
    expect(page).toContain("{ dataIndex: 'preTaxSalary', title: '税前工资'")
    expect(reportSalaryBillCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_SALARY_BILL_METHODS))
    expect(reportSalaryBillCapabilities.every(item => item.pagePath === REPORT_SALARY_BILL_PAGE_PATH && item.permission === '/dashboard/report/salary-bill' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_SALARY_BILL_PAGE_PATH).moduleType).toBe(14)
    expect(REPORT_SALARY_BILL_PAYROLL_FIELDS.length).toBeGreaterThan(60)
    expect(reportSalaryBillCapabilities.find(item => item.id === 'report-salary-bill-list')?.params.map(item => item.name)).toEqual(expect.arrayContaining(['yearMonth', 'staffCode', 'legalPersonId', 'payrollUnitId', 'postId', 'organizationId', 'ledgerId', 'pageNo', 'pageSize']))
  })

  it('逐页核对Java Controller/DTO/Service/Mapper/Excel字段和数据范围规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report')
    const controller = readFileSync(join(root, 'controller/ReportSalaryController.java'), 'utf8')
    const selectDto = readFileSync(join(root, 'dto/ReportPayrollSelectDTO.java'), 'utf8')
    const rowDto = readFileSync(join(root, 'dto/ReportPayrollDTO.java'), 'utf8')
    const service = readFileSync(join(root, 'service/impl/PayrollServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/performance/report/PayrollDao.xml'), 'utf8')
    const excel = readFileSync(join(root, 'excel/ReportPayrollExcel.java'), 'utf8')
    for (const fragment of ['@GetMapping("selectPayrollPage")', '@GetMapping("exportPayrollPage")']) expect(controller).toContain(fragment)
    for (const field of ['name', 'staffCode', 'postId', 'payrollUnitId', 'legalPersonId', 'costCenterId', 'organizationId', 'documentName', 'ledgerId', 'year', 'month', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['basicSalary', 'grossSalary', 'realPaySalary', 'PreTaxSalary', 'shouldAttendanceDays', 'actualAttendanceDays']) {
      expect(rowDto).toContain(field)
      expect(excel).toContain(field)
      expect(mapper).toContain(field)
    }
    for (const fragment of ['getWebLedgerList', 'getDescendantByAncestor', '@DataScope', 'dto.setPageSize(DEFAULT_BATCH_SIZE)', 'selectPayrollPage(dto)']) expect(service).toContain(fragment)
  })

  it('按Portal逐字段拆分年月，列表和导出使用各自的参数集合', async () => {
    const f = fixture([{ list: [row], total: 1 }, fileResponse])
    await expect(f.api.list({ yearMonth: '2026-09', name: '张', staffCode: '1001', costCenterId: 2, legalPersonId: 3, payrollUnitId: 4, postId: 5, organizationId: 6, documentName: '工资', ledgerId: 7, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/report/selectPayrollPage', method: 'get', params: { order: '', orderField: '', name: '张', staffCode: '1001', costCenterId: 2, legalPersonId: 3, payrollUnitId: 4, postId: 5, organizationId: 6, documentName: '工资', ledgerId: 7, year: '2026', month: '09', pageNo: 2, pageSize: 50 } })
    await expect(f.api.export({ yearMonth: '2026-09', name: '张', staffCode: '1001', organizationId: 6, ledgerId: 7 })).resolves.toMatchObject({ fileName: '【2026-09】工资单.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/salary/report/exportPayrollPage', method: 'get', params: { name: '张', staffCode: '1001', costCenterId: '', legalPersonId: '', payrollUnitId: '', postId: '', organizationId: 6, documentName: '', ledgerId: 7, year: '2026', month: '09' }, responseType: 'arraybuffer' })
  })

  it('默认当前月、显式清空年月和坏参数保持页面边界', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    const now = new Date()
    expect(f.calls[0]!.params).toMatchObject({ year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0'), pageNo: 1, pageSize: 20 })
    await expect(fixture([{ list: [], total: 0 }]).api.list({ yearMonth: null })).resolves.toEqual({ list: [], total: 0 })
    expect((f.calls[0]!.params as Record<string, unknown>).postId).toBe('')
    await expect(f.api.list({ yearMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ staffCode: 'A-1' })).rejects.toThrow('staffCode')
    await expect(f.api.list({ organizationId: 0 })).rejects.toThrow('organizationId')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约锁定只读边界、敏感字段、字段集合和导出筛选语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_SALARY_BILL_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_SALARY_BILL_METHODS).map(method => `reportSalaryBill.${method}`))
    expect(contracts['report-salary-bill-list']?.output.fields.some(item => item.path === 'list[].grossSalary')).toBe(true)
    expect(contracts['report-salary-bill-list']?.output.fields.some(item => item.path === 'list[].preTaxSalary')).toBe(true)
    expect(contracts['report-salary-bill-list']?.output.fields.some(item => item.path === 'list[].PreTaxSalary')).toBe(false)
    expect(contracts['report-salary-bill-list']?.boundaries.join('\n')).toContain('DataScope')
    expect(contracts['report-salary-bill-export']?.inputs.pageNo).toBeUndefined()
    expect(contracts['report-salary-bill-export']?.gaps?.join('\n')).toContain('真实测试环境')
  })
})
