import { describe, expect, it } from 'vitest'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { SALARY_PERSON_TAX_HANDLE_AI_CONTRACTS as contracts, SALARY_PERSON_TAX_HANDLE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-salary-person-tax-handle.js'
import { createSalaryPersonTaxHandleCapability, SALARY_PERSON_TAX_HANDLE_METHODS, SALARY_PERSON_TAX_HANDLE_PAGE_PATH, salaryPersonTaxHandleCapabilities } from '../src/capabilities/salary-person-tax-handle.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryPersonTaxHandleCapability(request), calls }
}

const specialList = Array.from({ length: 7 }, (_, index) => ({
  id: index + 201,
  taxId: 101,
  specialType: String(index + 1),
  amount: index === 0 ? '2000.00' : null,
  costStart: index === 0 ? '2026-08-01' : null,
  costEnd: index === 0 ? '2026-09-30' : null,
}))

const row = {
  id: 101,
  staffCode: 9001,
  staffName: '张三',
  idCard: 'masked',
  organizationName: '总部/财务',
  postName: '会计',
  status: 1,
  isDel: 0,
  creator: 1,
  createTime: '2026-09-01 10:00:00',
  updater: 2,
  updaterName: '管理员',
  updateTime: '2026-09-02 10:00:00',
  specialList,
  extra: 'preserve',
}

const form = {
  id: 101,
  staffCode: '9001',
  staffName: '张三',
  idCard: 'masked',
  status: 1 as const,
  specialList: Array.from({ length: 7 }, (_, index) => ({
    specialType: String(index + 1),
    amount: index === 0 ? 2000 : '',
    costTime: index === 0 ? ['2026-08-03', '2026-09-20'] : [],
  })),
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'content-disposition': "attachment;filename*=UTF-8''%E4%B8%AA%E7%A8%8E%E4%B8%93%E9%A1%B9%E6%89%A3%E6%AC%BE.xlsx" },
}

const eligibility = {
  processedIds: [201],
  processedStaffCodes: [9001],
  processedCount: 1,
  eligibleStaffIds: [3001],
  eligibleStaffCodes: [9001],
  excludedStaffList: [{ staffId: 3002, staffCode: 9002, staffName: '李四', businessDate: '2026-09-24', reasonCode: 'NOT_ELIGIBLE', reason: '不符合资格' }],
}

describe('Portal 薪资 → 个税专项扣款 → 扣款办理页面能力', () => {
  it('锁定菜单、权限、platform实例、module-type和可达动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(`${portalRoot}/app/portal/menus/hr.js`, 'utf8')
    expect(menu).toContain(`path: '${SALARY_PERSON_TAX_HANDLE_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/salary/person-tax-handle'")
    expect(salaryPersonTaxHandleCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_PERSON_TAX_HANDLE_METHODS))
    expect(salaryPersonTaxHandleCapabilities.every(item => item.pagePath === SALARY_PERSON_TAX_HANDLE_PAGE_PATH && item.permission === '/dashboard/salary/person-tax-handle' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_PERSON_TAX_HANDLE_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐字段锁定Portal列表、详情、人员选择器、导入组件和Java Controller/DTO/Excel证据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const list = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax-handle/list.vue`, 'utf8')
    const formPage = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax-handle/[mode]/[id].vue`, 'utf8')
    const staffSelect = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/components/staff-select.vue`, 'utf8')
    const importComponent = readFileSync(`${portalRoot}/app/portal/views/dashboard/hr/salary/person-tax/components/create-multiple.vue`, 'utf8')
    const controller = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryPersonTaxForecastController.java`, 'utf8')
    const resultDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxForecastDTO.java`, 'utf8')
    const specialDto = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryPersonTaxSpecialForecastDTO.java`, 'utf8')
    const templateExcel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryPersonTaxForecastTemplateExcel.java`, 'utf8')
    const exportExcel = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryPersonTaxForecastExcel.java`, 'utf8')
    const eligibilityController = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/HrStaffSalaryEligibilityController.java`, 'utf8')
    const eligibilityRequest = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/dto/HrStaffSalaryEligibilityCheckReqDTO.java`, 'utf8')
    const eligibilityResult = readFileSync(`${javaRoot}/erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/dto/HrStaffSalaryEligibilityResultDTO.java`, 'utf8')

    expect(list).toContain("/salary/salarypersontaxForecast/page")
    expect(list).toContain("deleteURL: '/salary/salarypersontaxForecast'")
    expect(list).toContain("idList: rrList.selectState.join(',')")
    expect(formPage).toContain("/salary/salarypersontaxForecast/${id}")
    expect(formPage).toContain("dayjs(item.costTime[0], 'YYYY-MM-DD').startOf('month')")
    expect(formPage).toContain("dayjs(item.costTime[1], 'YYYY-MM-DD').endOf('month')")
    expect(formPage).toContain("http.post('/salary/salarypersontaxForecast', submitData)")
    expect(formPage).toContain("http.put('/salary/salarypersontaxForecast', submitData)")
    expect(staffSelect).toContain("/org/staff/allStaffByPage")
    expect(staffSelect).toContain("/salary/staff-eligibility/check")
    expect(importComponent).toContain("file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'")
    expect(importComponent).toContain("'/salary/salarypersontaxForecast/import'")
    expect(controller).toContain('@RequestMapping("/salary/salarypersontaxForecast")')
    for (const fragment of ['@GetMapping("page")', '@GetMapping("{id}")', '@PostMapping', '@PutMapping', '@DeleteMapping', '@GetMapping("download")', '@PostMapping("import")', '@GetMapping("export")']) expect(controller).toContain(fragment)
    for (const field of ['staffCode', 'staffName', 'idCard', 'organizationName', 'postName', 'status', 'specialList']) expect(resultDto).toContain(field)
    for (const field of ['specialType', 'amount', 'costStart', 'costEnd']) expect(specialDto).toContain(field)
    for (const field of ['子女教育', '住房租金', '住房贷款利息', '赡养老人', '继续教育', '婴幼儿照护', '大病医疗']) {
      expect(templateExcel).toContain(field)
      expect(exportExcel).toContain(field)
    }
    expect(eligibilityController).toContain('@RequestMapping("/salary/staff-eligibility")')
    expect(eligibilityController).toContain('@PostMapping("check")')
    expect(eligibilityRequest).toContain('List<Long> staffCodes')
    expect(eligibilityRequest).toContain('LocalDate businessDate')
    for (const field of ['processedIds', 'processedStaffCodes', 'processedCount', 'eligibleStaffIds', 'eligibleStaffCodes', 'excludedStaffList']) expect(eligibilityResult).toContain(field)
  })

  it('严格复现列表默认筛选、分页和逐字段回执', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list()).resolves.toMatchObject({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/salary/salarypersontaxForecast/page',
      method: 'get',
      params: { order: '', orderField: '', name: '', staffCode: '', idCard: '', pageNo: 1, pageSize: 20 },
    })

    const ranged = fixture([{ list: [], total: 0 }])
    await ranged.api.list({ name: '张', staffCode: '9001', idCard: 'masked', order: 'desc', orderField: 'updateTime', pageNo: 2, pageSize: 50 })
    expect(ranged.calls[0]?.params).toEqual({ order: 'desc', orderField: 'updateTime', name: '张', staffCode: '9001', idCard: 'masked', pageNo: 2, pageSize: 50 })
  })

  it('严格复现详情回填、月份首末日提交、创建和修改路径', async () => {
    const f = fixture([row, undefined, undefined])
    const detail = await f.api.get({ id: 101 })
    expect(detail.staffCode).toBe('9001')
    expect(detail.specialList[0]).toMatchObject({ specialType: '1', costTime: ['2026-08-01', '2026-09-30'] })
    expect(detail.specialList[0]).not.toHaveProperty('costStart')
    expect(detail.specialList[0]).not.toHaveProperty('costEnd')
    expect(f.calls[0]).toEqual({ url: '/salary/salarypersontaxForecast/101', method: 'get' })

    const draft = f.api.prepareUpdate(form)
    expect(draft.draft).toMatchObject({ id: 101, staffCode: '9001', status: 1 })
    expect(draft.draft.specialList).toEqual(expect.arrayContaining([
      expect.objectContaining({ specialType: '1', amount: 2000, costStart: '2026-08-01', costEnd: '2026-09-30' }),
      expect.objectContaining({ specialType: '2', amount: '', costStart: null, costEnd: null }),
    ]))
    await f.api.update(form)
    expect(f.calls[1]).toMatchObject({ url: '/salary/salarypersontaxForecast', method: 'put' })
    expect(f.calls[1]?.data).toMatchObject({ id: 101, staffCode: '9001', specialList: draft.draft.specialList })

    const createForm = { ...form, id: undefined }
    const create = fixture([undefined])
    expect(create.api.prepareCreate(createForm)).toMatchObject({ draft: expect.objectContaining({ staffCode: '9001', specialList: expect.any(Array) }) })
    await create.api.create(createForm)
    expect(create.calls[0]).toMatchObject({ url: '/salary/salarypersontaxForecast', method: 'post' })
    expect(create.calls[0]?.data).not.toHaveProperty('id')
  })

  it('严格复现批量删除、xlsx导入、模板下载和导出', async () => {
    const f = fixture([undefined, null, fileResponse, fileResponse])
    expect(f.api.prepareRemove({ ids: [101, '102'] })).toEqual({ draft: [101, '102'] })
    await f.api.remove({ ids: [101, '102'] })
    expect(f.calls[0]).toEqual({ url: '/salary/salarypersontaxForecast', method: 'delete', data: [101, '102'] })

    const base64 = Buffer.from('xlsx').toString('base64')
    expect(f.api.prepareImport({ fileName: '扣款办理.xlsx', base64 })).toEqual({ fileName: '扣款办理.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 4 })
    await expect(f.api.importExcel({ fileName: '扣款办理.xlsx', base64 })).resolves.toBeNull()
    expect(f.calls[1]?.url).toBe('/salary/salarypersontaxForecast/import')
    expect(f.calls[1]?.method).toBe('post')
    expect(f.calls[1]?.data).toBeInstanceOf(FormData)

    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '个税专项扣款.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[2]).toEqual({ url: '/salary/salarypersontaxForecast/download', method: 'get', params: { fileName: '个税专项扣款导入模板' }, responseType: 'arraybuffer' })
    await expect(f.api.export({ ids: [101, '102'] })).resolves.toMatchObject({ fileName: '个税专项扣款.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[3]).toEqual({ url: '/salary/salarypersontaxForecast/export', method: 'get', params: { idList: '101,102' }, responseType: 'arraybuffer' })
  })

  it('资格检查保留Portal请求体和后端分类回执', async () => {
    const f = fixture([eligibility])
    await expect(f.api.eligibilityCheck({ staffCodes: [9001, '9002'], businessDate: '2026-09-24' })).resolves.toEqual(eligibility)
    expect(f.calls[0]).toEqual({ url: '/salary/staff-eligibility/check', method: 'post', data: { staffCodes: [9001, '9002'], businessDate: '2026-09-24' } })
  })

  it('坏参数、坏响应和AI说明缺口不会静默通过', async () => {
    await expect(fixture([{ list: [], total: 0 }]).api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ staffCode: '0' })).rejects.toThrow('staffCode')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    expect(() => fixture([row]).api.prepareCreate({ ...form, id: 101 })).toThrow('不应提供id')
    expect(() => fixture([row]).api.prepareUpdate({ ...form, id: undefined })).toThrow('必须提供id')
    expect(() => fixture([undefined]).api.prepareCreate({ ...form, id: undefined, specialList: form.specialList.slice(0, 6) })).toThrow('7个专项')
    expect(() => fixture([undefined]).api.prepareCreate({ ...form, id: undefined, specialList: form.specialList.map((item, index) => index === 1 ? { ...item, specialType: '1' } : item) })).toThrow('不重复')
    expect(() => fixture([undefined]).api.prepareImport({ fileName: '扣款办理.xls', base64: 'eA==' })).toThrow('.xlsx')
    await expect(fixture([undefined]).api.remove({ ids: [101, 101] })).rejects.toThrow('重复ID')
    await expect(fixture([fileResponse]).api.export({ ids: [101, 101] })).rejects.toThrow('重复ID')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_PERSON_TAX_HANDLE_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(SALARY_PERSON_TAX_HANDLE_METHODS).map(method => `salaryPersonTaxHandle.${method}`))
    expect(contracts['salary-person-tax-handle-list']?.output.fields.some(item => item.path === 'list[].specialList[].amount')).toBe(true)
    expect(contracts['salary-person-tax-handle-create']?.boundaries.some(item => item.includes('costTime'))).toBe(true)
    expect(contracts['salary-person-tax-handle-import']?.output.shape).toBe('string | null')
    expect(contracts['salary-person-tax-handle-export']?.output.fields.some(item => item.path === 'base64')).toBe(true)
  })
})
