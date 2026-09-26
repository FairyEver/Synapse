import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSalaryProcessCapability,
  SALARY_PROCESS_METHODS,
  SALARY_PROCESS_PAGE_PATH,
  SALARY_PROCESS_PERMISSION,
  salaryProcessCapabilities,
  type SalaryProcessForm,
  type SalaryProcessUpdate,
} from '../src/capabilities/salary-process.js'
import {
  SALARY_PROCESS_AI_CONTRACTS as contracts,
  SALARY_PROCESS_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-salary-process.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryProcessCapability(request), calls }
}

const row = {
  id: 101,
  staffId: 201,
  staffCode: 'S001',
  staffName: '张三',
  idCard: 'masked',
  organization: 9,
  organizationName: '总部/财务',
  startOrganizationName: '总部/财务',
  postName: '会计',
  employmentType: 1,
  ledgerId: 301,
  salaryLevel: 401,
  salaryLevelName: 'L1',
  salaryLevelStandard: '5000.00',
  ledgerName: '月薪账套',
  cardIssuingBank: '示例银行',
  bankAccount: 'masked-account',
  status: 1,
  legalPersonId: 501,
  legalPersonName: '示例法人',
  costCenterId: 601,
  costCenterName: '财务成本中心',
  staffStatus: 1,
  entryTime: '2026-01-01 00:00:00',
  salaryCategory: '3',
  wage: '5000.00',
  description: '起薪',
  isDel: 0,
  creator: 1,
  createTime: '2026-01-01 00:00:00',
  updater: 2,
  updateTime: '2026-09-01 00:00:00',
  updaterName: '操作人',
  stopTime: null,
  stopDescription: null,
  emptyDate: '2026-09-01',
  preserved: true,
}

const form: SalaryProcessForm = {
  id: 101,
  transactTime: '2026-09-01',
  staffCode: 'S001',
  organization: 9,
  ledgerId: 301,
  status: 0,
  legalPersonId: 501,
  costCenterId: 601,
  salaryCategory: '3',
  wage: '5000.00',
  salaryLevel: 401,
  description: '起薪',
  isDel: 0,
  creator: 1,
  createTime: '2026-01-01 00:00:00',
  updater: 2,
  updateTime: '2026-09-01 00:00:00',
  stopTime: null,
  stopDescription: null,
  emptyDate: null,
}

const update: SalaryProcessUpdate = { ...form, status: 1, id: 101 }

const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': "attachment;filename*=UTF-8''%E8%96%AA%E8%B5%84%E5%8A%9E%E7%90%86.xlsx",
  },
}

const fileInput = { fileName: '薪资办理.xlsx', base64: 'AQID' }

describe('Portal 人力 → 薪资办理', () => {
  it('逐页锁定菜单、列表、编辑页、弹窗、候选组件、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/salary/process/list.vue'), 'utf8')
    const editor = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/salary/process/[mode]/[id].vue'), 'utf8')
    const stop = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/salary/process/components/stop.vue'), 'utf8')
    const batchStart = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/salary/process/components/batch-start.vue'), 'utf8')
    const batchStop = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/salary/process/components/batch-stop.vue'), 'utf8')
    const candidates = [
      'app/portal/components/portal/hxr/select/ledger/index.vue',
      'app/portal/components/portal/hxr/select/legal-person/index.vue',
      'app/portal/components/portal/hxr/select/cost-center/index.vue',
      'app/portal/components/portal/hxr/select/salary-level/index.vue',
    ].map(path => readFileSync(join(portalRoot, path), 'utf8')).join('\n')

    expect(menu).toContain(`path: '${SALARY_PROCESS_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALARY_PROCESS_PERMISSION}'`)
    for (const fragment of [
      "getDataListURL: '/salary/salarytransact/page'",
      'businessDate: formatDay()',
      "orgIds: data.orgIds.length !== 0 ? data.orgIds.join(',') : ''",
      "record.id ? `/salary/salarytransact/check?id=${record.id}` : '/salary/salarytransact/check'",
      '/admin-api/salary/salarytransact/export',
      "http.put('/salary/salarytransact/editLegalPersonId'",
      "http.put('/salary/salarytransact/editCostCenterId'",
      "http.post('/salary/salarytransact/batchEmptyTaxDate'",
      'item.status !== 1',
    ]) expect(page).toContain(fragment)
    for (const fragment of [
      "'/salary/salarytransact/info'",
      "http('/salary/ledger/getWebLedgerList')",
      "http.put('/salary/salarytransact', form)",
      "http.post('/salary/salarytransact', form)",
      "salaryInfo.value.status === 1",
      'name="ledgerId"',
      'name="legalPersonId"',
      'name="costCenterId"',
      'name="description"',
      ':maxlength="200"',
    ]) expect(editor).toContain(fragment)
    for (const fragment of ["http.put('/salary/salarytransact/stop'", 'stopTime', 'stopDescription']) expect(stop).toContain(fragment)
    for (const fragment of ["http.post('/salary/salarytransact/importExcel'", "formData.append('file'", "http.get('/salary/salarytransact/download')", 'accept=".xlsx,.xls"']) expect(batchStart).toContain(fragment)
    for (const fragment of ["http.post('/salary/salarytransact/stopBatch'", "formData.append('file'", "http.get('/salary/salarytransact/stopdownload')", "isXls"]) expect(batchStop).toContain(fragment)
    for (const fragment of [
      "getWebLedgerList",
      "getAllLegalPerson",
      "salary/costcenter/list",
      "getAllSalaryLevel",
    ]) expect(candidates).toContain(fragment)

    expect(salaryProcessCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_PROCESS_METHODS))
    expect(salaryProcessCapabilities.every(item => item.pagePath === SALARY_PROCESS_PAGE_PATH && item.permission === SALARY_PROCESS_PERMISSION && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_PROCESS_PAGE_PATH).moduleType).toBe(14)
  })

  it('逐页锁定Java Controller、DTO、Service、Mapper和范围规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const javaHr = join(javaRoot, 'erp-module-hr')
    const controller = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryTransactController.java'), 'utf8')
    const service = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryTransactServiceImpl.java'), 'utf8')
    const mapper = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/resources/mapper/salary/SalaryTransactDao.xml'), 'utf8')
    const dto = readFileSync(join(javaHr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryTransactDTO.java'), 'utf8')
    const batch = readFileSync(join(javaHr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryTransactBatchEditDTO.java'), 'utf8')
    const empty = readFileSync(join(javaHr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryTransactEmptyDTO.java'), 'utf8')
    const importExcel = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryTransactImportExcel.java'), 'utf8')
    const stopExcel = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/excel/SalaryTransactStopImportExcel.java'), 'utf8')
    const eligibility = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/dto/HrStaffSalaryEligibilityResultDTO.java'), 'utf8')
    const excluded = readFileSync(join(javaHr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/dto/HrStaffSalaryExcludedDTO.java'), 'utf8')
    for (const fragment of [
      '@GetMapping("page")', '@GetMapping("info")', '@PostMapping', '@GetMapping("check")', '@PutMapping("stop")',
      '@PutMapping("editLegalPersonId")', '@PutMapping("editCostCenterId")', '@PostMapping("batchEmptyTaxDate")',
      '@PostMapping("importExcel")', '@PostMapping("stopBatch")', '@GetMapping("download")', '@GetMapping("stopdownload")',
    ]) expect(controller).toContain(fragment)
    for (const field of ['id', 'transactTime', 'staffCode', 'organization', 'ledgerId', 'status', 'legalPersonId', 'costCenterId', 'salaryCategory', 'wage', 'salaryLevel', 'description', 'stopTime', 'stopDescription', 'emptyDate']) expect(dto).toContain(field)
    for (const field of ['idList', 'legalPersonId', 'costCenterId', 'stopTime', 'stopDescription']) expect(batch).toContain(field)
    for (const field of ['ids', 'emptyDate']) expect(empty).toContain(field)
    for (const field of ['staffName', 'idCard', 'salaryCategory', 'description', 'stopTime', 'stopDescription']) expect(importExcel + stopExcel).toContain(field)
    for (const field of ['processedIds', 'processedStaffCodes', 'processedCount', 'eligibleStaffIds', 'eligibleStaffCodes', 'excludedStaffList']) expect(eligibility).toContain(field)
    for (const field of ['staffId', 'staffCode', 'staffName', 'status', 'downtimePay', 'businessDate', 'reasonCode', 'reason']) expect(excluded).toContain(field)
    for (const fragment of ['getRoleOrganizationTree', 'setOrgIds', 'stopImmediately', 'scheduleSalaryStop', 'getTransactTime', 'salaryTransactBatchImport']) expect(service).toContain(fragment)
    for (const fragment of ['params.staffCodeList', 'params.orgIds', 'params.businessDate', 'params.staffCode', 'params.status']) expect(mapper).toContain(fragment)
  })

  it('按Portal页面顺序发送列表、详情、候选、校验、表单、批量调整和导出', async () => {
    const f = fixture([
      { list: [row], total: 1 }, row, row, [{ id: 301, name: '月薪账套' }], [{ id: 501, name: '示例法人' }], [{ id: 601, name: '财务成本中心' }], [{ id: 401, name: 'L1' }],
      0, 0, undefined, undefined, undefined, undefined, undefined, '', fileResponse, fileResponse, 'https://oss.example/start.xlsx', fileResponse,
      { processedIds: [101], processedStaffCodes: ['S001'], processedCount: 1, eligibleStaffIds: [201], eligibleStaffCodes: ['S001'], excludedStaffList: [] },
      'https://oss.example/stop.xlsx', fileResponse, null,
    ])
    await expect(f.api.list({ orgIds: [9, '10'], staffCode: 'S001', staffStatus: 1, status: 0, staffName: '张', businessDate: '2026-09-23', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/salarytransact/page', method: 'get', params: { order: '', orderField: '', orgIds: '9,10', staffCode: 'S001', staffStatus: 1, status: 0, staffName: '张', businessDate: '2026-09-23', pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/salary/salarytransact/info', method: 'get', params: { id: 101 } })
    await expect(f.api.get({ staffCode: 'S001' })).resolves.toEqual(row)
    expect(f.calls[2]).toEqual({ url: '/salary/salarytransact/info', method: 'get', params: { staffCode: 'S001' } })
    await expect(f.api.ledgerOptions()).resolves.toEqual([{ id: 301, name: '月薪账套' }])
    await expect(f.api.legalPersonOptions()).resolves.toEqual([{ id: 501, name: '示例法人' }])
    await expect(f.api.costCenterOptions()).resolves.toEqual([{ id: 601, name: '财务成本中心' }])
    await expect(f.api.salaryLevelOptions()).resolves.toEqual([{ id: 401, name: 'L1' }])
    expect(f.calls.slice(3, 7).map(call => call.url)).toEqual(['/salary/ledger/getWebLedgerList', '/org/corporation/getAllLegalPerson', '/salary/costcenter/list', '/org/hrsalarylevel/getAllSalaryLevel'])
    await expect(f.api.checkStart({ id: 101 })).resolves.toBe(0)
    expect(f.calls[7]).toEqual({ url: '/salary/salarytransact/check', method: 'get', params: { id: 101 } })
    await expect(f.api.checkStart()).resolves.toBe(0)
    expect(f.calls[8]).toEqual({ url: '/salary/salarytransact/check', method: 'get' })

    expect(f.api.prepareStart(form).draft).toEqual({ ...form, transactTime: '2026-09-01' })
    expect(f.calls).toHaveLength(9)
    await f.api.start(form)
    expect(f.calls[9]).toEqual({ url: '/salary/salarytransact', method: 'post', data: { ...form, transactTime: '2026-09-01' } })
    await f.api.update(update)
    expect(f.calls[10]).toEqual({ url: '/salary/salarytransact', method: 'put', data: { ...update, transactTime: '2026-09-01' } })
    expect(f.api.prepareStop({ id: 101, stopTime: '2026-09-30', stopDescription: '月底停薪' }).draft).toEqual({ idList: [101], stopTime: '2026-09-30', stopDescription: '月底停薪' })
    await f.api.stop({ id: 101, stopTime: '2026-09-30', stopDescription: '月底停薪' })
    expect(f.calls[11]).toEqual({ url: '/salary/salarytransact/stop', method: 'put', data: { idList: [101], stopTime: '2026-09-30', stopDescription: '月底停薪' } })
    await f.api.editLegalPerson({ idList: [101, '102'], currentStatuses: [1, 1], legalPersonId: 502 })
    expect(f.calls[12]).toEqual({ url: '/salary/salarytransact/editLegalPersonId', method: 'put', data: { legalPersonId: 502, idList: [101, '102'] } })
    await f.api.editCostCenter({ idList: [101, '102'], currentStatuses: [1, 1], costCenterId: 602 })
    expect(f.calls[13]).toEqual({ url: '/salary/salarytransact/editCostCenterId', method: 'put', data: { costCenterId: 602, idList: [101, '102'] } })
    await expect(f.api.clearTaxDate({ idList: [101], currentStatuses: [1], emptyDate: '2026-09' })).resolves.toBe('')
    expect(f.calls[14]).toEqual({ url: '/salary/salarytransact/batchEmptyTaxDate', method: 'post', data: { emptyDate: '2026-09', ids: [101] } })
    await f.api.export({ orgIds: [9], staffName: '张', businessDate: '2026-09-23' })
    expect(f.calls[15]).toEqual({ url: '/admin-api/salary/salarytransact/export', method: 'get', params: { orgIds: '9', staffCode: '', staffStatus: '', status: '', staffName: '张', businessDate: '2026-09-23' }, responseType: 'arraybuffer' })
    await f.api.export({ selectedStaffCodes: ['S001', 'S001', 2], businessDate: '2026-09-23' })
    expect(f.calls[16]).toEqual({ url: '/admin-api/salary/salarytransact/export', method: 'get', params: { staffCodeList: ['S001', 2], businessDate: '2026-09-23' }, responseType: 'arraybuffer' })
    await expect(f.api.downloadBatchStartTemplate()).resolves.toMatchObject({ fileName: '薪资办理.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[17]).toEqual({ url: '/salary/salarytransact/download', method: 'get' })
    expect(f.calls[18]).toEqual({ url: 'https://oss.example/start.xlsx', method: 'get', responseType: 'arraybuffer' })
    expect(f.api.prepareBatchStart(fileInput)).toEqual({ fileName: '薪资办理.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.batchStart(fileInput)).resolves.toMatchObject({ processedCount: 1, processedStaffCodes: ['S001'] })
    expect(f.calls[19]?.url).toBe('/salary/salarytransact/importExcel')
    expect(f.calls[19]?.method).toBe('post')
    expect(f.calls[19]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[19]?.data).toBeInstanceOf(FormData)
    await expect(f.api.downloadBatchStopTemplate()).resolves.toMatchObject({ fileName: '薪资办理.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[20]).toEqual({ url: '/salary/salarytransact/stopdownload', method: 'get' })
    expect(f.calls[21]).toEqual({ url: 'https://oss.example/stop.xlsx', method: 'get', responseType: 'arraybuffer' })
    expect(f.api.prepareBatchStop(fileInput)).toMatchObject({ fileName: '薪资办理.xlsx', byteLength: 3 })
    await expect(f.api.batchStop(fileInput)).resolves.toBeNull()
    expect(f.calls[22]?.url).toBe('/salary/salarytransact/stopBatch')
    expect(f.calls[22]?.data).toBeInstanceOf(FormData)
  })

  it('反证所有状态、权限、表单、月份、日期、分页和文件门禁；prepare取消不产生请求', async () => {
    const f = fixture([{ list: [], total: 0 }])
    expect(f.api.prepareStart(form).draft).toBeTruthy()
    expect(f.api.prepareUpdate(update).draft).toBeTruthy()
    expect(f.api.prepareStop({ id: 101, stopDescription: '停薪' }).draft).toMatchObject({ idList: [101] })
    expect(f.api.prepareEditLegalPerson({ idList: [101], currentStatuses: [1], legalPersonId: 502 }).draft).toEqual({ legalPersonId: 502, idList: [101] })
    expect(f.api.prepareClearTaxDate({ idList: [101], currentStatuses: [1], emptyDate: '2026-09' }).draft).toEqual({ emptyDate: '2026-09', ids: [101] })
    expect(f.api.prepareBatchStart(fileInput)).toMatchObject({ byteLength: 3 })
    expect(f.api.prepareBatchStop(fileInput)).toMatchObject({ byteLength: 3 })
    expect(f.calls).toHaveLength(0)

    await f.api.list()
    expect(f.calls[0]?.params).toMatchObject({ order: '', orderField: '', orgIds: '', staffCode: '', staffStatus: '', status: '', staffName: '', pageNo: 1, pageSize: 20 })
    await expect(f.api.list({ orgIds: [9, 9] })).rejects.toThrow('重复')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50、100、200或500')
    await expect(f.api.list({ businessDate: '2026-02-29' })).rejects.toThrow('有效日期')
    await expect(f.api.get({})).rejects.toThrow('staffCode')
    await expect(f.api.checkStart({ id: 0 })).rejects.toThrow('正整数ID')
    expect(() => f.api.prepareStart({ ...form, transactTime: null })).toThrow('transactTime')
    expect(() => f.api.prepareStart({ ...form, staffCode: '' })).toThrow('staffCode')
    expect(() => f.api.prepareStart({ ...form, ledgerId: null })).toThrow('ledgerId')
    expect(() => f.api.prepareStart({ ...form, description: '' })).toThrow('description')
    expect(() => f.api.prepareStart({ ...form, status: 1 })).toThrow('不能重复起薪')
    expect(() => f.api.prepareUpdate({ ...update, status: 0 as never })).toThrow('status=1')
    expect(() => f.api.prepareStop({ id: 101, stopTime: '2026-02-30', stopDescription: '停薪' })).toThrow('有效日期')
    expect(() => f.api.prepareStop({ id: 101, stopDescription: '' })).toThrow('不能为空')
    expect(() => f.api.prepareEditCostCenter({ idList: [101], currentStatuses: [0], costCenterId: 602 })).toThrow('未起薪')
    expect(() => f.api.prepareEditCostCenter({ idList: [101, 102], currentStatuses: [1], costCenterId: 602 })).toThrow('等长')
    expect(() => f.api.prepareClearTaxDate({ idList: [101], currentStatuses: [1], emptyDate: '2026-13' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareBatchStart({ fileName: 'salary.txt', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareBatchStart({ fileName: 'salary.xlsx', base64: 'bad' })).toThrow('Base64')
    expect(() => f.api.prepareBatchStart({ fileName: 'salary.xlsx', base64: '====' })).toThrow('Base64')
    expect(() => f.api.prepareBatchStop({ fileName: 'salary.xlsx', base64: ' ' })).toThrow('不能为空')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([3]).api.checkStart()).rejects.toThrow('0、1或2')
    await expect(fixture([[]]).api.ledgerOptions()).resolves.toEqual([])
    await expect(fixture([{ processedCount: -1 }]).api.batchStart(fileInput)).rejects.toThrow('非负整数')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
    await expect(fixture(['']).api.downloadBatchStartTemplate()).rejects.toThrow('模板下载URL')
  })

  it('AI契约覆盖每个页面动作、字段语义、权限边界、写回查和取消边界', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(SALARY_PROCESS_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(SALARY_PROCESS_METHODS).map(method => `salaryProcess.${method}`))
    expect(contracts['salary-process-list']?.output.fields.some(item => item.path === 'list[].bankAccount')).toBe(true)
    expect(contracts['salary-process-list']?.boundaries.join('\n')).toContain('getRoleOrganizationTree')
    expect(contracts['salary-process-start']?.steps[0]?.capabilityId).toBe('salary-process-get')
    expect(contracts['salary-process-update']?.consume.join('\n')).toContain('organization和staffCode')
    expect(contracts['salary-process-prepare-start']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['salary-process-batch-start']?.output.fields.some(item => item.path === 'excludedStaffList[].reason')).toBe(true)
    expect(contracts['salary-process-clear-tax-date']?.steps[0]?.instruction).toContain('emptyDate')
    expect(contracts['salary-process-batch-stop']?.gaps?.join('\n')).toContain('逐行结果')
  })
})
