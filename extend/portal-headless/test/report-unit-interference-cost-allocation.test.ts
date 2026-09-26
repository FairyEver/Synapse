import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createReportUnitInterferenceCostAllocationCapability,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION,
  reportUnitInterferenceCostAllocationCapabilities,
  type ReportUnitInterferenceCostAllocationCreateForm,
} from '../src/capabilities/report-unit-interference-cost-allocation.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'
import {
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_AI_CONTRACTS as contracts,
  REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-report-unit-interference-cost-allocation.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ReportUnitInterferenceCostAllocationCreateForm = {
  allocateDeptId: 101,
  useYearMonth: '2026-09',
  staffId: 202,
  name: '张三',
  items: [
    { receiveDeptId: 301, salaryAmount: '100.10', insuranceAmount: null, welfareAmount: 2, otherAmount: '', providentFundAmount: 0.45 },
    { receiveDeptId: 302, salaryAmount: 3.4, insuranceAmount: 4.56, welfareAmount: 0, otherAmount: 0, providentFundAmount: 1 },
  ],
}

const firstItem = form.items[0]!
const secondItem = form.items[1]!

const row = {
  id: 7001,
  allocateDeptId: 101,
  allocateDeptName: '分配部门',
  useYearMonth: '2026-09',
  name: '张三',
  staffId: 202,
  receiveDeptId: 301,
  receiveDeptName: '接收部门一',
  salaryAmount: '100.10',
  insuranceAmount: '2.00',
  welfareAmount: 3,
  otherAmount: null,
  providentFundAmount: 4.56,
  status: 1,
  processInstanceId: '9001',
  createTime: '2026-09-24 10:00:00',
  updateTime: '2026-09-24 10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createReportUnitInterferenceCostAllocationCapability(request), calls }
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
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { list: [row], total: 1 } },
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
  const api = createReportUnitInterferenceCostAllocationCapability(config => call(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH, { ...config, httpInstance: 'platform' }))
  return { api, calls }
}

describe('Portal 人力报表 → 单元间人员混用费用分摊表', () => {
  it('逐页锁定菜单、筛选、当前页合计、流程动作和表单入口', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/report/unit-interference-cost-allocation/list.vue')
    const formPage = read(portalRoot, 'app/portal/views/simple/hr/form/014/page/pc/edit/index.vue')
    const detailPage = read(portalRoot, 'app/portal/views/simple/hr/form/014/page/pc/detail/index.vue')
    const staff = read(portalRoot, 'app/portal/components/portal/hxr/select/staff/index.vue')
    expect(menu).toContain(`path: '${REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "http.get('/admin-api/hr/unit-staff-salary-expense/page'",
      'getDataListIsPage: true',
      'name: null',
      'allocateDeptId: null',
      'receiveDeptId: null',
      'useYearMonth: null',
      'status: null',
      "useYearMonth: useYearMonth ? useYearMonth.format('YYYY-MM')",
      "numberFormat(total, 2, true, '0.00')",
      'record.status === 3',
      "http.post(`/admin-api/hr/unit-staff-salary-expense/submit/${record.id}`)",
      "http.post(`/admin-api/hr/unit-staff-salary-expense/cancel/${record.id}`)",
      'createFlowFormByInstanceId',
      'goFlowFormDetailByInstanceId',
      "path: 'simple/hr/form/014'",
      'record.processInstanceId',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "bpmProcessDefineKey: 'unit_staff_salary_expense'",
      'allocateDeptId: null',
      'useYearMonth: null',
      'staffId: null',
      'items: [createItem()]',
      'onlySave: 0',
      "http.post('/admin-api/hr/unit-staff-salary-expense/create'",
      'normalizeAmount',
      ':max="MAX_AMOUNT"',
      '接收部门不能与分配部门相同',
      '接收部门不能重复',
      "http.get('/admin-api/hr/unit-staff-salary-expense/get'",
    ]) expect(formPage).toContain(fragment)
    expect(detailPage).toContain("http.get('/admin-api/hr/unit-staff-salary-expense/get'")
    for (const fragment of [
      "http.get('/org/staff/staffByPage'",
      'pageSize: 200',
      'maxPages: 100',
      'getNameByValue',
    ]) expect(staff).toContain(fragment)
    expect(reportUnitInterferenceCostAllocationCapabilities.map(item => item.id)).toEqual(Object.keys(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS))
    expect(reportUnitInterferenceCostAllocationCapabilities.every(item => item.pagePath === REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH && item.permission === REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PERMISSION && item.moduleType === REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_PAGE_PATH).moduleType).toBe(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE)
  })

  it('逐字段核对Java Controller、VO、Service、Mapper和权限范围', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz')
    const java = (path: string) => read(join(root, 'src/main/java'), path)
    const controller = java('com/wdbc/erp/module/hr/controller/admin/unitstaffsalaryexpense/UnitStaffSalaryExpenseController.java')
    const saveVo = java('com/wdbc/erp/module/hr/controller/admin/unitstaffsalaryexpense/vo/UnitStaffSalaryExpenseSaveReqVO.java')
    const pageVo = java('com/wdbc/erp/module/hr/controller/admin/unitstaffsalaryexpense/vo/UnitStaffSalaryExpensePageReqVO.java')
    const responseVo = java('com/wdbc/erp/module/hr/controller/admin/unitstaffsalaryexpense/vo/UnitStaffSalaryExpenseRespVO.java')
    const service = java('com/wdbc/erp/module/hr/service/unitstaffsalaryexpense/UnitStaffSalaryExpenseServiceImpl.java')
    const mapper = java('com/wdbc/erp/module/hr/dal/mysql/unitstaffsalaryexpense/UnitStaffSalaryExpenseMapper.java')
    for (const fragment of ['@RequestMapping("/hr/unit-staff-salary-expense")', '@PostMapping("/create")', '@GetMapping("/get")', '@GetMapping("/page")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@PostMapping("/import")']) expect(controller).toContain(fragment)
    for (const field of ['allocateDeptId', 'useYearMonth', 'staffId', 'onlySave', 'items', 'salaryAmount', 'insuranceAmount', 'welfareAmount', 'otherAmount', 'providentFundAmount']) expect(saveVo).toContain(field)
    for (const field of ['name', 'allocateDeptId', 'receiveDeptId', 'useYearMonth', 'status', 'roleOrganizationIdList']) expect(pageVo).toContain(field)
    for (const field of ['id', 'allocateDeptId', 'receiveDeptId', 'name', 'staffId', 'useYearMonth', 'totalAmount', 'status', 'processInstanceId']) expect(responseVo).toContain(field)
    for (const fragment of ['getOrgIdListByModuleType', 'setRoleOrganizationIdList', 'onlySave', 'insertBatch', 'PROCESS_KEY']) expect(service).toContain(fragment)
    for (const fragment of ['likeIfPresent(UnitStaffSalaryExpenseDO::getName', 'eqIfPresent(UnitStaffSalaryExpenseDO::getUseYearMonth', 'inIfPresent(UnitStaffSalaryExpenseDO::getAllocateDeptId']) expect(mapper).toContain(fragment)
  })

  it('按Portal顺序发送列表，返回当前页五项金额合计', async () => {
    const f = fixture([{ list: [row], total: 1 }])
    await expect(f.api.list({ name: '张三', allocateDeptId: 101, receiveDeptId: 301, useYearMonth: '2026-09', status: 1, pageNo: 2, pageSize: 50 })).resolves.toEqual({
      list: [expect.objectContaining(row)],
      total: 1,
      summary: { salaryAmount: '100.10', insuranceAmount: '2.00', welfareAmount: '3.00', otherAmount: '0.00', providentFundAmount: '4.56' },
    })
    expect(f.calls[0]).toEqual({
      url: '/hr/unit-staff-salary-expense/page',
      method: 'get',
      params: { order: '', orderField: '', name: '张三', allocateDeptId: 101, receiveDeptId: 301, useYearMonth: '2026-09', status: 1, pageNo: 2, pageSize: 50 },
    })
    const defaults = fixture([{ list: [], total: 0 }])
    await expect(defaults.api.list()).resolves.toMatchObject({ list: [], total: 0, summary: { salaryAmount: '0.00', otherAmount: '0.00' } })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', name: null, allocateDeptId: null, receiveDeptId: null, useYearMonth: null, status: null, pageNo: 1, pageSize: 20 })
  })

  it('发送详情、组织树和关键字员工候选请求，不复制全量员工拉取', async () => {
    const f = fixture([row, [{ id: 101, name: '分配部门', isStandardUnit: 0, children: [{ id: 301, name: '接收部门', isStandardUnit: 1 }] }], { list: [{ id: 202, name: '张三', staffCode: 'S202' }], total: 1 }])
    await expect(f.api.detail({ id: 7001 })).resolves.toMatchObject({ id: 7001, receiveDeptId: 301 })
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 101, name: '分配部门', isStandardUnit: false, children: [{ id: 301, name: '接收部门', isStandardUnit: true }] }])
    await expect(f.api.staffSearch({ keyword: '张', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ id: 202, name: '张三', staffCode: 'S202', label: '张三(S202)' }], total: 1 })
    expect(f.calls).toEqual([
      { url: '/hr/unit-staff-salary-expense/get', method: 'get', params: { id: 7001 } },
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
      { url: '/org/staff/staffByPage', method: 'get', params: { name: '张', pageNo: 2, pageSize: 50 } },
    ])
    await expect(fixture([null]).api.detail({ id: 7001 })).resolves.toBeNull()
    await expect(f.api.staffSearch({ keyword: '  ' })).rejects.toThrow('keyword不能为空')
  })

  it('复刻表单提交体、金额归一化、同/重复部门门禁和驳回重发门禁', async () => {
    const f = fixture([7001])
    const prepared = f.api.prepareCreate(form)
    expect(prepared).toEqual({
      draft: {
        allocateDeptId: 101,
        useYearMonth: '2026-09',
        staffId: 202,
        name: '张三',
        onlySave: 0,
        items: [
          { receiveDeptId: 301, salaryAmount: 100.1, insuranceAmount: 0, welfareAmount: 2, otherAmount: 0, providentFundAmount: 0.45 },
          { receiveDeptId: 302, salaryAmount: 3.4, insuranceAmount: 4.56, welfareAmount: 0, otherAmount: 0, providentFundAmount: 1 },
        ],
      },
    })
    await expect(f.api.create(prepared)).resolves.toBe(7001)
    expect(f.calls[0]).toEqual({ url: '/hr/unit-staff-salary-expense/create', method: 'post', data: prepared.draft })
    expect(f.calls[0]?.data).not.toHaveProperty('status')
    expect(f.calls[0]?.data).not.toHaveProperty('totalAmount')

    expect(() => f.api.prepareCreate({ ...form, items: [] })).toThrow('接收部门')
    expect(() => f.api.prepareCreate({ ...form, items: [{ ...firstItem, receiveDeptId: 101 }] })).toThrow('不能与分配部门相同')
    expect(() => f.api.prepareCreate({ ...form, items: [firstItem, { ...secondItem, receiveDeptId: 301 }] })).toThrow('不能重复')
    expect(() => f.api.prepareCreate({ ...form, useYearMonth: '2026-13' })).toThrow('YYYY-MM')
    expect(() => f.api.prepareCreate({ ...form, name: '' })).toThrow('员工姓名')
    expect(() => f.api.prepareCreate({ ...form, items: [{ ...firstItem, salaryAmount: -1 }] })).toThrow('不小于0')
    expect(() => f.api.prepareCreate({ ...form, items: [{ ...firstItem, salaryAmount: 10_000_000_000 }] })).toThrow('最多10位')
    expect(() => f.api.prepareCreate({ ...form, items: [{ ...firstItem, salaryAmount: '1.234' }] })).toThrow('两位小数')

    expect(f.api.prepareRecreate({ id: 7001, processInstanceId: '9001', currentStatus: 3 })).toEqual({ id: 7001, processInstanceId: '9001', currentStatus: 3 })
    expect(() => f.api.prepareRecreate({ id: 7001, processInstanceId: '9001', currentStatus: 2 })).toThrow('已驳回')
    expect(() => f.api.prepareRecreate({ id: 7001, processInstanceId: '', currentStatus: 3 })).toThrow('流程实例ID')
  })

  it('按Portal状态门禁发送提交/撤销动作，且不发送body并要求true成功回执', async () => {
    const f = fixture([true, true])
    const submitDraft = f.api.prepareSubmit({ id: 7001, currentStatus: 0 })
    expect(submitDraft).toEqual({ id: 7001, currentStatus: 0 })
    await expect(f.api.submit(submitDraft)).resolves.toBe(true)

    const cancelDraft = f.api.prepareCancel({ id: 7001, currentStatus: 1 })
    expect(cancelDraft).toEqual({ id: 7001, currentStatus: 1 })
    await expect(f.api.cancel(cancelDraft)).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/hr/unit-staff-salary-expense/submit/7001', method: 'post' },
      { url: '/hr/unit-staff-salary-expense/cancel/7001', method: 'post' },
    ])
  })

  it('拒绝绕过提交/撤销状态门禁、非法ID和非true成功回执', async () => {
    const f = fixture([false])
    expect(() => f.api.prepareSubmit({ id: 7001, currentStatus: 1 })).toThrow('状态为0')
    expect(() => f.api.prepareCancel({ id: 7001, currentStatus: 0 })).toThrow('状态为1')
    expect(() => f.api.prepareSubmit({ id: 0, currentStatus: 0 })).toThrow('记录ID')
    await expect(f.api.submit({ id: 7001, currentStatus: 0 })).rejects.toThrow('不是true')
    expect(f.calls).toEqual([{ url: '/hr/unit-staff-salary-expense/submit/7001', method: 'post' }])
    await expect(f.api.cancel({ id: 7001, currentStatus: 0 } as never)).rejects.toThrow('状态为1')
  })

  it('坏响应和分页参数会失败，而不是静默改成空数据', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ pageSize: 30 })).rejects.toThrow('10、20、50或100')
    await expect(fixture([{ list: [], total: 0 }]).api.list({ status: 5 })).rejects.toThrow('状态')
    await expect(fixture([{}]).api.organizationTree()).rejects.toThrow('不是数组')
    await expect(fixture([{ list: [{ id: 1 }], total: 1 }]).api.staffSearch({ keyword: '张' })).rejects.toThrow('name')
  })

  it('platform请求补admin-api和module-type=14', async () => {
    const captured = capturePlatform()
    await expect(captured.api.list({ allocateDeptId: 101, useYearMonth: '2026-09' })).resolves.toMatchObject({ total: 1 })
    expect(captured.calls[0]?.url?.split('?')[0]).toBe('/admin-api/hr/unit-staff-salary-expense/page')
    expect(captured.calls[0]?.headers?.get('module-type')).toBe(String(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_MODULE_TYPE))
    expect(captured.calls[0]?.url).toContain('allocateDeptId=101')
    expect(captured.calls[0]?.url).toContain('useYearMonth=2026-09')
  })

  it('能力、方法绑定和AI契约完整登记', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(REPORT_UNIT_INTERFERENCE_COST_ALLOCATION_METHODS).map(method => `reportUnitInterferenceCostAllocation.${method}`))
    expect(AI_CONTRACTS['report-unit-interference-cost-allocation-list']).toBe(contracts['report-unit-interference-cost-allocation-list'])
    expect(METHOD_CONTRACTS['reportUnitInterferenceCostAllocation.list']).toBe(methodContracts['reportUnitInterferenceCostAllocation.list'])
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-unit-interference-cost-allocation-prepare-create' && item.sdkPath === 'reportUnitInterferenceCostAllocation.prepareCreate')).toBe(true)
    expect(CAPABILITY_BINDINGS.some(item => item.capabilityId === 'report-unit-interference-cost-allocation-create' && item.sdkPath === 'reportUnitInterferenceCostAllocation.create')).toBe(true)
    expect(contracts['report-unit-interference-cost-allocation-create']?.steps[0]?.capabilityId).toBe('report-unit-interference-cost-allocation-list')
    expect(contracts['report-unit-interference-cost-allocation-list']?.boundaries.join('\n')).toContain('module-type=14')
    expect(contracts['report-unit-interference-cost-allocation-prepare-create']?.output.fields.some(field => field.path === 'draft.items[].providentFundAmount')).toBe(true)
  })
})
