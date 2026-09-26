import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createReportPostSalaryCapability, REPORT_POST_SALARY_METHODS, REPORT_POST_SALARY_PAGE_PATH, reportPostSalaryCapabilities } from '../src/capabilities/report-post-salary.js'
import { REPORT_POST_SALARY_AI_CONTRACTS as contracts, REPORT_POST_SALARY_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-report-post-salary.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportPostSalaryCapability(request), calls }
}

function currentYear (): string {
  return String(new Date().getFullYear())
}

const row = {
  sort: '1',
  name: '张三',
  year: currentYear(),
  organizationName: '总部',
  fullPath: '总部/财务',
  staffCode: 'A001',
  idCard: 'masked',
  basicSalary1: '100.00',
  assessmentSalary1: '20.00',
  departmentAssessmentSalary1: '10.00',
  profitAssessmentSalary1: '5.00',
  basicSalary12: '120.00',
  profitAssessmentSalary12: '8.00',
  extra: 'keep',
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.ms-excel;charset=utf-8',
    'content-disposition': "attachment;filename*=utf-8''%E3%80%902026%E3%80%91%E3%80%90%E5%B2%97%E4%BD%8D%E5%B7%A5%E8%B5%84%E7%BB%9F%E8%AE%A1%E8%A1%A8%E3%80%91.xlsx",
  },
}

describe('Portal 人力报表 → 岗位工资统计', () => {
  it('锁定菜单、权限、platform实例、module-type和只读动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${REPORT_POST_SALARY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/post-salary'")
    expect(reportPostSalaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_POST_SALARY_METHODS))
    expect(reportPostSalaryCapabilities.every(item => item.pagePath === REPORT_POST_SALARY_PAGE_PATH && item.permission === '/dashboard/report/post-salary' && item.moduleType === 14 && item.httpInstance === 'platform' && !item.write)).toBe(true)
    expect(resolveModuleType(REPORT_POST_SALARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal页面、Java Controller/DTO/Service/Mapper/Excel证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/report/post-salary/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/controller/ReportSalaryController.java`, 'utf8')
    const selectDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/PostSalaryStatisticsSelectDTO.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/dto/PostSalaryStatisticsDTO.java`, 'utf8')
    const service = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/service/impl/ReportBankDropShippingServiceImpl.java`, 'utf8')
    const mapper = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/performance/report/ReportBankDropShipping.xml`, 'utf8')
    const excel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/report/excel/PostSalaryStatisticsExcel.java`, 'utf8')
    expect(source).toContain("getDataListURL: '/salary/report/getPostSalaryStatistics'")
    expect(source).toContain('year: dayjs(),')
    expect(source).toContain("organizationName: ''")
    expect(source).toContain("year: data.year ? data.year.format('YYYY') : ''")
    expect(source).toContain("ledgerIds: data.ledgerIds && data.ledgerIds.length ? data.ledgerIds.join(',') : ''")
    expect(source).toContain("url: '/admin-api/salary/report/exportPostSalaryStatistics'")
    expect(source).toContain("current && current > dayjs().endOf('year')")
    expect(controller).toContain('@GetMapping("getPostSalaryStatistics")')
    expect(controller).toContain('@GetMapping("exportPostSalaryStatistics")')
    for (const field of ['name', 'year', 'organizationName', 'ledgerIds', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['sort', 'organizationName', 'fullPath', 'staffCode', 'basicSalary1', 'profitAssessmentSalary12']) expect(resultDto).toContain(field)
    for (const fragment of ['getWebLedgerList', 'getDescendantByAncestor', 'setEmptySalariesToZero', 'getSalaryMonth', 'exportPostSalaryStatistics', 'buildPostSalaryStatisticsFileName']) expect(service).toContain(fragment)
    for (const fragment of ['getPostSalaryStatistics', 'ROW_NUMBER', 'FIND_IN_SET', 'dto.organizationIdList', 'dto.year', 'c.staff_code']) expect(mapper).toContain(fragment)
    for (const field of ['部门路径', '(1月)基本工资', '(12月)利润考核工资', '证件号码']) expect(excel).toContain(field)
  })

  it('按Portal顺序发送姓名、年份、组织、账套和分页参数，保留服务端额外字段', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ name: '张三', year: '2025', organizationId: 9, ledgerIds: [11, '12'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/getPostSalaryStatistics', method: 'get',
      params: { order: '', orderField: '', name: '张三', year: '2025', organizationName: 9, ledgerIds: '11,12', pageNo: 2, pageSize: 50 },
    })
    expect(Object.keys(f.calls[0]!.params as object)).toEqual(['order', 'orderField', 'name', 'year', 'organizationName', 'ledgerIds', 'pageNo', 'pageSize'])
  })

  it('复现Portal默认当前年份、清空筛选和未来年份禁选规则', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect(f.calls[0]!.params).toMatchObject({ name: '', year: currentYear(), organizationName: '', ledgerIds: '' })
    const cleared = fixture([{ list: [], total: 0 }])
    await cleared.api.list({ name: null, year: null, organizationId: null, ledgerIds: [] })
    expect(cleared.calls[0]!.params).toMatchObject({ name: '', year: '', organizationName: '', ledgerIds: '' })
    await expect(f.api.list({ year: String(Number(currentYear()) + 1) })).rejects.toThrow('不能晚于当前年份')
    await expect(f.api.list({ year: '2026-01' })).rejects.toThrow('YYYY')
    await expect(f.api.list({ name: 1 as never })).rejects.toThrow('name')
    await expect(f.api.list({ organizationId: 0 })).rejects.toThrow('organizationId')
    await expect(f.api.list({ ledgerIds: [1, 0] })).rejects.toThrow('ledgerIds[1]')
    await expect(f.api.list({ ledgerIds: 1 as never })).rejects.toThrow('ledgerIds必须为ID数组')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
  })

  it('导出只发送转换后的四个表单字段，保留服务端动态文件名和二进制内容', async () => {
    const f = fixture([fileResponse])
    await expect(f.api.export({ name: '张三', year: '2025', organizationId: 9, ledgerIds: [11, 12] })).resolves.toMatchObject({ fileName: '【2026】【岗位工资统计表】.xlsx', contentType: 'application/vnd.ms-excel;charset=utf-8', byteLength: 3, base64: 'AQID' })
    expect(f.calls[0]).toEqual({
      url: '/salary/report/exportPostSalaryStatistics', method: 'get',
      params: { name: '张三', year: '2025', organizationName: 9, ledgerIds: '11,12' }, responseType: 'arraybuffer',
    })
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖页面字段、当前页合计边界、组织/账套权限语义和导出差异', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_POST_SALARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['reportPostSalary.list', 'reportPostSalary.export'])
    expect(contracts['report-post-salary-list']?.output.fields.some(item => item.path === 'list[].basicSalary1')).toBe(true)
    expect(contracts['report-post-salary-list']?.output.fields.some(item => item.path === 'list[].profitAssessmentSalary12')).toBe(true)
    expect(contracts['report-post-salary-list']?.boundaries.join('\n')).toContain('当前页')
    expect(contracts['report-post-salary-list']?.inputs.ledgerIds?.omitted).toContain('全部网页账套')
    expect(contracts['report-post-salary-export']?.gaps?.join('\n')).toContain('organizationName')
    expect(contracts['report-post-salary-export']?.output.fields.some(item => item.path === 'fileName')).toBe(true)
  })
})
