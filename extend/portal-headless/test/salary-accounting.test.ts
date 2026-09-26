import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSalaryAccountingCapability,
  SALARY_ACCOUNTING_METHODS,
  SALARY_ACCOUNTING_MODULE_TYPE,
  SALARY_ACCOUNTING_PAGE_PATH,
  SALARY_ACCOUNTING_PERMISSION,
  salaryAccountingCapabilities,
} from '../src/capabilities/salary-accounting.js'
import { SALARY_ACCOUNTING_AI_CONTRACTS as contracts } from '../src/catalog/contracts-salary-accounting.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryAccountingCapability(request), calls }
}

const page = { list: [{ id: 11, name: '2026年09月总部月薪工资', status: 0, step: 4 }], total: 1 }
const document = { id: 11, name: '2026年09月总部月薪工资', organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', status: 0, step: 4 }
const eligibility = {
  processedIds: [301],
  processedStaffCodes: ['S001'],
  processedCount: 1,
  eligibleStaffIds: [301],
  eligibleStaffCodes: ['S001'],
  excludedStaffList: [],
}
const fileResponse = {
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': 'attachment;filename="示例模板.xlsx"',
  },
}
const file = { fileName: '核算.xlsx', base64: 'AQID' }

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

describe('Portal 人力 → 薪资核算', () => {
  it('逐页锁定菜单、列表、三步向导、详情、弹窗、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/list.vue')
    const step1 = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/step1/[mode]/[id].vue')
    const step2 = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/step2/[mode]/[id].vue')
    const step3 = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/step3/[mode]/[id].vue')
    const detail = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/detail/[id].vue')
    const split = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/split-document.vue')
    const createMultiple = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/create-multiple.vue')
    const secondImport = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/step-second-import.vue')
    const staffSelect = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/staff-select.vue')
    const people = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/document-people.vue')
    const historyPeople = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/document-history-people.vue')
    const edit = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/edit.vue')
    const pay = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-accounting/components/pay.vue')
    const all = [list, step1, step2, step3, detail, split, createMultiple, secondImport, staffSelect, people, historyPeople, edit, pay].join('\n')

    expect(menu).toContain(`path: '${SALARY_ACCOUNTING_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALARY_ACCOUNTING_PERMISSION}'`)
    for (const fragment of [
      "getDataListURL: '/salary/document/page'",
      "deleteURL: '/salary/document'",
      "operatorId: userStore.state.id",
      "http.post('/salary/document/documentCheckout'",
      'record.status === 0',
      'record.step',
      'actionSplitDocument',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "getDataListURL: '/salary/ledgerItem/page'",
      'name="organizationId"',
      'name="ledgerId"',
      'name="salaryMonth"',
      'name="costMonth"',
      "http.get('/salary/document/stepInfo'",
      "http.post('/salary/document/saveFirstType'",
      'accountingFormState.costMonth = value',
    ]) expect(step1).toContain(fragment)
    for (const fragment of [
      "http.get('/salary/document/stepInfo'",
      "http.post(\n      `/salary/document/saveSecondType/${id}`",
      'list.value.length === 0',
      "http.get('/admin-api/salary/document/lastTimeStaffWithEligibility'",
      'staffCode',
    ]) expect(step2).toContain(fragment)
    for (const fragment of [
      "http.get('/salary/ledgerItem/getAllExternalDataSalaryItem'",
      "http.post(`/salary/document/accountResult`",
      "http.post(`/salary/document/importResult/${route.params.id}`)",
      "http.post(`/salary/document/calculate/${route.params.id}`)",
      "VITE_ZHDJ_PLATFORM_API}/admin-api/salary/document/download",
      'record.status !== 1',
    ]) expect(step3).toContain(fragment)
    for (const fragment of [
      "http.get(`/salary/document/${route.params.id}`)",
      "http.put(`/salary/document/${route.params.id}`, { name: formState.value.name })",
      "http.post('/salary/document/documentUserPage'",
      'record.status === 1',
      'documentUserPageExport',
      'grantTime',
    ]) expect(detail).toContain(fragment)
    expect(detail).toContain('rrList.actionEdit(record)')
    expect(detail).toContain('<common-action-core @click="() => isOpen = false">取消</common-action-core>')
    for (const fragment of ["http.post('/salary/document/getDocumentUsers'", "http.post('/salary/document/splitDocument'", 'staffCodeList', 'max: 30']) expect(split).toContain(fragment)
    for (const fragment of ["formData.append('file'", "formData.append('documentId'", "formData.append('type'", "http.post(`/salary/document/accountResult`"]) expect(createMultiple).toContain(fragment)
    for (const fragment of ["formData.append('orgId'", "formData.append('documentId'", "formData.append('file'", "http.post('/admin-api/salary/document/secondImportWithEligibility'", "http.get('/admin-api/salary/document/secondDownload'"]) expect(secondImport).toContain(fragment)
    for (const fragment of ["http.get('/org/organization/getTree')", "http.post('/org/staff/getStaffPageByOrgWithEligibility'", 'loopFetch', 'pageSize: 500', 'salaryEligibilityExcluded']) expect(staffSelect).toContain(fragment)
    for (const fragment of ["http.post('/salary/document/getDocumentUsers'", "http.get('/salary/salaryhistoryuser/getHistoryUser'"]) expect(`${people}\n${historyPeople}`).toContain(fragment)
    for (const fragment of ["salaryDocumentDetailTemporary/page", "salaryDocumentDetailTemporary/batchUpdate", 'formData', 'value']) expect(`${edit}\n${all}`).toContain(fragment)
    for (const fragment of ['grantTime', "http.post('/salary/document/paySalary'"]) expect(pay).toContain(fragment)
    expect(all).toContain("permission: /dashboard/salary/salary-accounting")

    expect(salaryAccountingCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_ACCOUNTING_METHODS))
    expect(salaryAccountingCapabilities.every(item => item.pagePath === SALARY_ACCOUNTING_PAGE_PATH && item.permission === SALARY_ACCOUNTING_PERMISSION && item.moduleType === SALARY_ACCOUNTING_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_ACCOUNTING_PAGE_PATH).moduleType).toBe(SALARY_ACCOUNTING_MODULE_TYPE)
  })

  it('逐页锁定Java Controller、DTO、Service、Mapper、临时明细和权限规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const hrRoot = join(javaRoot, 'erp-module-hr')
    const controller = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryDocumentController.java')
    const temporaryController = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryDocumentDetailTemporaryController.java')
    const service = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentServiceImpl.java')
    const userService = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentUserInformationServiceImpl.java')
    const temporaryService = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryDocumentDetailTemporaryServiceImpl.java')
    const staffController = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrStaffController.java')
    const staffSelectDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrStaffSelectDTO.java')
    const selectDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryDocumentSelectDTO.java')
    const userDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/DocumentUserSelectDTO.java')
    const payDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/DocumentPaySalaryDTO.java')
    const checkoutDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/DocumentCheckoutDTO.java')
    const temporaryDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryDocumentDetailTemporaryDTO.java')
    const eligibility = read(hrRoot, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/dto/HrStaffSalaryEligibilityResultDTO.java')

    for (const fragment of [
      '@RequestMapping("/salary/document")', '@GetMapping("page")', '@GetMapping("{id}")', '@GetMapping("stepInfo")',
      '@PostMapping("saveFirstType")', '@PostMapping("saveSecondType/{documentId}")', '@PostMapping("calculate/{documentId}")',
      '@DeleteMapping', '@PostMapping("accountResult")', '@PostMapping("importResult/{documentId}")', '@PostMapping("splitDocument")',
      '@PostMapping("documentUserPage")', '@PostMapping("documentUserPageExport")', '@PostMapping("paySalary")', '@PostMapping("documentCheckout")',
      '@PostMapping("getDocumentUsers")', '@GetMapping("secondDownload")', '@PostMapping("secondImportWithEligibility")', '@GetMapping("lastTimeStaffWithEligibility")',
    ]) expect(controller).toContain(fragment)
    expect(controller).toContain('@PutMapping')
    expect(controller).toContain('public CommonResult update(@RequestBody SalaryDocumentDTO dto)')
    const salaryDocumentDto = read(hrRoot, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryDocumentDTO.java')
    expect(salaryDocumentDto).toContain('private Long id')
    expect(salaryDocumentDto).toContain('private String name')
    for (const fragment of ['@RequestMapping("/salary/salaryDocumentDetailTemporary")', '@GetMapping("page")', '@PostMapping("batchUpdate")', 'updateBatchById']) expect(temporaryController).toContain(fragment)
    for (const fragment of ['@DataScope(organizationAlias = "t1", organizationIdAlias = "organization_id")', 'getPageData', 'getDescendantByAncestor', 'salaryLedgerService.selectListByRole', 'saveSecondType', 'deleteDocument', 'status == 1', 'paySalary', 'documentCheckout', 'splitDocument']) expect(service).toContain(fragment)
    for (const fragment of ['updateWrapper.set("status", 1)', 'getGrantTime()', 'documentId', 'idList']) expect(userService).toContain(fragment)
    for (const fragment of ['calculateAndInsertDetailData', 'insertDetailData', 'SalaryDocumentDetailTemporaryEntity']) expect(temporaryService).toContain(fragment)
    expect(staffController).toContain('getStaffPageByOrgWithEligibility')
    for (const fragment of ['documentId', 'staffName', 'staffCode', 'orgId', 'postName', 'pageSize']) expect(staffSelectDto).toContain(fragment)
    for (const fragment of ['salaryMonth', 'status', 'operatorId', 'organizationId', 'ledgerId', 'personCount', 'creatorName', 'createDate', 'operateDate', 'salaryTaxBand']) expect(selectDto).toContain(fragment)
    for (const fragment of ['documentId', 'status', 'name', 'staffCode', 'pageNo', 'pageSize']) expect(userDto).toContain(fragment)
    for (const fragment of ['documentId', 'idList', 'grantTime']) expect(payDto).toContain(fragment)
    for (const fragment of ['ids', 'status']) expect(checkoutDto).toContain(fragment)
    for (const fragment of ['documentId', 'itemId', 'staffName', 'value']) expect(temporaryDto).toContain(fragment)
    for (const fragment of ['processedIds', 'processedStaffCodes', 'processedCount', 'eligibleStaffIds', 'eligibleStaffCodes', 'excludedStaffList']) expect(eligibility).toContain(fragment)
  })

  it('按Portal请求形状覆盖列表、步骤、候选、导入、详情、状态动作和临时明细', async () => {
    const f = fixture([
      page, document, { organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '示例' },
      { list: [{ id: 401, name: '基本工资', attribute: 1 }], total: 1 }, 501, eligibility,
      [{ id: 301, staffCode: 'S001', name: '张三' }], [{ id: 301, staffCode: 'S001', name: '张三' }], [{ id: 101, name: '总部' }],
      { staffPage: { list: [{ id: 301, staffCode: 'S001', name: '张三' }], total: 1 }, eligibilityResult: eligibility },
      { staffList: [{ id: 301, staffCode: 'S001', name: '张三' }], eligibilityResult: eligibility },
      { staffList: [{ id: 301, staffCode: 'S001', name: '张三' }], eligibilityResult: eligibility },
      'https://oss.example/second.xlsx', fileResponse, ['基本工资'], ['基本工资'], ['基本工资'], eligibility, fileResponse,
      document, { summary: { totalNeedPaySalary: '5000.00' }, pageData: { list: [{ id: 701, staffCode: 'S001', status: 0 }], total: 1 } }, fileResponse,
      undefined, undefined, undefined, { list: [{ id: 801, itemId: 601, value: '1' }], total: 1 }, undefined,
    ])

    await expect(f.api.list({ operatorId: 9, salaryMonth: '2026-09', status: 0, organizationId: 101, pageNo: 2, pageSize: 50 })).resolves.toEqual(page)
    expect(f.calls[0]).toEqual({ url: '/salary/document/page', method: 'get', params: { order: '', orderField: '', salaryMonth: '2026-09', status: 0, operatorId: 9, name: '', ledgerId: '', organizationId: 101, personCount: '', creatorName: '', createDate: '', operateDate: '', salaryTaxBand: '', pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: 11 })).resolves.toEqual(document)
    await expect(f.api.stepInfo({ id: 11, step: 2 })).resolves.toEqual({ organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '示例' })
    await expect(f.api.ledgerItemList({ ledgerId: 201, attribute: 1, name: '基本', pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [{ id: 401, name: '基本工资', attribute: 1 }], total: 1 })
    await expect(f.api.create({ organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '示例' })).resolves.toBe(501)
    expect(f.calls[4]).toEqual({ url: '/salary/document/saveFirstType', method: 'post', data: { organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '示例' } })
    await expect(f.api.saveStaff({ documentId: 501, staffList: [{ id: 301, name: '张三', staffCode: 'S001', status: 1 }] })).resolves.toEqual(eligibility)
    expect(f.calls[5]).toEqual({ url: '/salary/document/saveSecondType/501', method: 'post', data: [{ id: 301, name: '张三', staffCode: 'S001', status: 1 }] })
    await expect(f.api.documentUsers({ documentIds: [11, 12] })).resolves.toEqual([{ id: 301, staffCode: 'S001', name: '张三' }])
    await expect(f.api.historyUsers()).resolves.toEqual([{ id: 301, staffCode: 'S001', name: '张三' }])
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 101, name: '总部' }])
    await expect(f.api.staffList({ documentId: 11, staffName: '张', staffCode: 'S001', orgId: 101, postName: '会计', pageNo: 1, pageSize: 500 })).resolves.toMatchObject({ staffPage: { total: 1 }, eligibilityResult: eligibility })
    await expect(f.api.lastStaff({ documentId: 11 })).resolves.toMatchObject({ staffList: [{ staffCode: 'S001' }], eligibilityResult: eligibility })
    expect(f.calls[9]).toEqual({ url: '/org/staff/getStaffPageByOrgWithEligibility', method: 'post', data: { documentId: 11, staffName: '张', staffCode: 'S001', orgId: 101, postName: '会计', pageNo: 1, pageSize: 500 } })
    expect(f.api.prepareStaffImport(file)).toEqual({ fileName: '核算.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.staffImport({ ...file, documentId: 11, orgId: 101 })).resolves.toMatchObject({ eligibilityResult: eligibility })
    const staffUpload = f.calls[11]!.data as FormData
    expect(staffUpload.get('documentId')).toBe('11')
    expect(staffUpload.get('orgId')).toBe('101')
    expect((staffUpload.get('file') as File).name).toBe('核算.xlsx')
    await expect(f.api.secondTemplate()).resolves.toMatchObject({ fileName: '示例模板.xlsx', byteLength: 3 })
    expect(f.calls[12]).toEqual({ url: '/salary/document/secondDownload', method: 'get' })
    expect(f.calls[13]).toMatchObject({ url: 'https://oss.example/second.xlsx', method: 'get', responseType: 'arraybuffer' })
    await expect(f.api.externalItems({ documentId: 11 })).resolves.toEqual(['基本工资'])
    await expect(f.api.existingExternalItems({ documentId: 11, type: 1 })).resolves.toEqual(['基本工资'])
    await expect(f.api.externalAccountResult({ ...file, documentId: 11, type: 2 })).resolves.toEqual(['基本工资'])
    const externalUpload = f.calls[16]!.data as FormData
    expect(externalUpload.get('documentId')).toBe('11')
    expect(externalUpload.get('type')).toBe('2')
    await expect(f.api.importExternalResult({ documentId: 11 })).resolves.toEqual(eligibility)
    await expect(f.api.externalTemplate({ documentId: 11, type: 2 })).resolves.toMatchObject({ fileName: '示例模板.xlsx', byteLength: 3 })
    await expect(f.api.detail({ id: 11 })).resolves.toEqual(document)
    await expect(f.api.detailUsers({ documentId: 11, status: 0, name: '张', staffCode: 'S001', pageNo: 1, pageSize: 20 })).resolves.toMatchObject({ pageData: { total: 1 } })
    await expect(f.api.detailExport({ documentId: 11, status: 0, name: '', staffCode: '', pageNo: 1, pageSize: 20 })).resolves.toMatchObject({ fileName: '示例模板.xlsx', byteLength: 3 })
    expect(f.calls[21]).toMatchObject({ url: '/salary/document/documentUserPageExport', method: 'post', responseType: 'arraybuffer' })
    await expect(f.api.pay({ documentId: 11, idList: [701], grantTime: '2026-09-23', documentStatus: 1, currentStatuses: [0] })).resolves.toBe(true)
    expect(f.api.prepareRename({ id: 11, name: '改名' })).toEqual({ id: 11, name: '改名' })
    await expect(f.api.rename({ id: 11, name: '改名' })).resolves.toBe(true)
    expect(f.calls.at(-1)).toEqual({ url: '/salary/document/11', method: 'put', data: { name: '改名' } })
    expect(f.api.cancelRename()).toEqual({ cancelled: true })
    await expect(f.api.split({ documentIds: [11], name: '拆分单据', staffCodeList: ['S001'], currentStatuses: [0], currentSteps: [4] })).resolves.toBe(true)
    await expect(f.api.temporaryDetailList({ documentId: 11, itemId: 601, staffName: '张' })).resolves.toEqual({ list: [{ id: 801, itemId: 601, value: '1' }], total: 1 })
    await expect(f.api.temporaryDetailUpdate({ updates: [{ id: 801, value: '2' }] })).resolves.toBe(true)
    expect(f.calls.at(-1)).toEqual({ url: '/salary/salaryDocumentDetailTemporary/batchUpdate', method: 'post', data: [{ id: 801, value: '2' }] })
  })

  it('prepare不发请求，反证锁定表单、状态、权限和文件规则', async () => {
    const f = fixture([undefined])
    expect(f.api.prepareCreate({ organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '' })).toEqual({ draft: { organizationId: 101, ledgerId: 201, salaryMonth: '2026-09', costMonth: '2026-09', name: '' } })
    expect(f.api.prepareCalculate({ documentId: 11, currentStatus: 0 })).toEqual({ documentId: 11 })
    expect(f.api.prepareRemove({ ids: [11], currentStatuses: [0] })).toEqual({ ids: [11] })
    expect(f.api.prepareCheckout({ ids: [11], status: 1, currentStatuses: [0] })).toEqual({ ids: [11], status: 1 })
    expect(f.api.preparePay({ documentId: 11, idList: [701], grantTime: '2026-09-23', documentStatus: 1, currentStatuses: [0] })).toEqual({ documentId: 11, idList: [701], grantTime: '2026-09-23' })
    expect(f.api.prepareSplit({ documentIds: [11], name: '拆分单据', staffCodeList: ['S001'], currentStatuses: [0], currentSteps: [4] })).toEqual({ ids: [11], name: '拆分单据', staffCodeList: ['S001'] })
    expect(f.calls).toHaveLength(0)
    await expect(f.api.create({ organizationId: 101, ledgerId: 201, salaryMonth: '2026-9', costMonth: '2026-09' })).rejects.toThrow('salaryMonth必须为YYYY-MM')
    expect(() => f.api.prepareRemove({ ids: [11], currentStatuses: [1] })).toThrow('只能处理状态为0')
    expect(() => f.api.prepareCalculate({ documentId: 11, currentStatus: 1 })).toThrow('只能处理未结账')
    expect(() => f.api.prepareCheckout({ ids: [11], status: 1, currentStatuses: [1] })).toThrow('只能处理状态为0')
    expect(() => f.api.preparePay({ documentId: 11, idList: [701], grantTime: '2026-09-23', documentStatus: 0, currentStatuses: [0] })).toThrow('只允许已结账')
    expect(() => f.api.preparePay({ documentId: 11, idList: [701], grantTime: '2026-09-23', documentStatus: 1, currentStatuses: [1] })).toThrow('只能处理状态为0')
    expect(() => f.api.prepareSplit({ documentIds: [11], name: '拆分单据', staffCodeList: ['S001'], currentStatuses: [0], currentSteps: [3] })).toThrow('step=4')
    expect(() => f.api.prepareSplit({ documentIds: [11], name: '   ', staffCodeList: ['S001'], currentStatuses: [0], currentSteps: [4] })).toThrow('name不能为空')
    expect(() => f.api.prepareStaffImport({ fileName: '人员.csv', base64: 'AQID' })).toThrow('.xlsx或.xls')
    expect(() => f.api.prepareStaffImport({ fileName: '人员.xlsx', base64: 'bad!' })).toThrow('标准Base64')
    expect(() => f.api.prepareTemporaryDetailUpdate({ updates: [] })).toThrow('非空数组')
    expect(() => f.api.prepareRename({ id: 0, name: '改名' })).toThrow('正整数ID')
    expect(() => f.api.prepareRename({ id: 11, name: ' ' })).toThrow('name不能为空')
    expect(f.calls).toHaveLength(0)
  })

  it('所有能力均有实际AI说明，且方法映射与页面注册一一闭合', () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALARY_ACCOUNTING_METHODS).sort())
    for (const definition of salaryAccountingCapabilities) {
      const contract = contracts[definition.id]
      expect(contract).toBeDefined()
      expect(Object.keys(contract!.inputs).sort()).toEqual(definition.params.map(parameter => parameter.name).sort())
      expect(contract!.boundaries.length).toBeGreaterThan(0)
      expect(contract!.consume.length).toBeGreaterThan(0)
      expect(contract!.evidence.length).toBeGreaterThan(0)
    }
  })
})
