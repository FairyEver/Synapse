import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createReportLeadershipProfitSalaryCapability,
  REPORT_LEADERSHIP_PROFIT_SALARY_METHODS,
  REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE,
  REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH,
  REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION,
  reportLeadershipProfitSalaryCapabilities,
  type ReportLeadershipProfitSalaryCreateForm,
} from '../src/capabilities/report-leadership-profit-salary.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  REPORT_LEADERSHIP_PROFIT_SALARY_AI_CONTRACTS as contracts,
  REPORT_LEADERSHIP_PROFIT_SALARY_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-leadership-profit-salary.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ReportLeadershipProfitSalaryCreateForm = {
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  provisionAmount: 12345.67,
}

const row = {
  id: 7001,
  useYearMonth: '2026-09',
  standardUnitId: 101,
  standardUnitName: '总部-标准化单元',
  costCenterId: 201,
  costCenterName: '总部成本中心',
  name: '历史字段',
  provisionMonthLowLine: '1.00',
  provisionMonthMidLine: '2.00',
  provisionMonthHighLine: '3.00',
  provisionAmount: '12345.67',
  status: 0,
  createTime: '2026-09-24 10:00:00',
  extra: 'preserved',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportLeadershipProfitSalaryCapability(request), calls }
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
    const isTemplate = config.url?.includes('/sys/oss/download')
    return {
      data: isTemplate
        ? new Uint8Array([1, 2, 3]).buffer
        : { ret: 'SUCCESS', code: 0, msg: '', data: { list: [row], total: 1 } },
      status: 200,
      statusText: 'OK',
      headers: isTemplate ? { 'content-type': 'application/octet-stream' } : {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
  )
  const api = createReportLeadershipProfitSalaryCapability(config => call(REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH, { ...config, httpInstance: 'platform' }))
  return { api, calls }
}

describe('Portal 人力报表 → 领导利润工资计提表', () => {
  it('逐页锁定菜单、筛选、表单提交、状态动作、模板和导入规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/report/leadership-profit-salary/list.vue')
    const formPage = read(portalRoot, 'app/portal/views/dashboard/hr/report/leadership-profit-salary/[mode]/[id].vue')
    expect(menu).toContain(`path: '${REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "http.get('/admin-api/hr/leader-profit-salary-provision/page'",
      'getDataListIsPage: true',
      'standardUnitId: null',
      'useYearMonth: null',
      "useYearMonth: useYearMonth ? useYearMonth.format('YYYY-MM')",
      'record.status !== 1',
      'http.delete(`/admin-api/hr/leader-profit-salary-provision/delete/${record.id}`',
      'newPageWithPlatformAuth',
      "fileName: '领导利润工资计提模板'",
      "input.accept = '.xml,.xlsx,.xls'",
      "http.post('/admin-api/hr/leader-profit-salary-provision/import'",
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain("download-template")
    for (const fragment of [
      'bridge.id',
      'bridge.useYearMonth',
      'bridge.standardUnitId',
      'bridge.provisionAmount',
      'standardUnitName: standardUnitTreeSelectRef.value.getLabelByValue(form.standardUnitId)',
      "useYearMonth: form.useYearMonth.format('YYYY-MM')",
      "await http.put('/admin-api/hr/leader-profit-salary-provision/update', formSubmit)",
      "await http.post('/admin-api/hr/leader-profit-salary-provision/create', formSubmit)",
      'useYearMonth: [',
      'standardUnitId: [',
      'provisionAmount: [',
      ':precision="2"',
      ':min="0"',
      ':max="9999999999.99"',
    ]) expect(formPage).toContain(fragment)
    expect(formPage).not.toContain("http.get('/admin-api/hr/leader-profit-salary-provision/get'")
    expect(reportLeadershipProfitSalaryCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS))
    expect(reportLeadershipProfitSalaryCapabilities.every(item => item.pagePath === REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH && item.permission === REPORT_LEADERSHIP_PROFIT_SALARY_PERMISSION && item.moduleType === REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(REPORT_LEADERSHIP_PROFIT_SALARY_PAGE_PATH).moduleType).toBe(REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE)
  })

  it('逐字段核对Java Controller、VO、Service、Mapper和组织权限', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz')
    const controller = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/controller/admin/leaderprofitsalaryprovision/LeaderProfitSalaryProvisionController.java')
    const pageVo = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/controller/admin/leaderprofitsalaryprovision/vo/LeaderProfitSalaryProvisionPageReqVO.java')
    const saveVo = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/controller/admin/leaderprofitsalaryprovision/vo/LeaderProfitSalaryProvisionSaveReqVO.java')
    const responseVo = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/controller/admin/leaderprofitsalaryprovision/vo/LeaderProfitSalaryProvisionRespVO.java')
    const importVo = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/controller/admin/leaderprofitsalaryprovision/vo/LeaderProfitSalaryProvisionImportVO.java')
    const service = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/service/leaderprofitsalaryprovision/LeaderProfitSalaryProvisionServiceImpl.java')
    const mapper = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/dal/mysql/leaderprofitsalaryprovision/LeaderProfitSalaryProvisionMapper.java')
    const dataObject = read(join(root, 'src/main/java'), 'com/wdbc/erp/module/hr/dal/dataobject/leaderprofitsalaryprovision/LeaderProfitSalaryProvisionDO.java')
    for (const fragment of ['@RequestMapping("/hr/leader-profit-salary-provision")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/get")', '@GetMapping("/page")', '@PostMapping("/import")']) expect(controller).toContain(fragment)
    expect(controller).not.toContain('download-template')
    for (const field of ['useYearMonth', 'standardUnitId', 'roleOrganizationIdList']) expect(pageVo).toContain(field)
    for (const field of ['useYearMonth', 'standardUnitId', 'standardUnitName', 'provisionAmount']) expect(saveVo + dataObject).toContain(field)
    for (const field of ['id', 'useYearMonth', 'standardUnitId', 'standardUnitName', 'provisionAmount', 'status']) expect(responseVo).toContain(field)
    for (const field of ['useYearMonth', 'standardUnitName', 'provisionAmount']) expect(importVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'setRoleOrganizationIdList', 'fillStandardUnitFullPath', 'getStatus() == 1', 'insertBatch', 'normalizeImportOrgPath']) expect(service).toContain(fragment)
    for (const fragment of ['eqIfPresent(LeaderProfitSalaryProvisionDO::getUseYearMonth', 'eqIfPresent(LeaderProfitSalaryProvisionDO::getStandardUnitId', 'inIfPresent(LeaderProfitSalaryProvisionDO::getStandardUnitId, reqVO.getRoleOrganizationIdList())']) expect(mapper).toContain(fragment)
  })

  it('按Portal顺序发送列表和默认筛选，保留页面实际字段', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ standardUnitId: 101, useYearMonth: '2026-09', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [expect.objectContaining(row)], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/hr/leader-profit-salary-provision/page',
      method: 'get',
      params: { order: '', orderField: '', standardUnitId: 101, useYearMonth: '2026-09', pageNo: 2, pageSize: 50 },
    })
    const defaults = fixture([{ list: [], total: 0 }])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', standardUnitId: null, useYearMonth: null, pageNo: 1, pageSize: 20 })
  })

  it('新建、编辑、删除、模板下载和导入复刻Portal载荷与顺序', async () => {
    const fileResponse = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } }
    const f = fixture([7001, true, true, fileResponse, '导入成功'])
    const create = f.api.prepareCreate(form)
    expect(create.draft).toEqual(form)
    await expect(f.api.create(create)).resolves.toBe(7001)
    expect(f.calls[0]).toEqual({ url: '/hr/leader-profit-salary-provision/create', method: 'post', data: form })

    const update = f.api.prepareUpdate({ ...form, id: 7001, status: 0 })
    expect(update.draft).toMatchObject({ ...form, id: 7001, status: 0 })
    await expect(f.api.update(update)).resolves.toBe(true)
    expect(f.calls[1]).toEqual({ url: '/hr/leader-profit-salary-provision/update', method: 'put', data: { ...form, id: 7001 } })

    const remove = f.api.prepareRemove({ id: 7001, currentStatus: 0 })
    expect(remove).toEqual({ id: 7001, currentStatus: 0 })
    await expect(f.api.remove(remove)).resolves.toBe(true)
    expect(f.calls[2]).toEqual({ url: '/hr/leader-profit-salary-provision/delete/7001', method: 'delete' })

    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '领导利润工资计提模板.xlsx', base64: 'AQID', byteLength: 3 })
    expect(f.calls[3]).toEqual({ url: '/sys/oss/download', method: 'get', params: { fileName: '领导利润工资计提模板' }, responseType: 'arraybuffer' })

    expect(f.api.prepareImport({ fileName: '领导利润工资计提.xlsx', base64: 'AQID' })).toEqual({ fileName: '领导利润工资计提.xlsx', contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteLength: 3 })
    await expect(f.api.importExcel({ fileName: '领导利润工资计提.xlsx', base64: 'AQID' })).resolves.toBe('导入成功')
    expect(f.calls[4]?.url).toBe('/hr/leader-profit-salary-provision/import')
    expect(f.calls[4]?.method).toBe('post')
    expect(f.calls[4]?.headers).toEqual({ 'Content-Type': 'multipart/form-data' })
    expect(f.calls[4]?.data).toBeInstanceOf(FormData)
  })

  it('复现表单金额规则、已月结门禁和坏输入反证', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, provisionAmount: 0 })).not.toThrow()
    expect(() => f.api.prepareCreate({ ...form, provisionAmount: -1 })).toThrow('不能小于')
    expect(() => f.api.prepareCreate({ ...form, provisionAmount: 10_000_000_000 })).toThrow('不能大于')
    expect(() => f.api.prepareCreate({ ...form, useYearMonth: '2026-13' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareCreate({ ...form, standardUnitId: 0 })).toThrow('组织ID')
    expect(() => f.api.prepareCreate({ ...form, provisionAmount: '' })).toThrow('利润计提金额')
    expect(() => f.api.prepareUpdate({ ...form, id: 7001, status: 1 })).toThrow('已月结')
    expect(() => f.api.prepareRemove({ id: 7001, currentStatus: 1 })).toThrow('已月结')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(f.api.list({ standardUnitId: 0 })).rejects.toThrow('standardUnitId')
    expect(() => f.api.prepareImport({ fileName: 'bad.txt', base64: 'AQID' })).toThrow('扩展名')
    expect(() => f.api.prepareImport({ fileName: '领导利润工资计提.xlsx', base64: 'bad' })).toThrow('Base64')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.downloadTemplate()).rejects.toThrow('空文件')
    expect(f.calls).toHaveLength(0)
  })

  it('platform请求补admin-api和module-type=14，且不发送SDK内部状态字段', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list({ standardUnitId: 101, useYearMonth: '2026-09' })).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url?.split('?')[0]).toBe('/admin-api/hr/leader-profit-salary-provision/page')
    expect(captured.calls[0]?.headers?.get('module-type')).toBe(String(REPORT_LEADERSHIP_PROFIT_SALARY_MODULE_TYPE))
    expect(captured.calls[0]?.url).toContain('standardUnitId=101')
    expect(captured.calls[0]?.url).toContain('useYearMonth=2026-09')

    const write = fixture([true])
    await expect(write.api.update({ draft: { ...form, provisionAmount: 12345.67, id: 7001, status: 0 } })).resolves.toBe(true)
    expect(write.calls[0]?.data).not.toHaveProperty('status')
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_LEADERSHIP_PROFIT_SALARY_METHODS).map(method => `reportLeadershipProfitSalary.${method}`))
    expect(AI_CONTRACTS['report-leadership-profit-salary-list']).toBe(contracts['report-leadership-profit-salary-list'])
    expect(METHOD_CONTRACTS['reportLeadershipProfitSalary.list']).toBe(methodContracts['reportLeadershipProfitSalary.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-leadership-profit-salary-prepare-create' && item.sdkPath === 'reportLeadershipProfitSalary.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-leadership-profit-salary-import' && item.sdkPath === 'reportLeadershipProfitSalary.importExcel')).toBe(true)
    expect(contracts['report-leadership-profit-salary-create']?.steps[0]?.capabilityId).toBe('report-leadership-profit-salary-list')
    expect(contracts['report-leadership-profit-salary-list']?.boundaries.join('\n')).toContain('module-type=14')
    expect(contracts['report-leadership-profit-salary-list']?.output.fields.some(field => field.path === 'list[].provisionAmount')).toBe(true)
    expect(contracts['report-leadership-profit-salary-prepare-update']?.steps[0]?.mapping?.draft).toBe('result.draft')
  })
})
