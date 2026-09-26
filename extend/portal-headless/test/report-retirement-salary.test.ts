import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportRetirementSalaryCapability,
  REPORT_RETIREMENT_SALARY_METHODS,
  REPORT_RETIREMENT_SALARY_PAGE_PATH,
  reportRetirementSalaryCapabilities,
} from '../src/capabilities/report-retirement-salary.js'
import {
  REPORT_RETIREMENT_SALARY_AI_CONTRACTS as contracts,
  REPORT_RETIREMENT_SALARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-retirement-salary.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportRetirementSalaryCapability(request), calls }
}

const row = {
  id: 101,
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationId: 9,
  organizationName: '总部/财务',
  enterpriseSalary: '100.00',
  actualAmount: '180.00',
  status: 0,
  remark: null,
}

const draft = {
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationId: 9,
  organizationName: '总部/财务',
  enterpriseSalary: 100,
  actualAmount: '180.00',
}

const summaryDraft = {
  organizationId: 9,
  organizationName: '总部/财务',
  useYearMonth: '2026-09',
  staffIdList: [101, '102'],
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment;filename*=UTF-8''%E9%80%80%E4%BC%91%E4%BA%BA%E5%91%98%E5%B7%A5%E8%B5%84%E6%A8%A1%E6%9D%BF.xlsx",
  },
}

describe('Portal 人力报表 → 退休人员工资发放表', () => {
  it('锁定菜单、权限、platform实例、module-type和动作集合', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary/list.vue'), 'utf8')
    const create = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary/ModalContentForCreate.vue'), 'utf8')
    const createSummary = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary/ModalContentForCreateSummary.vue'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_RETIREMENT_SALARY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/retirement-salary'")
    expect(page).toContain("getDataListURL: '/admin-api/hr/retire-staff-salary/page'")
    expect(page).toContain("deleteURL: '/admin-api/hr/retire-staff-salary/delete'")
    expect(page).toContain("input.accept = '.xml,.xlsx,.xls'")
    expect(page).toContain("/admin-api/hr/retire-staff-salary/import")
    expect(page).toContain("apiForCreate: '/admin-api/hr/retire-staff-salary-summary/create'")
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationId', 'enterpriseSalary', 'actualAmount']) expect(create).toContain(field)
    expect(create).toContain("http.post('/admin-api/hr/retire-staff-salary/create', submitData)")
    expect(create).toContain("http.put('/admin-api/hr/retire-staff-salary/update', submitData)")
    for (const field of ['organizationId', 'organizationName', 'useYearMonth', 'staffIdList']) expect(createSummary).toContain(field)
    expect(reportRetirementSalaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_RETIREMENT_SALARY_METHODS))
    expect(reportRetirementSalaryCapabilities.every(item => item.pagePath === REPORT_RETIREMENT_SALARY_PAGE_PATH && item.permission === '/dashboard/report/retirement-salary' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    const createParams = reportRetirementSalaryCapabilities.find(item => item.id === 'report-retirement-salary-create')?.params.map(item => item.name)
    expect(createParams).toEqual(expect.arrayContaining(['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', 'enterpriseSalary', 'heatingFee', 'holidayAllowance', 'additionalInsurance', 'subsidy', 'transportFee', 'bookFee', 'laborFee', 'laundryFee', 'medicineFee', 'otherFee', 'actualAmount']))
    expect(contracts['report-retirement-salary-prepare-create']?.inputs).not.toHaveProperty('draft')
    expect(contracts['report-retirement-salary-prepare-create']?.steps[0]?.mapping?.enterpriseSalary).toBe('result.draft.enterpriseSalary')
    expect(contracts['report-retirement-salary-prepare-update']?.steps[0]?.mapping?.id).toBe('result.draft.id')
    expect(resolveModuleType(REPORT_RETIREMENT_SALARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页核对Java Controller/VO/Service/导入字段和状态权限', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalary/RetireStaffSalaryController.java'), 'utf8')
    const saveVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalary/vo/RetireStaffSalarySaveReqVO.java'), 'utf8')
    const pageVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalary/vo/RetireStaffSalaryPageReqVO.java'), 'utf8')
    const importVo = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/retirestaffsalary/vo/RetireStaffSalaryImportVO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/retirestaffsalary/RetireStaffSalaryServiceImpl.java'), 'utf8')
    for (const fragment of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/get")', '@GetMapping("/page")', '@PostMapping("/import")']) expect(controller).toContain(fragment)
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', 'enterpriseSalary', 'actualAmount']) expect(saveVo).toContain(field)
    for (const field of ['name', 'idCard', 'organizationId', 'useYearMonth', 'status', 'roleOrganizationIdList']) expect(pageVo).toContain(field)
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationName', 'actualAmount']) expect(importVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'getStatus() == 1', 'importRetireStaffSalary', 'validOrgNames', 'insertBatch']) expect(service).toContain(fragment)
  })

  it('按Portal请求顺序发送列表、详情和表单载荷', async () => {
    const f = fixture([{ list: [row], total: 1 }, row, 9001, true, true, 9002])
    await expect(f.api.list({ name: '张', idCard: 'masked', organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/hr/retire-staff-salary/page', method: 'get', params: { order: '', orderField: '', name: '张', idCard: 'masked', organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/hr/retire-staff-salary/get', method: 'get', params: { id: 101 } })
    await expect(f.api.create(draft)).resolves.toBe(9001)
    expect(f.calls[2]).toEqual({ url: '/hr/retire-staff-salary/create', method: 'post', data: { ...draft, heatingFee: null, holidayAllowance: null, additionalInsurance: null, subsidy: null, transportFee: null, bookFee: null, laborFee: null, laundryFee: null, medicineFee: null, otherFee: null } })
    await expect(f.api.update({ ...draft, id: 101, status: 0, remark: '备注' })).resolves.toBe(true)
    expect(f.calls[3]).toEqual({ url: '/hr/retire-staff-salary/update', method: 'put', data: { ...draft, id: 101, status: 0, remark: '备注', heatingFee: null, holidayAllowance: null, additionalInsurance: null, subsidy: null, transportFee: null, bookFee: null, laborFee: null, laundryFee: null, medicineFee: null, otherFee: null } })
    await expect(f.api.remove({ id: 101, currentStatus: 0 })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/hr/retire-staff-salary/delete/101', method: 'delete' })
    await expect(f.api.createSummary(summaryDraft)).resolves.toBe(9002)
    expect(f.calls[5]).toEqual({ url: '/hr/retire-staff-salary-summary/create', method: 'post', data: summaryDraft })
  })

  it('导入使用Portal的multipart字段file，模板文件返回非空内存表示', async () => {
    const f = fixture([fileResponse, '导入成功'])
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '退休人员工资模板.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[0]).toEqual({ url: '/sys/oss/download', method: 'get', params: { fileName: '退休人员工资模板' }, responseType: 'arraybuffer' })
    expect(f.api.prepareImport({ fileName: '退休.xlsx', base64: 'AQID' })).toEqual({ fileName: '退休.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.importExcel({ fileName: '退休.xlsx', base64: 'AQID' })).resolves.toBe('导入成功')
    expect(f.calls[1]?.url).toBe('/hr/retire-staff-salary/import')
    expect(f.calls[1]?.method).toBe('post')
    expect(f.calls[1]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[1]?.data).toBeInstanceOf(FormData)
  })

  it('创建/删除权限门禁和坏参数不会静默成功', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await f.api.list()
    expect(f.calls[0]!.params).toEqual({ order: '', orderField: '', name: '', idCard: '', organizationId: '', useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
    expect(f.api.prepareCreate(draft).draft).toMatchObject({ useYearMonth: '2026-09', organizationId: 9, actualAmount: '180.00' })
    expect(f.api.prepareUpdate({ ...draft, id: 101 }).draft).toMatchObject({ id: 101 })
    expect(f.api.prepareRemove({ id: 101, currentStatus: 0 })).toEqual({ id: 101 })
    expect(() => f.api.prepareRemove({ id: 101, currentStatus: 1 })).toThrow('不允许删除')
    expect(() => f.api.prepareCreate({ ...draft, useYearMonth: '2026-13' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareCreate({ ...draft, name: '' })).toThrow('name')
    expect(() => f.api.prepareCreateSummary({ ...summaryDraft, staffIdList: [101, 101] })).toThrow('重复')
    expect(() => f.api.prepareImport({ fileName: 'bad.txt', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '退休.xlsx', base64: 'bad' })).toThrow('Base64')
    await expect(f.api.list({ status: 2 as never })).rejects.toThrow('0或1')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖表单提交、删除状态、导入和创建汇总副作用', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_RETIREMENT_SALARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_RETIREMENT_SALARY_METHODS).map(method => `reportRetirementSalary.${method}`))
    expect(contracts['report-retirement-salary-list']?.output.fields.some(item => item.path === 'list[].actualAmount')).toBe(true)
    expect(contracts['report-retirement-salary-remove']?.boundaries.join('\n')).toContain('status=1')
    expect(contracts['report-retirement-salary-import']?.steps.some(step => step.capabilityId === 'report-retirement-salary-list')).toBe(true)
    expect(contracts['report-retirement-salary-create-summary']?.gaps?.join('\n')).toContain('撤销')
  })
})
