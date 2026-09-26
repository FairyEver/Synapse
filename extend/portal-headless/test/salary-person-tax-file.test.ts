import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { SALARY_PERSON_TAX_FILE_AI_CONTRACTS as contracts, SALARY_PERSON_TAX_FILE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-salary-person-tax-file.js'
import { createSalaryPersonTaxFileCapability, SALARY_PERSON_TAX_FILE_METHODS, SALARY_PERSON_TAX_FILE_PAGE_PATH, salaryPersonTaxFileCapabilities } from '../src/capabilities/salary-person-tax-file.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryPersonTaxFileCapability(request), calls }
}

const row = {
  id: 101,
  staffCode: 9001,
  staffName: '张三',
  idCard: 'masked',
  organizationName: '总部/财务',
  postName: '会计',
  archiveStatus: 2,
  costDate: '2026-09',
  documentName: null,
  isUsed: '未使用',
  updaterName: '管理员',
  createTime: '2026-09-01 10:00:00',
  specialList: [{ id: 201, taxId: 101, specialType: '1', amount: '2000.00', costStart: '2026-09-01', costEnd: '2026-09-30', archiveStatus: 2 }],
  extra: 'preserve',
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': "attachment;filename*=UTF-8''%E4%B8%AA%E7%A8%8E%E4%B8%93%E9%A1%B9%E6%89%A3%E6%AC%BE.xls" },
}

const eligibility = {
  processedIds: [201],
  processedStaffCodes: [9001],
  processedCount: 1,
  eligibleStaffIds: [3001],
  eligibleStaffCodes: [9001],
  excludedStaffList: [],
}

describe('Portal 薪资 → 扣款归档查询页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和可达动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${SALARY_PERSON_TAX_FILE_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/salary/person-tax-file'")
    expect(salaryPersonTaxFileCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_PERSON_TAX_FILE_METHODS))
    expect(salaryPersonTaxFileCapabilities.every(item => item.pagePath === SALARY_PERSON_TAX_FILE_PAGE_PATH && item.permission === '/dashboard/salary/person-tax-file' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_PERSON_TAX_FILE_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal页面和Java Controller/DTO/Service/Mapper证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const source = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax-file/list.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryPersonTaxController.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxFilingDTO.java`, 'utf8')
    const specialDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxSpecialDTO.java`, 'utf8')
    const selectDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxSelectDTO.java`, 'utf8')
    const service = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryPersonTaxServiceImpl.java`, 'utf8')
    const mapper = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryPersonTaxDao.xml`, 'utf8')
    expect(source).toContain("/salary/salarypersontax/filingPageNew")
    expect(source).toContain("costDateStart: form.costDate.length ? form.costDate[0] : ''")
    expect(source).toContain("costDateEnd: form.costDate.length ? form.costDate[1] : ''")
    expect(source).toContain("getRoleOrganizationTreeNew")
    expect(source).toContain("salary/salarypersontax/filingExport")
    expect(source).toContain("{ ids: idList, status: 1 }")
    expect(controller).toContain('@GetMapping("filingPageNew")')
    expect(controller).toContain('@GetMapping("filingExport")')
    expect(controller).toContain('@PostMapping("updateArchive")')
    for (const field of ['staffCode', 'name', 'orgId', 'archiveStatus', 'costDateStart', 'costDateEnd', 'isUsed', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['staffName', 'organizationName', 'archiveStatus', 'costDate', 'documentName', 'isUsed', 'specialList']) expect(resultDto).toContain(field)
    for (const field of ['specialType', 'amount', 'costStart', 'costEnd', 'archiveStatus']) expect(specialDto).toContain(field)
    for (const fragment of ['filingPageNew', 'getDescendantByAncestor', 'updateArchiveStatus', 'getProcessedIds', 'getExcludedStaffList']) expect(service).toContain(fragment)
    for (const fragment of ['filingPageNew', 'document_name', 'isUsed', 'archive_status']) expect(mapper).toContain(fragment)
  })

  it('严格复现归档页默认筛选、月份投影、组织和分页参数', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toMatchObject({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/salarypersontax/filingPageNew',
      method: 'get',
      params: { name: '', isUsed: '', orgId: '', archiveStatus: 2, pageNo: 1, pageSize: 20, costDateStart: '', costDateEnd: '', order: 'desc', orderField: 'id' },
    })

    const ranged = fixture([{ list: [], total: 0 }])
    await ranged.api.list({ name: '张', isUsed: 1, orgId: 9, costDate: ['2026-08', '2026-09'], pageNo: 2, pageSize: 50 })
    expect(ranged.calls[0]?.params).toEqual({ name: '张', isUsed: 1, orgId: 9, archiveStatus: 2, pageNo: 2, pageSize: 50, costDateStart: '2026-08', costDateEnd: '2026-09', order: 'desc', orderField: 'id' })
  })

  it('组织树、取消归档准备和资格回执严格保留', async () => {
    const f = fixture([[{ id: 9, name: '总部', children: [{ id: 10, name: '财务' }] }], eligibility])
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 9, name: '总部', children: [{ id: 10, name: '财务', children: [] }] }])
    expect(f.api.prepareUnarchive({ ids: [101] })).toEqual({ draft: { ids: [101], status: 1 } })
    await expect(f.api.unarchive({ ids: [101] })).resolves.toEqual(eligibility)
    expect(f.calls[1]).toEqual({ url: '/salary/salarypersontax/updateArchive', method: 'post', data: { ids: [101], status: 1 } })
  })

  it('导出只发送选中ID并保留二进制文件信息', async () => {
    const f = fixture([fileResponse])
    await expect(f.api.export({ ids: [101, '102'] })).resolves.toMatchObject({ fileName: '个税专项扣款.xls', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    expect(f.calls[0]).toEqual({ url: '/salary/salarypersontax/filingExport', method: 'get', params: { idList: '101,102' }, responseType: 'arraybuffer' })
  })

  it('坏参数、坏响应和契约缺口不会静默通过', async () => {
    await expect(fixture([{ list: [], total: 0 }]).api.list({ costDate: ['2026-13', '2026-09'] })).rejects.toThrow('YYYY-MM')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ isUsed: 2 as never })).rejects.toThrow('isUsed')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([eligibility]).api.unarchive({ ids: [] })).rejects.toThrow('ids不能为空')
    await expect(fixture([eligibility]).api.unarchive({ ids: [101, 101] })).rejects.toThrow('重复ID')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_PERSON_TAX_FILE_METHODS))
    expect(Object.keys(methodContracts)).toEqual(['salaryPersonTaxFile.list', 'salaryPersonTaxFile.organizationTree', 'salaryPersonTaxFile.prepareUnarchive', 'salaryPersonTaxFile.unarchive', 'salaryPersonTaxFile.export'])
    expect(contracts['salary-person-tax-file-list']?.output.fields.some(item => item.path === 'list[].specialList[].amount')).toBe(true)
    expect(contracts['salary-person-tax-file-unarchive']?.output.fields.some(item => item.path === 'excludedStaffList[].reason')).toBe(true)
    expect(contracts['salary-person-tax-file-export']?.output.fields.some(item => item.path === 'base64')).toBe(true)
  })
})
