import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportPersonTaxCapability, REPORT_PERSON_TAX_METHODS, REPORT_PERSON_TAX_PAGE_PATH, reportPersonTaxCapabilities } from '../src/capabilities/report-person-tax.js'
import { REPORT_PERSON_TAX_AI_CONTRACTS as contracts, REPORT_PERSON_TAX_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-person-tax.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportPersonTaxCapability(request), calls }
}

function monthAtOffset (offset: number): string {
  const date = new Date()
  date.setDate(1)
  date.setMonth(date.getMonth() + offset)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

const row = {
  index: null,
  deptPath: '总部/财务',
  name: '张三',
  idCard: 'masked',
  monthPay: '2026-09',
  ledgerName: '基本账套',
  post: '会计',
  baseSalary: '100.00',
  incomeTax: '3.00',
  bigMedical: '1.00',
  netSalary: '97.00',
  extra: 'keep',
}

const fileResponse = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel;charset=utf-8', 'content-disposition': "attachment;filename*=utf-8''%E3%80%902026-08-2026-09%E3%80%91%E3%80%90%E4%B8%AA%E7%A8%8E%E4%BB%A3%E6%89%A3%E6%98%8E%E7%BB%86%E8%A1%A8%E3%80%91.xlsx" } }

describe('Portal 人力报表 → 个人所得税代扣代缴明细页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_PERSON_TAX_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/person-tax'")
    expect(reportPersonTaxCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_PERSON_TAX_METHODS))
    expect(reportPersonTaxCapabilities.every(item => item.pagePath === REPORT_PERSON_TAX_PAGE_PATH && item.permission === '/dashboard/report/person-tax' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_PERSON_TAX_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/person-tax/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8')
    const selectDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/PersonTaxDetailsSelectDTO.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/PersonTaxDetailsDTO.java`, 'utf8')
    const service = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentServiceImpl.java`, 'utf8')
    const mapper = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryDocumentDao.xml`, 'utf8')
    const excel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/excel/PersonTaxDetailsExcel.java`, 'utf8')
    expect(source).toContain("getDataListURL: '/admin-api/salary/report/personTaxDetailsPage'")
    expect(source).toContain("monthPayRange: [dayjs().subtract(1, 'month').format('YYYY-MM'), formatDay(new Date(), 'YYYY-MM')]")
    expect(source).toContain("monthPay: data.monthPayRange && data.monthPayRange.length ? data.monthPayRange[0] : ''")
    expect(source).toContain("endmonthPay: data.monthPayRange && data.monthPayRange.length ? data.monthPayRange[1] : ''")
    expect(source).toContain("ledgerIds: data.ledgerIds ? data.ledgerIds.join(',') : ''")
    expect(source).toContain("url: '/admin-api/salary/report/exportPersonTaxDetails'")
    expect(controller).toContain('@GetMapping("personTaxDetailsPage")')
    expect(controller).toContain('@GetMapping("exportPersonTaxDetails")')
    for (const field of ['orgId', 'monthPay', 'endmonthPay', 'ledgerIds', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['deptPath', 'monthPay', 'idCard', 'bigMedical', 'totalAdditionalPrice', 'netSalary']) expect(resultDto).toContain(field)
    for (const fragment of ['getWebLedgerList', 'getDescendantByAncestor', 'setLedgerIds', 'getPersonTaxDetailsPage', 'exportPersonTaxDetails']) expect(service).toContain(fragment)
    for (const fragment of ['getPersonTaxDetails', 'FIND_IN_SET', 'dto.monthPay', 'dto.endmonthPay', 'bigMedical']) expect(mapper).toContain(fragment)
    for (const field of ['部门路径', '大额医疗', '累计已缴纳个税', '实发工资']) expect(excel).toContain(field)
  })

  it('列表严格复现Portal的上月到本月默认值、年月区间、组织、账套和分页参数', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ monthPayRange: ['2026-08', '2026-09'], orgId: 9, ledgerIds: [11, '12'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/personTaxDetailsPage', method: 'get',
      params: { order: '', orderField: '', orgId: 9, monthPay: '2026-08', endmonthPay: '2026-09', ledgerIds: '11,12', pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'orgId', 'monthPay', 'endmonthPay', 'ledgerIds', 'pageNo', 'pageSize'])

    const defaultFixture = fixture([{ list: [], total: 0 }])
    await defaultFixture.api.list()
    expect(defaultFixture.calls[0]!.params).toMatchObject({ orgId: '', monthPay: monthAtOffset(-1), endmonthPay: monthAtOffset(0), ledgerIds: '' })
  })

  it('导出只发送转换后的表单字段，保留服务端动态文件名和二进制内容', async () => {
    const f = fixture([fileResponse])
    await expect(f.api.export({ monthPayRange: ['2026-08', '2026-09'], orgId: 9, ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '【2026-08-2026-09】【个税代扣明细表】.xlsx', contentType: 'application/vnd.ms-excel;charset=utf-8', byteLength: 3, base64: 'AQID' })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/exportPersonTaxDetails', method: 'get',
      params: { orgId: 9, monthPay: '2026-08', endmonthPay: '2026-09', ledgerIds: '11,12' }, responseType: 'arraybuffer',
    })
  })

  it('显式清空筛选与坏参数/坏响应不会静默成功', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list({ monthPayRange: null, orgId: null, ledgerIds: [] })
    expect(f.calls[0]!.params).toMatchObject({ orgId: '', monthPay: '', endmonthPay: '', ledgerIds: '' })
    await expect(f.api.list({ monthPayRange: ['2026-13', '2026-09'] })).rejects.toThrow('YYYY-MM')
    await expect(f.api.list({ orgId: 0 })).rejects.toThrow('orgId')
    await expect(f.api.list({ ledgerIds: [1, 0] })).rejects.toThrow('ledgerIds[1]')
    await expect(f.api.list({ ledgerIds: 1 as never })).rejects.toThrow('ledgerIds必须为ID数组')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖页面字段、当前页合计边界、账套权限语义和导出', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_PERSON_TAX_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportPersonTax.list', 'reportPersonTax.export'])
    expect(contracts['report-person-tax-list']?.output.fields.some(item => item.path === 'list[].incomeTax')).toBe(true)
    expect(contracts['report-person-tax-list']?.output.fields.some(item => item.path === 'list[].bigMedical')).toBe(true)
    expect(contracts['report-person-tax-list']?.boundaries.join('\n')).toContain('当前页')
    expect(contracts['report-person-tax-list']?.inputs.ledgerIds?.omitted).toContain('全部网页账套')
    expect(contracts['report-person-tax-export']?.output.fields.some(item => item.path === 'fileName')).toBe(true)
  })
})
