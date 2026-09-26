import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportSalaryItemCapability,
  REPORT_SALARY_ITEM_AMOUNT_FIELDS,
  REPORT_SALARY_ITEM_METHODS,
  REPORT_SALARY_ITEM_PAGE_PATH,
  reportSalaryItemCapabilities,
} from '../src/capabilities/report-salary-item.js'
import {
  REPORT_SALARY_ITEM_AI_CONTRACTS as contracts,
  REPORT_SALARY_ITEM_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-salary-item.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportSalaryItemCapability(request), calls }
}

function monthAtOffset (offset: number): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const row = {
  orgName: '财务部',
  name: '张三',
  staffCode: 1001,
  startYearMonth: '2026-08',
  endYearMonth: '2026-09',
  basicSalaryTotal: '100.00',
  deductionSalaryTotal: '10.00',
  actualSalaryTotal: '90.00',
  extra: 'keep',
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.ms-excel;charset=utf-8',
    'content-disposition': "attachment;filename*=utf-8''%E9%83%A8%E9%97%A8%E5%91%98%E5%B7%A5%E5%B7%A5%E8%B5%84%E9%A1%B9%E7%9B%AE%E6%B1%87%E6%80%BB%E8%A1%A8.xlsx",
  },
}

describe('Portal 人力报表 → 工资项目统计页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const source = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/salary-item/list.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_SALARY_ITEM_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/salary-item'")
    expect(source).toContain("getDataListURL: '/salary/report/staffSalaryItemPage'")
    expect(source).toContain("url: `${import.meta.env.VITE_ZHDJ_PLATFORM_API}/admin-api/salary/report/exportStaffSalaryItem`")
    expect(source).toContain("yearMonth: [dayjs().subtract(1, 'month'), dayjs()]")
    expect(source).toContain("startYearMonth: data.yearMonth && data.yearMonth[0] ? data.yearMonth[0].startOf('date').format('YYYY-MM') : ''")
    expect(source).toContain("endYearMonth: data.yearMonth && data.yearMonth[1] ? data.yearMonth[1].startOf('date').format('YYYY-MM') : ''")
    expect(source).toContain("ledgerIds: data.ledgerIds && data.ledgerIds.length ? data.ledgerIds.join(',') : ''")
    expect(source).toContain("{ required: true, message: '请选择时间范围', trigger: 'change' }")
    for (const [field] of REPORT_SALARY_ITEM_AMOUNT_FIELDS) expect(source).toContain(`dataIndex: '${field}'`)
    expect(reportSalaryItemCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_SALARY_ITEM_METHODS))
    expect(reportSalaryItemCapabilities.every(item => item.pagePath === REPORT_SALARY_ITEM_PAGE_PATH && item.permission === '/dashboard/report/salary-item' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_SALARY_ITEM_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段核对Java Controller/DTO/Service/Mapper/Excel和组织账套权限规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const reportRoot = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report')
    const controller = readFileSync(join(reportRoot, 'controller/ReportSalaryController.java'), 'utf8')
    const selectDto = readFileSync(join(reportRoot, 'dto/StaffSalaryItemSelectDTO.java'), 'utf8')
    const rowDto = readFileSync(join(reportRoot, 'dto/StaffSalaryItemDTO.java'), 'utf8')
    const excel = readFileSync(join(reportRoot, 'excel/StaffSalaryItemExcel.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryDocumentUserInformationDao.xml'), 'utf8')
    expect(controller).toContain('@GetMapping("staffSalaryItemPage")')
    expect(controller).toContain('@GetMapping("exportStaffSalaryItem")')
    for (const field of ['name', 'staffCode', 'startYearMonth', 'endYearMonth', 'organizationId', 'organizationIdList', 'ledgerId', 'ledgerIds', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['orgName', 'name', 'staffCode', 'startYearMonth', 'endYearMonth']) {
      expect(rowDto).toContain(field)
      expect(excel).toContain(field)
      expect(mapper).toContain(field)
    }
    for (const [field] of REPORT_SALARY_ITEM_AMOUNT_FIELDS) {
      expect(rowDto).toContain(field)
      expect(excel).toContain(field)
      expect(mapper).toContain(field)
    }
    expect(rowDto).not.toContain('private Integer index')
    for (const fragment of ['@DataScope(organizationAlias = "t2", organizationIdAlias = "organization")', 'getDescendantByAncestor', 'getWebLedgerList', 'dto.setLedgerIds(ids)', 'dto.setPageSize(DEFAULT_BATCH_SIZE)', 'setSummary(summary', 'setIndex(index++)']) expect(service).toContain(fragment)
    for (const fragment of ['selectStaffSalaryItemPage', 'organizationIdList', 'dto.staffCode', 'dto.name', 'FIND_IN_SET', 'dto.startYearMonth', 'dto.endYearMonth', 'dataScopeKPI', 'GROUP BY', 'ORDER BY t1.staff_id']) expect(mapper).toContain(fragment)
    expect(excel).toContain('@ExcelProperty(value = "序号")')
    expect(excel).toContain('部门员工工资项目汇总')
  })

  it('按Portal顺序投影筛选、年月范围和账套，列表必填范围且导出不发送分页字段', async () => {
    const f = fixture([{ list: [row], total: 1 }, fileResponse])
    await expect(f.api.list({ organizationId: 9, name: '张', staffCode: '1001', yearMonth: ['2026-08', '2026-09'], ledgerIds: [11, '12'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/staffSalaryItemPage', method: 'get',
      params: { order: '', orderField: '', organizationId: 9, name: '张', staffCode: '1001', startYearMonth: '2026-08', endYearMonth: '2026-09', ledgerIds: '11,12', pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'organizationId', 'name', 'staffCode', 'startYearMonth', 'endYearMonth', 'ledgerIds', 'pageNo', 'pageSize'])

    await expect(f.api.export({ organizationId: 9, name: '张', staffCode: '1001', yearMonth: ['2026-08', '2026-09'], ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '部门员工工资项目汇总表.xlsx', contentType: 'application/vnd.ms-excel;charset=utf-8', byteLength: 3, base64: 'AQID' })
    expect(f.calls[1]).toEqual({
      url: '/admin-api/salary/report/exportStaffSalaryItem', method: 'get',
      params: { organizationId: 9, name: '张', staffCode: '1001', startYearMonth: '2026-08', endYearMonth: '2026-09', ledgerIds: '11,12' }, responseType: 'arraybuffer',
    })
  })

  it('默认上月到本月、显式空值和坏参数遵守页面边界', async () => {
    const defaultFixture = fixture([{ list: [], total: 0 }])
    await defaultFixture.api.list()
    expect(defaultFixture.calls[0]!.params).toMatchObject({ organizationId: '', name: '', staffCode: '', startYearMonth: monthAtOffset(-1), endYearMonth: monthAtOffset(0), ledgerIds: '' })

    const missingRange = fixture([{ list: [], total: 0 }])
    await expect(missingRange.api.list({ yearMonth: null })).rejects.toThrow(/yearMonth必填/)
    await expect(missingRange.api.list({ yearMonth: [] as never })).rejects.toThrow(/yearMonth必填/)
    expect(missingRange.calls).toHaveLength(0)

    const emptyExport = fixture([fileResponse])
    await emptyExport.api.export({ yearMonth: null, organizationId: null, name: null, staffCode: null, ledgerIds: [] })
    expect(emptyExport.calls[0]!.params).toEqual({ organizationId: '', name: '', staffCode: '', startYearMonth: '', endYearMonth: '', ledgerIds: '' })
    await expect(fixture([{ list: [], total: 0 }]).api.list({ yearMonth: ['2026-13', '2026-09'] })).rejects.toThrow('YYYY-MM')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ organizationId: 0, yearMonth: ['2026-08', '2026-09'] })).rejects.toThrow('organizationId')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ staffCode: 'A100', yearMonth: ['2026-08', '2026-09'] })).rejects.toThrow('staffCode')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ ledgerIds: [0], yearMonth: ['2026-08', '2026-09'] })).rejects.toThrow('ledgerIds')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ pageSize: 30, yearMonth: ['2026-08', '2026-09'] })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖全部表格字段、表单required规则、权限和导出汇总语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_SALARY_ITEM_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportSalaryItem.list', 'reportSalaryItem.export'])
    for (const [field] of REPORT_SALARY_ITEM_AMOUNT_FIELDS) expect(contracts['report-salary-item-list']?.output.fields.some(item => item.path === `list[].${field}`)).toBe(true)
    expect(contracts['report-salary-item-list']?.boundaries.join('\n')).toContain('@DataScope')
    expect(contracts['report-salary-item-list']?.failures.join('\n')).toContain('required')
    expect(contracts['report-salary-item-export']?.inputs.pageNo).toBeUndefined()
    expect(contracts['report-salary-item-export']?.consume.join('\n')).toContain('汇总行')
    expect(contracts['report-salary-item-list']?.gaps?.join('\n')).toContain('账套')
  })
})
