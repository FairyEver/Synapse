import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createReportTemporarySalaryCapability,
  REPORT_TEMPORARY_SALARY_METHODS,
  REPORT_TEMPORARY_SALARY_PAGE_PATH,
  reportTemporarySalaryCapabilities,
} from '../src/capabilities/report-temporary-salary.js'
import {
  REPORT_TEMPORARY_SALARY_AI_CONTRACTS as contracts,
  REPORT_TEMPORARY_SALARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-temporary-salary.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportTemporarySalaryCapability(request), calls }
}

const row = {
  id: 101,
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationId: 9,
  organizationName: '总部/财务',
  entryDate: '2026-08-01',
  bankAccount: 'MASKED123',
  openingBank: '示例银行',
  attendanceDays: '20.00',
  dailyValue: '100.00',
  attendanceSalary: '2000.00',
  otherSalary: '0.00',
  grossSalary: '2000.00',
  individualIncomeTax: '20.00',
  netSalary: '1980.00',
  status: 0,
  createTime: '2026-09-01 10:00:00',
  extra: 'preserved',
}

const draft = {
  useYearMonth: '2026-09',
  name: '张三',
  idCard: 'masked',
  organizationId: 9,
  organizationName: '总部/财务',
  entryDate: '2026-08-01',
  bankAccount: 'MASKED123',
  openingBank: '示例银行',
  attendanceDays: '20.00',
  dailyValue: 100,
  attendanceSalary: 2000,
  otherSalary: '0.00',
  grossSalary: '2000.00',
  individualIncomeTax: 20,
  netSalary: '1980.00',
}

const summaryDraft = {
  organizationId: 9,
  organizationName: '财务部',
  useYearMonth: '2026-09',
  staffIdList: [101, '102'],
}

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment;filename*=UTF-8''%E4%B8%B4%E6%97%B6%E5%B7%A5%E5%B7%A5%E8%B5%84%E6%A8%A1%E6%9D%BF.xlsx",
  },
}

describe('Portal 人力报表 → 临时工工资发放表', () => {
  it('锁定菜单、权限、platform实例、module-type和全部页面动作', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary/list.vue'), 'utf8')
    const create = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/temporary-salary/ModalContentForCreate.vue'), 'utf8')
    const createSummary = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/report/retirement-salary/ModalContentForCreateSummary.vue'), 'utf8')
    const listModule = readFileSync(join(portalRoot, 'common/libs/renren/list.js'), 'utf8')
    expect(menu).toContain(`path: '${REPORT_TEMPORARY_SALARY_PAGE_PATH}'`)
    expect(menu).toContain("permission: '/dashboard/report/temporary-salary'")
    expect(page).toContain("getDataListURL: '/admin-api/hr/temporary-worker-salary/page'")
    expect(page).toContain("deleteURL: '/admin-api/hr/temporary-worker-salary/delete'")
    expect(page).toContain("input.accept = '.xml,.xlsx,.xls'")
    expect(page).toContain("/admin-api/hr/temporary-worker-salary/import")
    expect(page).toContain("fileName: '临时工工资模板'")
    expect(page).toContain("apiForCreate: '/admin-api/hr/temporary-worker-salary-summary/create'")
    expect(listModule).toContain('`${deleteURL}/${id}`')
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationId', 'entryDate', 'bankAccount', 'openingBank', 'attendanceDays', 'dailyValue', 'attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary']) expect(create).toContain(field)
    for (const fragment of ["http.get('/admin-api/hr/temporary-worker-salary/get'", "http.post('/admin-api/hr/temporary-worker-salary/create', submitData)", "http.put('/admin-api/hr/temporary-worker-salary/update', submitData)", "useYearMonth: formState.value.useYearMonth.format('YYYY-MM')", "entryDate: formState.value.entryDate ? formState.value.entryDate.format('YYYY-MM-DD') : null", 'status: null', "remark: ''"]) expect(create).toContain(fragment)
    for (const field of ['organizationId', 'organizationName', 'salaryMonth', 'userList', 'staffIdList']) expect(createSummary).toContain(field)
    expect(reportTemporarySalaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_TEMPORARY_SALARY_METHODS))
    expect(reportTemporarySalaryCapabilities.every(item => item.pagePath === REPORT_TEMPORARY_SALARY_PAGE_PATH && item.permission === '/dashboard/report/temporary-salary' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(REPORT_TEMPORARY_SALARY_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页核对Java Controller/VO/Service/Mapper、表单校验和权限差异', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz')
    const controller = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/TemporaryWorkerSalaryController.java'), 'utf8')
    const saveVo = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/vo/TemporaryWorkerSalarySaveReqVO.java'), 'utf8')
    const pageVo = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/vo/TemporaryWorkerSalaryPageReqVO.java'), 'utf8')
    const responseVo = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/vo/TemporaryWorkerSalaryRespVO.java'), 'utf8')
    const importVo = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/controller/admin/temporaryworkersalary/vo/TemporaryWorkerSalaryImportVO.java'), 'utf8')
    const service = readFileSync(join(root, 'src/main/java/com/wdbc/erp/module/hr/service/temporaryworkersalary/TemporaryWorkerSalaryServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(root, 'src/main/resources/mapper/temporaryworkersalary/TemporaryWorkerSalaryMapper.xml'), 'utf8')
    for (const fragment of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/get")', '@GetMapping("/page")', '@PostMapping("/import")', 'TemporaryWorkerSalarySaveReqVO', 'TemporaryWorkerSalaryPageReqVO']) expect(controller).toContain(fragment)
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', 'entryDate', 'bankAccount', 'openingBank', 'attendanceDays', 'dailyValue', 'attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary', 'status']) expect(saveVo).toContain(field)
    for (const field of ['@NotEmpty', '@Pattern', '@NotNull', '@Digits', 'roleOrganizationIdList', 'useYearMonth', 'organizationId', 'status']) expect(saveVo + pageVo).toContain(field)
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationId', 'organizationName', 'entryDate', 'bankAccount', 'openingBank', 'attendanceDays', 'dailyValue', 'attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary', 'status', 'createTime']) expect(responseVo).toContain(field)
    for (const field of ['useYearMonth', 'name', 'idCard', 'organizationName', 'entryDate', 'bankAccount', 'openingBank', 'attendanceDays', 'dailyValue', 'attendanceSalary', 'otherSalary', 'grossSalary', 'individualIncomeTax', 'netSalary']) expect(importVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'setRoleOrganizationIdList', 'validateAndFillOrganization', 'hasChild', 'temporaryWorkerSalaryMapper.insert', 'temporaryWorkerSalary.setStatus(0)', 'getStatus() == 1', 'validOrgNames', 'parentOrgIds', 'insertBatch', 'temporaryWorkerStaffByPage']) expect(service).toContain(fragment)
    for (const fragment of ['temporaryWorkerStaffByPage', 'hr_temporary_worker_salary', 'temporary_worker_staff_salary_summary_id', 'pageReqVO.name', 'group by t1.id']) expect(mapper).toContain(fragment)
  })

  it('按Portal顺序发送列表、详情和表单写入载荷', async () => {
    const f = fixture([{ list: [row], total: 1 }, row, 9001, true, true, fileResponse, '导入成功', [9002, 9003]])
    await expect(f.api.list({ name: '张', idCard: 'masked', organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/hr/temporary-worker-salary/page', method: 'get', params: { order: '', orderField: '', name: '张', idCard: 'masked', organizationId: 9, useYearMonth: '2026-09', status: 0, pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/hr/temporary-worker-salary/get', method: 'get', params: { id: 101 } })

    await expect(f.api.create(draft)).resolves.toBe(9001)
    expect(f.calls[2]).toEqual({ url: '/hr/temporary-worker-salary/create', method: 'post', data: draft })

    const update = { ...draft, id: 101, status: 0 as const }
    await expect(f.api.update(update)).resolves.toBe(true)
    expect(f.calls[3]).toEqual({ url: '/hr/temporary-worker-salary/update', method: 'put', data: update })

    await expect(f.api.remove({ id: 101, currentStatus: 0 })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/hr/temporary-worker-salary/delete/101', method: 'delete' })

    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '临时工工资模板.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[5]).toEqual({ url: '/sys/oss/download', method: 'get', params: { fileName: '临时工工资模板' }, responseType: 'arraybuffer' })

    expect(f.api.prepareImport({ fileName: '临时工.xlsx', base64: 'AQID' })).toEqual({ fileName: '临时工.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.importExcel({ fileName: '临时工.xlsx', base64: 'AQID' })).resolves.toBe('导入成功')
    expect(f.calls[6]?.url).toBe('/hr/temporary-worker-salary/import')
    expect(f.calls[6]?.method).toBe('post')
    expect(f.calls[6]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[6]?.data).toBeInstanceOf(FormData)

    await expect(f.api.createSummary(summaryDraft)).resolves.toEqual([9002, 9003])
    expect(f.calls[7]).toEqual({ url: '/hr/temporary-worker-salary-summary/create', method: 'post', data: summaryDraft })
  })

  it('prepare是无副作用草稿，取消时不发请求，并复现Portal的字段规则与状态门禁', async () => {
    const f = fixture([{ list: [], total: 0 }])
    expect(f.api.prepareCreate(draft).draft).toEqual(draft)
    expect(f.api.prepareUpdate({ ...draft, id: 101, status: 0 }).draft).toEqual({ ...draft, id: 101, status: 0 })
    expect(f.api.prepareRemove({ id: 101, currentStatus: 0 })).toEqual({ id: 101 })
    expect(f.api.prepareCreateSummary(summaryDraft).draft).toEqual(summaryDraft)
    expect(f.calls).toHaveLength(0)

    await f.api.list()
    expect(f.calls[0]!.params).toEqual({ order: '', orderField: '', name: '', idCard: '', organizationId: '', useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
    await expect(f.api.update({ ...draft, id: 101, status: 1 as never })).rejects.toThrow('不允许编辑')
    await expect(f.api.remove({ id: 101, currentStatus: 1 })).rejects.toThrow('不允许删除')
    expect(f.api.prepareImport({ fileName: '临时工.xlsx', base64: 'AQID' })).toMatchObject({ byteLength: 3 })
    await expect(f.api.create({ ...draft, useYearMonth: '2026-13' })).rejects.toThrow('YYYY-MM')
    await expect(f.api.create({ ...draft, name: '' })).rejects.toThrow('name')
    await expect(f.api.create({ ...draft, idCard: '身份证' })).rejects.toThrow('idCard')
    await expect(f.api.create({ ...draft, organizationId: 0 })).rejects.toThrow('organizationId')
    await expect(f.api.create({ ...draft, attendanceSalary: '1.234' })).rejects.toThrow('最多2位小数')
    await expect(f.api.create({ ...draft, grossSalary: '12345678901' })).rejects.toThrow('最多10位')
    await expect(f.api.createSummary({ ...summaryDraft, staffIdList: [101, 101] })).rejects.toThrow('重复')
    expect(() => f.api.prepareImport({ fileName: 'bad.txt', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '临时工.xlsx', base64: 'bad' })).toThrow('Base64')
    await expect(f.api.list({ status: 2 as never })).rejects.toThrow('0或1')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
  })

  it('AI契约覆盖表单提交、状态/组织权限、导入、汇总副作用和取消边界', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_TEMPORARY_SALARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_TEMPORARY_SALARY_METHODS).map(method => `reportTemporarySalary.${method}`))
    expect(contracts['report-temporary-salary-list']?.output.fields.some(item => item.path === 'list[].grossSalary')).toBe(true)
    expect(contracts['report-temporary-salary-create']?.steps[0]?.capabilityId).toBe('report-temporary-salary-get')
    expect(contracts['report-temporary-salary-prepare-update']?.steps[0]?.mapping?.id).toBe('result.draft.id')
    expect(contracts['report-temporary-salary-remove']?.boundaries.join('\n')).toContain('status=1')
    expect(contracts['report-temporary-salary-import']?.steps.some(step => step.capabilityId === 'report-temporary-salary-list')).toBe(true)
    expect(contracts['report-temporary-salary-create-summary']?.output.shape).toBe('(string | number)[]')
    expect(contracts['report-temporary-salary-create-summary']?.gaps?.join('\n')).toContain('撤销')
    expect(contracts['report-temporary-salary-create']?.boundaries.join('\n')).toContain('getOrgIdListByModuleType')
  })
})
