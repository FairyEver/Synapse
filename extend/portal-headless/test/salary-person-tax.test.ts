import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { SALARY_PERSON_TAX_AI_CONTRACTS as contracts, SALARY_PERSON_TAX_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-salary-person-tax.js'
import { createSalaryPersonTaxCapability, SALARY_PERSON_TAX_METHODS, SALARY_PERSON_TAX_PAGE_PATH, salaryPersonTaxCapabilities } from '../src/capabilities/salary-person-tax.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryPersonTaxCapability(request), calls }
}

const specialList = Array.from({ length: 7 }, (_, index) => ({
  id: index + 201,
  taxId: 101,
  specialType: String(index + 1),
  amount: index === 0 ? '2000.00' : null,
  costStart: '2026-08-01',
  costEnd: '2026-08-31',
  archiveStatus: 1,
}))

const row = {
  id: 101,
  staffCode: 9001,
  staffName: '张三',
  idCard: 'masked',
  organizationName: '总部/财务',
  postName: '会计',
  archiveStatus: 1,
  createTime: '2026-09-01 10:00:00',
  updaterName: '管理员',
  costDate: '2026-08',
  specialList,
  extra: 'preserve',
}

const pageResponse = {
  total: {
    childEducation: '2000.00',
    housingRent: 0,
    housingLoanInterest: 0,
    elderlyCare: 0,
    continuingEducation: 0,
    infantCare: 0,
    sickChildEducation: 0,
  },
  list: { list: [row], total: 1 },
}

const form = {
  id: 101,
  staffCode: '9001',
  staffName: '张三',
  idCard: 'masked',
  archiveStatus: 1 as const,
  costDate: '2026-08',
  specialList: Array.from({ length: 7 }, (_, index) => ({
    specialType: String(index + 1),
    amount: index === 0 ? 2000 : '',
    costTime: ['2026-08-03', '2026-08-20'],
    archiveStatus: 1 as const,
  })),
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment;filename*=UTF-8''%E4%B8%AA%E7%A8%8E%E4%B8%93%E9%A1%B9%E6%89%A3%E6%AC%BE.xls" },
}

const eligibility = {
  processedIds: [201],
  processedStaffCodes: [9001],
  processedCount: 1,
  eligibleStaffIds: [3001],
  eligibleStaffCodes: [9001],
  excludedStaffList: [{ staffId: 3002, staffCode: 9002, staffName: '李四', businessDate: '2026-08-01', reasonCode: 'NOT_ELIGIBLE', reason: '不符合资格' }],
}

describe('Portal 薪资 → 个税专项扣款 → 扣款费用页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和可达动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${SALARY_PERSON_TAX_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/salary/person-tax'")
    expect(salaryPersonTaxCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_PERSON_TAX_METHODS))
    expect(salaryPersonTaxCapabilities.every(item => item.pagePath === SALARY_PERSON_TAX_PAGE_PATH && item.permission === '/dashboard/salary/person-tax' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_PERSON_TAX_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal列表、详情、人员选择器、导入组件和Java Controller/DTO/Service/Mapper/Excel证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const list = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/list.vue`, 'utf8')
    const formPage = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/[mode]/[id].vue`, 'utf8')
    const staffSelect = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/components/staff-select.vue`, 'utf8')
    const importComponent = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/components/create-multiple.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryPersonTaxController.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxDTO.java`, 'utf8')
    const selectDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxSelectDTO.java`, 'utf8')
    const totalDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxTotalDTO.java`, 'utf8')
    const specialDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxSpecialDTO.java`, 'utf8')
    const service = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryPersonTaxServiceImpl.java`, 'utf8')
    const mapper = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/salary/SalaryPersonTaxDao.xml`, 'utf8')
    const templateExcel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryPersonTaxTemplateExcel.java`, 'utf8')
    const exportExcel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryPersonTaxExcel.java`, 'utf8')

    expect(list).toContain("/salary/salarypersontax/pageNew")
    expect(list).toContain("order: 'desc', orderField: 'id'")
    expect(list).toContain("costDateStart: form.costDate.length ? form.costDate[0].format('YYYY-MM') : ''")
    expect(list).toContain("costDateEnd: form.costDate.length ? form.costDate[1].format('YYYY-MM') : ''")
    expect(list).toContain("deleteURL: '/salary/salarypersontax'")
    expect(list).toContain("{ ids: idList, status: 2 }")
    expect(formPage).toContain("/salary/salarypersontax/${id}")
    expect(formPage).toContain("dayjs(item.costTime[0], 'YYYY-MM-DD').startOf('month')")
    expect(formPage).toContain("dayjs(item.costTime[1], 'YYYY-MM-DD').endOf('month')")
    expect(formPage).toContain("http.put('/salary/salarypersontax', submitData)")
    expect(staffSelect).toContain("/salary/staff-eligibility/check")
    expect(list).toContain("contentProps: {\n      type: 2\n    }")
    expect(importComponent).toContain("'/salary/salarypersontax/import'")
    expect(controller).toContain('@RequestMapping("/salary/salarypersontax")')
    for (const fragment of ['@GetMapping("pageNew")', '@GetMapping("filingPageNew")', '@GetMapping("{id}")', '@PutMapping', '@DeleteMapping', '@GetMapping("download")', '@PostMapping("import")', '@GetMapping("export")', '@PostMapping("updateArchive")']) expect(controller).toContain(fragment)
    for (const field of ['staffCode', 'staffName', 'idCard', 'organizationName', 'postName', 'archiveStatus', 'costDate', 'specialList']) expect(resultDto).toContain(field)
    for (const field of ['staffCode', 'name', 'archiveStatus', 'costDateStart', 'costDateEnd', 'orgId', 'pageNo', 'pageSize']) expect(selectDto).toContain(field)
    for (const field of ['childEducation', 'housingRent', 'housingLoanInterest', 'elderlyCare', 'continuingEducation', 'infantCare', 'sickChildEducation']) expect(totalDto).toContain(field)
    for (const field of ['specialType', 'amount', 'costStart', 'costEnd', 'archiveStatus']) expect(specialDto).toContain(field)
    for (const fragment of ['getSearchListNew', 'taxSave', 'UpdateInfo', 'implodeData', 'updateArchiveStatus', 'filterEligibleSpecialItems']) expect(service).toContain(fragment)
    for (const fragment of ['getSearchListNew', 'archive_status', 'cost_start', 'updateArchiveStatus']) expect(mapper).toContain(fragment)
    for (const field of ['子女教育', '住房租金', '住房贷款利息', '赡养老人', '继续教育', '婴幼儿照护', '大病医疗', '归属月份']) {
      expect(templateExcel).toContain(field)
      expect(exportExcel).toContain(field)
    }
  })

  it('严格复现pageNew默认筛选、月份筛选、嵌套分页和合计', async () => {
    const f = fixture([pageResponse])
    await expect(f.api.list()).resolves.toMatchObject({ list: [row], total: 1, summary: pageResponse.total })
    expect(f.calls[0]).toEqual({
      url: '/salary/salarypersontax/pageNew',
      method: 'get',
      params: { name: '', staffCode: '', idCard: '', archiveStatus: 1, orgId: '', pageNo: 1, pageSize: 20, costDateStart: '', costDateEnd: '', order: 'desc', orderField: 'id' },
    })

    const ranged = fixture([{ ...pageResponse, list: { list: [], total: 0 } }])
    await ranged.api.list({ name: '张', staffCode: '9001', idCard: 'masked', archiveStatus: 2, orgId: 9, costDate: ['2026-08', '2026-09'], pageNo: 2, pageSize: 50 })
    expect(ranged.calls[0]?.params).toEqual({ name: '张', staffCode: '9001', idCard: 'masked', archiveStatus: 2, orgId: 9, pageNo: 2, pageSize: 50, costDateStart: '2026-08', costDateEnd: '2026-09', order: 'desc', orderField: 'id' })
  })

  it('严格复现详情回填和PUT月份首末日提交', async () => {
    const f = fixture([row, undefined])
    const detail = await f.api.get({ id: 101 })
    expect(detail.staffCode).toBe('9001')
    expect(detail.costDate).toBe('2026-08')
    expect(detail.specialList[0]).toMatchObject({ specialType: '1', costTime: ['2026-08-01', '2026-08-31'], archiveStatus: 1 })
    expect(detail.specialList[0]).not.toHaveProperty('costStart')
    expect(detail.specialList[0]).not.toHaveProperty('costEnd')
    expect(f.calls[0]).toEqual({ url: '/salary/salarypersontax/101', method: 'get' })

    const draft = f.api.prepareUpdate(form)
    expect(draft.draft).toMatchObject({ id: 101, staffCode: '9001', archiveStatus: 1, costDate: '2026-08' })
    expect(draft.draft.specialList).toEqual(expect.arrayContaining([
      expect.objectContaining({ specialType: '1', amount: 2000, costStart: '2026-08-01', costEnd: '2026-08-31', archiveStatus: 1 }),
      expect.objectContaining({ specialType: '2', amount: '', costStart: '2026-08-01', costEnd: '2026-08-31' }),
    ]))
    await f.api.update(form)
    expect(f.calls[1]).toMatchObject({ url: '/salary/salarypersontax', method: 'put' })
    expect(f.calls[1]?.data).toMatchObject({ id: 101, staffCode: '9001', archiveStatus: 1, specialList: draft.draft.specialList })
  })

  it('严格复现删除、导入、模板下载、导出和归档', async () => {
    const f = fixture([undefined, eligibility, fileResponse, fileResponse, eligibility])
    expect(f.api.prepareRemove({ ids: [101, '102'] })).toEqual({ draft: [101, '102'] })
    await f.api.remove({ ids: [101, '102'] })
    expect(f.calls[0]).toEqual({ url: '/salary/salarypersontax', method: 'delete', data: [101, '102'] })

    const base64 = Buffer.from('xlsx').toString('base64')
    expect(f.api.prepareImport({ fileName: '扣款费用.xlsx', base64 })).toEqual({ fileName: '扣款费用.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await expect(f.api.importExcel({ fileName: '扣款费用.xlsx', base64 })).resolves.toEqual(eligibility)
    expect(f.calls[1]?.url).toBe('/salary/salarypersontax/import')
    expect(f.calls[1]?.data).toBeInstanceOf(FormData)

    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '个税专项扣款.xls', base64: 'AQID', byteLength: 3 })
    expect(f.calls[2]).toEqual({ url: '/salary/salarypersontax/download', method: 'get', params: { fileName: '个税专项扣款归档导入模板' }, responseType: 'arraybuffer' })
    await expect(f.api.export({ ids: [101, '102'] })).resolves.toMatchObject({ fileName: '个税专项扣款.xls', base64: 'AQID', byteLength: 3 })
    expect(f.calls[3]).toEqual({ url: '/salary/salarypersontax/export', method: 'get', params: { idList: '101,102' }, responseType: 'arraybuffer' })

    expect(f.api.prepareArchive({ ids: [101] })).toEqual({ draft: { ids: [101], status: 2 } })
    await expect(f.api.archive({ ids: [101] })).resolves.toEqual(eligibility)
    expect(f.calls[4]).toEqual({ url: '/salary/salarypersontax/updateArchive', method: 'post', data: { ids: [101], status: 2 } })
  })

  it('资格检查保留Portal请求体和后端分类回执', async () => {
    const f = fixture([eligibility])
    await expect(f.api.eligibilityCheck({ staffCodes: [9001, '9002'], businessDate: '2026-08-01' })).resolves.toEqual(eligibility)
    expect(f.calls[0]).toEqual({ url: '/salary/staff-eligibility/check', method: 'post', data: { staffCodes: [9001, '9002'], businessDate: '2026-08-01' } })
  })

  it('坏参数、坏响应和AI说明缺口不会静默通过', async () => {
    await expect(fixture([pageResponse]).api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(fixture([pageResponse]).api.list({ costDate: ['2026-13', '2026-09'] })).rejects.toThrow('YYYY-MM')
    await expect(fixture([pageResponse]).api.list({ archiveStatus: 3 as never })).rejects.toThrow('archiveStatus')
    await expect(fixture([{ total: pageResponse.total, list: { list: null, total: 0 } }]).api.list()).rejects.toThrow('有效list')
    expect(() => fixture([row]).api.prepareUpdate({ ...form, id: undefined as never })).toThrow('id')
    expect(() => fixture([row]).api.prepareUpdate({ ...form, specialList: form.specialList.slice(0, 6) })).toThrow('7个专项')
    expect(() => fixture([row]).api.prepareImport({ fileName: '扣款费用.xls', base64: 'eA==' })).toThrow('.xlsx')
    await expect(fixture([undefined]).api.remove({ ids: [101, 101] })).rejects.toThrow('重复ID')
    await expect(fixture([eligibility]).api.archive({ ids: [] })).rejects.toThrow('不能为空')
    await expect(fixture([fileResponse]).api.export({ ids: [101, 101] })).rejects.toThrow('重复ID')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_PERSON_TAX_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(SALARY_PERSON_TAX_METHODS).map(method => `salaryPersonTax.${method}`))
    expect(contracts['salary-person-tax-list']?.output.fields.some(item => item.path === 'summary.childEducation')).toBe(true)
    expect(contracts['salary-person-tax-update']?.boundaries.some(item => item.includes('costTime'))).toBe(true)
    expect(contracts['salary-person-tax-import']?.output.fields.some(item => item.path === 'excludedStaffList[].reason')).toBe(true)
    expect(contracts['salary-person-tax-archive']?.output.fields.some(item => item.path === 'processedCount')).toBe(true)
  })
})
