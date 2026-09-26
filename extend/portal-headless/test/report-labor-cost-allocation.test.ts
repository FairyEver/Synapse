import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createReportLaborCostAllocationCapability,
  REPORT_LABOR_COST_ALLOCATION_METHODS,
  REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE,
  REPORT_LABOR_COST_ALLOCATION_PAGE_PATH,
  REPORT_LABOR_COST_ALLOCATION_PERMISSION,
  reportLaborCostAllocationCapabilities,
  type ReportLaborCostAllocationCreateForm,
  type ReportLaborCostAllocationUpdateForm,
} from '../src/capabilities/report-labor-cost-allocation.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  REPORT_LABOR_COST_ALLOCATION_AI_CONTRACTS as contracts,
  REPORT_LABOR_COST_ALLOCATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-labor-cost-allocation.js'

type RequestConfig = Parameters<PortalRequest>[0]

const salaryForm: ReportLaborCostAllocationCreateForm = {
  allocationType: 'salary',
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  departmentId: 201,
  departmentName: '总部-标准化单元-财务部',
  predictedPayableAmount: 12345.67,
}

const socialFundForm: ReportLaborCostAllocationCreateForm = {
  allocationType: 'socialFund',
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  departmentId: 201,
  departmentName: '总部-标准化单元-财务部',
  predictedUnitPension: 1,
  predictedUnitMedical: 2,
  predictedUnitUnemployment: 3,
  predictedUnitCriticalIllness: 4,
  predictedUnitMaternity: 5,
  predictedUnitWorkInjury: 6,
  predictedUnitSocialSecurityTotal: 16,
  predictedUnitProvidentFundTotal: 7,
}

const salaryRow = {
  id: 9001,
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  departmentId: 201,
  departmentName: '总部-标准化单元-财务部',
  predictedPayableAmount: '12345.67',
  status: 0,
  statusName: '待计提',
  extra: 'preserved',
}

const socialFundRow = {
  id: 9002,
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  departmentId: 201,
  departmentName: '总部-标准化单元-财务部',
  predictedUnitPension: '1.00',
  predictedUnitMedical: '2.00',
  predictedUnitUnemployment: '3.00',
  predictedUnitCriticalIllness: '4.00',
  predictedUnitMaternity: '5.00',
  predictedUnitWorkInjury: '6.00',
  predictedUnitSocialSecurityTotal: '16.00',
  predictedUnitProvidentFundTotal: '7.00',
  status: 0,
  statusName: '待计提',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportLaborCostAllocationCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function capturePlatform () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    const isSum = config.url?.includes('/sum')
    return {
      data: isSum
        ? { ret: 'SUCCESS', code: 0, msg: '', data: 123.45 }
        : { ret: 'SUCCESS', code: 0, msg: '', data: { list: [salaryRow], total: 1 } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
  )
  const api = createReportLaborCostAllocationCapability(config => call(REPORT_LABOR_COST_ALLOCATION_PAGE_PATH, { ...config, httpInstance: 'platform' }))
  return { api, calls }
}

describe('Portal 人力报表 → 人工成本计提分配表', () => {
  it('逐页锁定菜单、两个Tab、platform实例、权限、筛选、合计、写入口和表单规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/report/labor-cost-allocation/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/hr/report/labor-cost-allocation/[mode]/[id].vue')
    const download = read(portalRoot, 'app/portal/views/dashboard/hr/report/labor-cost-allocation/ModalContentForDownloadTemplate.vue')
    expect(menu).toContain(`path: '${REPORT_LABOR_COST_ALLOCATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${REPORT_LABOR_COST_ALLOCATION_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "apiPrefix: '/admin-api/hr/salary-cost-accrual-allocation'",
      "apiPrefix: '/admin-api/hr/social-fund-cost-accrual-allocation'",
      'config.apiPrefix}/page',
      'config.apiPrefix}/sum',
      "http.delete(`${currentConfig.value.apiPrefix}/delete/${record.id}`",
      'http.post(`${currentConfig.value.apiPrefix}/import`,',
      "input.accept = '.xml,.xlsx,.xls'",
      'useYearMonth: null',
      'organizationId: null',
      'standardUnitId: null',
      'status: null',
      "useYearMonth: useYearMonth ? useYearMonth.format('YYYY-MM') : null",
      "const statusOptions = [",
      "{ label: '待计提', value: 0 }",
      "{ label: '待月结', value: 1 }",
      "{ label: '已月结', value: 2 }",
      "const lockedStatusMessage = '财务已计提/已封账无法编辑/删除'",
      'function isAccruedOrClosed',
      'function normalizeSummaryData',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'useYearMonth: form.useYearMonth ? form.useYearMonth.format(\'YYYY-MM\') : null',
      'standardUnitName: standardUnitTreeSelectRef.value.getFullPathById(form.standardUnitId)',
      'departmentName: departmentTreeSelectRef.value.getFullPathById(form.departmentId)',
      'await http.put(`${config.apiPrefix}/update`,',
      'await http.post(`${config.apiPrefix}/create`,',
      'useYearMonth: [',
      'standardUnitId: [',
      'departmentId: [',
      'predictedPayableAmount',
      'predictedUnitProvidentFundTotal',
      'allocationType: initialAllocationType',
    ]) expect(form).toContain(fragment)
    for (const fragment of [
      'fileDownloadByStreamV2',
      "${props.apiPrefix}/download-template",
      "${props.apiPrefix}/download-template",
      'organizationId: formState.value.organizationId',
      "useYearMonth: formState.value.useYearMonth",
      'organizationId: [',
      'useYearMonth: [',
    ]) expect(download).toContain(fragment)
    expect(resolveModuleType(REPORT_LABOR_COST_ALLOCATION_PAGE_PATH).moduleType).toBe(REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE)
  })

  it('逐页核对两个Java Controller、VO、Service、DO和状态门禁', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr')
    const salaryController = read(root, 'controller/admin/laborcost/LaborCostAccrualAllocationController.java')
    const salaryPage = read(root, 'controller/admin/laborcost/vo/LaborCostAccrualAllocationPageReqVO.java')
    const salarySave = read(root, 'controller/admin/laborcost/vo/LaborCostAccrualAllocationSaveReqVO.java')
    const salaryResponse = read(root, 'controller/admin/laborcost/vo/LaborCostAccrualAllocationRespVO.java')
    const salaryService = read(root, 'service/laborcost/impl/LaborCostAccrualAllocationServiceImpl.java')
    const salaryDo = read(root, 'dal/dataobject/laborcost/LaborCostAccrualAllocationDO.java')
    const socialController = read(root, 'controller/admin/socialfundcost/SocialFundCostAccrualAllocationController.java')
    const socialPage = read(root, 'controller/admin/socialfundcost/vo/SocialFundCostAccrualAllocationPageReqVO.java')
    const socialSave = read(root, 'controller/admin/socialfundcost/vo/SocialFundCostAccrualAllocationSaveReqVO.java')
    const socialResponse = read(root, 'controller/admin/socialfundcost/vo/SocialFundCostAccrualAllocationRespVO.java')
    const socialService = read(root, 'service/socialfundcost/impl/SocialFundCostAccrualAllocationServiceImpl.java')
    const socialDo = read(root, 'dal/dataobject/socialfundcost/SocialFundCostAccrualAllocationDO.java')
    const status = read(root, 'controller/admin/laborcost/enums/LaborCostAccrualStatusEnum.java')
    for (const fragment of ['@RequestMapping({"/hr/salary-cost-accrual-allocation", "/hr/labor-cost-accrual-allocation"})', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/page")', '@GetMapping("/sum")', '@PostMapping("/import")', '@GetMapping("/download-template")']) expect(salaryController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/hr/social-fund-cost-accrual-allocation")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/page")', '@PostMapping("/import")', '@GetMapping("/download-template")']) expect(socialController).toContain(fragment)
    for (const source of [salaryPage, socialPage]) for (const field of ['useYearMonth', 'standardUnitId', 'organizationId', 'departmentId', 'status', 'roleOrganizationIdList']) expect(source).toContain(field)
    for (const field of ['useYearMonth', 'standardUnitId', 'standardUnitName', 'departmentId', 'departmentName', 'predictedPayableAmount']) expect(salarySave + salaryResponse + salaryDo).toContain(field)
    for (const field of ['useYearMonth', 'standardUnitId', 'standardUnitName', 'departmentId', 'departmentName', 'predictedUnitPension', 'predictedUnitMedical', 'predictedUnitUnemployment', 'predictedUnitCriticalIllness', 'predictedUnitMaternity', 'predictedUnitWorkInjury', 'predictedUnitSocialSecurityTotal', 'predictedUnitProvidentFundTotal']) expect(socialSave + socialResponse + socialDo).toContain(field)
    for (const source of [salaryService, socialService]) for (const fragment of ['validateCreateDuplicate', 'validateEditable', 'PENDING_ACCRUAL', 'mapper.insert', 'mapper.updateById', 'mapper.deleteById']) expect(source).toContain(fragment)
    for (const fragment of ['PENDING_ACCRUAL(0', 'PENDING_MONTH_END(1', 'MONTH_CLOSED(2', 'isLocked']) expect(status).toContain(fragment)
  })

  it('工资Tab并行读取page和sum，社保Tab按当前页计算合计并保留默认筛选', async () => {
    const salary = fixture([{ list: [salaryRow], total: 1 }, 12345.67])
    await expect(salary.api.list({ allocationType: 'salary', useYearMonth: '2026-09', organizationId: 101, standardUnitId: 101, status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [salaryRow], total: 1, summary: { predictedPayableAmount: 12345.67 } })
    expect(salary.calls).toEqual([
      { url: '/hr/salary-cost-accrual-allocation/page', method: 'get', params: { order: '', orderField: '', useYearMonth: '2026-09', organizationId: 101, standardUnitId: 101, status: 0, pageNo: 2, pageSize: 50 } },
      { url: '/hr/salary-cost-accrual-allocation/sum', method: 'get', params: { order: '', orderField: '', useYearMonth: '2026-09', organizationId: 101, standardUnitId: 101, status: 0, pageNo: 2, pageSize: 50 } },
    ])
    const social = fixture([{ list: [socialFundRow], total: 1 }])
    await expect(social.api.list({ allocationType: 'socialFund' })).resolves.toMatchObject({ total: 1, summary: { predictedUnitPension: 1, predictedUnitSocialSecurityTotal: 16, predictedUnitProvidentFundTotal: 7 } })
    expect(social.calls).toHaveLength(1)
    const defaults = fixture([{ list: [], total: 0 }, 0])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0, summary: { predictedPayableAmount: 0 } })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', useYearMonth: null, organizationId: null, standardUnitId: null, status: null, pageNo: 1, pageSize: 20 })
  })

  it('新建、编辑、删除按两个Tab选择端点，状态锁定在请求前生效', async () => {
    const f = fixture([9003, true, true])
    const created = f.api.prepareCreate(salaryForm)
    expect(created.draft).toMatchObject({ allocationType: 'salary', useYearMonth: '2026-09', standardUnitId: 101, departmentId: 201, predictedPayableAmount: 12345.67 })
    await expect(f.api.create(created)).resolves.toBe(9003)
    const updateForm: ReportLaborCostAllocationUpdateForm = { ...salaryForm, id: 9003, status: 0 }
    const updated = f.api.prepareUpdate(updateForm)
    expect(updated.draft).toMatchObject({ allocationType: 'salary', id: 9003, status: 0, predictedPayableAmount: 12345.67 })
    await expect(f.api.update(updated)).resolves.toBe(true)
    const removed = f.api.prepareRemove({ allocationType: 'salary', id: 9003, currentStatus: 0 })
    await expect(f.api.remove(removed)).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/hr/salary-cost-accrual-allocation/create', method: 'post', data: { useYearMonth: '2026-09', standardUnitId: 101, standardUnitName: '总部-标准化单元', departmentId: 201, departmentName: '总部-标准化单元-财务部', predictedPayableAmount: 12345.67 } },
      { url: '/hr/salary-cost-accrual-allocation/update', method: 'put', data: { useYearMonth: '2026-09', standardUnitId: 101, standardUnitName: '总部-标准化单元', departmentId: 201, departmentName: '总部-标准化单元-财务部', predictedPayableAmount: 12345.67, id: 9003 } },
      { url: '/hr/salary-cost-accrual-allocation/delete/9003', method: 'delete' },
    ])
    const social = fixture([9004])
    const socialDraft = social.api.prepareCreate(socialFundForm)
    await expect(social.api.create(socialDraft)).resolves.toBe(9004)
    expect(social.calls[0]?.url).toBe('/hr/social-fund-cost-accrual-allocation/create')
    expect(social.calls[0]?.data).toMatchObject({ predictedUnitPension: 1, predictedUnitProvidentFundTotal: 7 })
    expect(() => f.api.prepareUpdate({ ...salaryForm, id: 9003, status: 1 })).toThrow('财务已计提')
    expect(() => f.api.prepareRemove({ allocationType: 'salary', id: 9003, currentStatus: 2 })).toThrow('财务已计提')
    expect(f.api.prepareCreate({ ...salaryForm, allocationType: 'socialFund', predictedPayableAmount: undefined, ...socialFundForm }).draft.allocationType).toBe('socialFund')
  })

  it('模板下载和导入复刻Portal文件规则', async () => {
    const response = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
    const f = fixture([response, '导入成功'])
    await expect(f.api.downloadTemplate({ allocationType: 'socialFund', organizationId: 101, useYearMonth: '2026-09' })).resolves.toMatchObject({ allocationType: 'socialFund', fileName: '社保公积金计提分配模板.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[0]).toEqual({ url: '/hr/social-fund-cost-accrual-allocation/download-template', method: 'get', params: { organizationId: 101, useYearMonth: '2026-09' }, responseType: 'arraybuffer' })
    expect(f.api.prepareImport({ allocationType: 'salary', fileName: '人工成本.xlsx', base64: 'AQID' })).toEqual({ allocationType: 'salary', fileName: '人工成本.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.importExcel({ allocationType: 'salary', fileName: '人工成本.xlsx', base64: 'AQID' })).resolves.toBe('导入成功')
    expect(f.calls[1]?.url).toBe('/hr/salary-cost-accrual-allocation/import')
    expect(f.calls[1]?.method).toBe('post')
    expect(f.calls[1]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[1]?.data).toBeInstanceOf(FormData)
    expect(() => f.api.prepareImport({ fileName: 'bad.txt', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '人工成本.xlsx', base64: 'bad' })).toThrow('Base64')
  })

  it('坏输入和坏响应不会静默降级或发请求', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...salaryForm, useYearMonth: '2026-13' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareCreate({ ...salaryForm, standardUnitId: 0 })).toThrow('标准化单元ID')
    expect(() => f.api.prepareCreate({ ...salaryForm, predictedPayableAmount: '' })).toThrow('predictedPayableAmount')
    expect(() => f.api.prepareCreate({ ...socialFundForm, predictedUnitMedical: '' })).toThrow('predictedUnitMedical')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.list({ status: 3 as never })).rejects.toThrow('状态')
    await expect(f.api.list({ allocationType: 'other' as never })).rejects.toThrow('allocationType')
    await expect(fixture([{ list: null, total: 0 }, 0]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
    expect(f.calls).toHaveLength(0)
  })

  it('platform请求补admin-api、module-type=14且不把allocationType发给后端', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list({ allocationType: 'salary' })).resolves.toMatchObject({ total: 1, summary: { predictedPayableAmount: 123.45 } })
    expect(captured.calls[0]?.url?.split('?')[0]).toBe('/admin-api/hr/salary-cost-accrual-allocation/page')
    expect(captured.calls[1]?.url?.split('?')[0]).toBe('/admin-api/hr/salary-cost-accrual-allocation/sum')
    expect(captured.calls[0]?.headers?.get('module-type')).toBe(String(REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE))
    expect(captured.calls[0]?.params).not.toHaveProperty('allocationType')
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(reportLaborCostAllocationCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_LABOR_COST_ALLOCATION_METHODS))
    expect(reportLaborCostAllocationCapabilities.every(item => item.pagePath === REPORT_LABOR_COST_ALLOCATION_PAGE_PATH && item.permission === REPORT_LABOR_COST_ALLOCATION_PERMISSION && item.moduleType === REPORT_LABOR_COST_ALLOCATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(AI_CONTRACTS['report-labor-cost-allocation-list']).toBe(contracts['report-labor-cost-allocation-list'])
    expect(METHOD_CONTRACTS['reportLaborCostAllocation.list']).toBe(methodContracts['reportLaborCostAllocation.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-labor-cost-allocation-list' && item.sdkPath === 'reportLaborCostAllocation.list')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-labor-cost-allocation-import' && item.sdkPath === 'reportLaborCostAllocation.importExcel')).toBe(true)
    expect(contracts['report-labor-cost-allocation-create']?.steps[0]?.capabilityId).toBe('report-labor-cost-allocation-list')
    expect(contracts['report-labor-cost-allocation-list']?.boundaries.join('\n')).toContain('module-type=14')
  })
})
