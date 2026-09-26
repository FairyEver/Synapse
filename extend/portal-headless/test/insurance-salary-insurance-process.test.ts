import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInsuranceSalaryInsuranceProcessCapability,
  INSURANCE_SALARY_INSURANCE_PROCESS_MODULE_TYPE,
  INSURANCE_SALARY_INSURANCE_PROCESS_METHODS,
  INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH,
  INSURANCE_SALARY_INSURANCE_PROCESS_PERMISSION,
  insuranceSalaryInsuranceProcessCapabilities,
  type InsuranceSalaryInsuranceProcessRow,
} from '../src/capabilities/insurance-salary-insurance-process.js'
import {
  INSURANCE_SALARY_INSURANCE_PROCESS_AI_CONTRACTS as contracts,
  INSURANCE_SALARY_INSURANCE_PROCESS_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-insurance-salary-insurance-process.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInsuranceSalaryInsuranceProcessCapability(request), calls }
}

const pageRow = { staffCode: 1001, name: '张三', insuranceStatus: 1, staffStatus: 1 }
const actionRow: InsuranceSalaryInsuranceProcessRow = {
  id: 9, staffCode: 1001, name: '张三', organizationPath: '总部/财务', postName: '会计', idCard: 'x', householdType: 1, employmentType: 1, entryTime: '2026-09-01 10:00:00',
  depositUnitName: '法人', depositUnitId: 12, costCenterName: '中心', costCenterId: 13, costCenter: '中心', organizationId: 101, postId: 201, insuredArea: '1', insuranceStatus: 1, insuranceStatusName: '未参保', staffStatus: 1, staffStatusName: '在职', insuranceStartDate: null, insuranceStopDate: null, depositBase: '100.00', reductionReason: null,
}
const fileResponse = (fileName?: string) => ({
  data: new Uint8Array([1, 2, 3]).buffer,
  headers: {
    'content-type': 'application/vnd.ms-excel',
    ...(fileName ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}` } : {}),
  },
})

describe('社保办理页面能力', () => {
  it('静态锁定菜单、端点、权限、组织树和Java字段', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/hr/insurance/process/list.vue'), 'utf8')
    const increase = readFileSync(join(root, 'app/portal/views/dashboard/hr/insurance/process/increase/list.vue'), 'utf8')
    const reduce = readFileSync(join(root, 'app/portal/views/dashboard/hr/insurance/process/reduce/list.vue'), 'utf8')
    const organizationSelect = readFileSync(join(root, 'app/portal/components/portal/hxr/tree-select/role-organization/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryInsuranceController.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryInsuranceDTO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryInsuranceServiceImpl.java'), 'utf8')
    expect(menu).toContain(`path: '${INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${INSURANCE_SALARY_INSURANCE_PROCESS_PERMISSION}'`)
    expect(page).toContain("getDataListURL: '/salary/salaryinsurance/page'")
    expect(page).toContain('router.push(`./increase/list?bridge=${bridgeSet(selectedRows)}`)')
    expect(page).toContain('router.push(`./reduce/list?bridge=${bridgeSet(selectedRows)}`)')
    expect(page).toContain("http.put('/salary/salaryinsurance/updateDepositUnit'")
    expect(page).toContain("http.put('/salary/salaryinsurance/updateCostCenter'")
    expect(page).toContain('/salary/salaryinsurance/exportList')
    expect(page).toContain('newPageWithPlatformAuth')
    expect(organizationSelect).toContain('getRoleOrganizationTree')
    expect(page).toContain("/system/area/getTree")
    for (const fragment of ["method: 'POST'", "url: '/salary/salaryinsurance/insure'", 'data: formState.value.map((e) => ({', "insuranceStartDate: e.insuranceStartDate ? e.insuranceStartDate.format('YYYY-MM-DD') : null"]) expect(increase).toContain(fragment)
    for (const fragment of ["method: 'PUT'", "url: '/salary/salaryinsurance/terminate'", "insuranceStopDate: e.insuranceStopDate.format('YYYY-MM-DD')", 'reductionReason']) expect(reduce).toContain(fragment)
    expect(controller).toContain('@RequestMapping("/salary/salaryinsurance")')
    expect(controller).toContain('@PostMapping("insure")')
    expect(controller).toContain('@PutMapping("terminate")')
    expect(controller).toContain('List<SalaryInsuranceDTO>')
    expect(controller).toContain('@GetMapping("exportList")')
    expect(dto).toContain('private Long staffCode')
    expect(dto).toContain('private Integer insuranceStatus')
    for (const fragment of ['private Long staffCode', 'private Long depositUnitId', 'private Long costCenterId', 'private String insuredArea', 'private LocalDate insuranceStartDate', 'private LocalDate insuranceStopDate', 'private BigDecimal depositBase', 'private String reductionReason']) expect(dto).toContain(fragment)
    for (const fragment of ['public HrStaffSalaryEligibilityResultDTO insure', 'public void terminate', 'getInsuranceStartDate', 'getInsuranceStopDate', 'getReductionReason']) expect(service).toContain(fragment)
    expect(insuranceSalaryInsuranceProcessCapabilities.every(item => item.pagePath === INSURANCE_SALARY_INSURANCE_PROCESS_PAGE_PATH && item.permission === INSURANCE_SALARY_INSURANCE_PROCESS_PERMISSION && item.moduleType === INSURANCE_SALARY_INSURANCE_PROCESS_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表和列表导出遵循Portal日期、组织、分页及默认排序规则', async () => {
    const f = fixture([{ list: [pageRow], total: 1 }, fileResponse()])
    await expect(f.api.list({
      name: '张',
      orgIds: [1, '2'],
      staffStatus: 1,
      insuranceStatus: 2,
      entryTime: ['2026-01-10', '2026-02-28'],
      businessDate: '2026-09-23',
      pageNo: 2,
      pageSize: 50,
    })).resolves.toMatchObject({ total: 1, list: [{ staffCode: 1001, name: '张三', insuranceStatus: 1 }] })
    expect(f.calls[0]).toEqual({
      url: '/salary/salaryinsurance/page',
      method: 'get',
      params: {
        order: '', orderField: '', name: '张', orgIds: '1,2', staffStatus: 1, insuranceStatus: 2,
        businessDate: '2026-09-23', entryTimeStart: '2026-01-10', entryTimeEnd: '2026-03-01', pageNo: 2, pageSize: 50,
      },
    })
    await f.api.export({ orgIds: [1, 2], businessDate: '2026-09-23', pageNo: 3, pageSize: 100 })
    expect(f.calls[1]).toEqual({
      url: '/salary/salaryinsurance/exportList',
      method: 'get',
      params: {
        name: '', orgIds: '1,2', staffStatus: null, insuranceStatus: null, businessDate: '2026-09-23',
        entryTimeStart: null, entryTimeEnd: null, limit: 100, pageNo: 3,
      },
      responseType: 'arraybuffer',
    })
  })

  it('年度基数导出沿用Portal独立端点并保留后端文件名', async () => {
    const f = fixture([fileResponse('年度基数-2026.xlsx')])
    await expect(f.api.exportYearBase({ orgIds: [1, '2'], startDate: '2026-01', endDate: '2026-03' })).resolves.toMatchObject({ fileName: '年度基数-2026.xlsx', byteLength: 3 })
    expect(f.calls[0]).toEqual({
      url: '/salary/salaryinsurance/export',
      method: 'get',
      params: { orgIds: '1,2', startDate: '2026-01', endDate: '2026-03' },
      responseType: 'arraybuffer',
    })
    await expect(f.api.exportYearBase({ orgIds: [1], startDate: '2026-13', endDate: '2026-03' })).rejects.toThrow('YYYY-MM')
  })

  it('组织和地区树、批量调整草稿及提交请求保留Portal body', async () => {
    const tree = [{ id: 1, name: '总部', children: [{ id: '2', name: '财务', children: [] }] }]
    const f = fixture([tree, tree, undefined, undefined])
    await expect(f.api.organizationTree()).resolves.toEqual(tree)
    await expect(f.api.areaTree()).resolves.toEqual(tree)
    expect(f.api.prepareUpdateDepositUnit({ staffCodes: [1001, '1002'], depositUnitId: 21 })).toEqual({ draft: [{ staffCode: 1001, depositUnitId: 21 }, { staffCode: '1002', depositUnitId: 21 }] })
    expect(f.api.prepareUpdateCostCenter({ staffCodes: [1001], costCenterId: 31 })).toEqual({ draft: [{ staffCode: 1001, costCenterId: 31 }] })
    await f.api.updateDepositUnit({ staffCodes: [1001], depositUnitId: 21 })
    await f.api.updateCostCenter({ staffCodes: [1001], costCenterId: 31 })
    expect(f.calls.slice(2)).toEqual([
      { url: '/salary/salaryinsurance/updateDepositUnit', method: 'put', data: [{ staffCode: 1001, depositUnitId: 21 }] },
      { url: '/salary/salaryinsurance/updateCostCenter', method: 'put', data: [{ staffCode: 1001, costCenterId: 31 }] },
    ])
  })

  it('增员和减员完整执行prepare → submit → cancel，并保留完整行body', async () => {
    const f = fixture([{
      processedIds: [9], processedStaffCodes: [1001], processedCount: 1,
      eligibleStaffIds: [9], eligibleStaffCodes: [1001], excludedStaffList: [],
    }, undefined])
    const increaseDraft = f.api.prepareInsure({ rows: [{ ...actionRow, insuranceStartDate: '2026-09-15' }] })
    expect(increaseDraft).toEqual({ draft: [{ ...actionRow, insuranceStartDate: '2026-09-15' }] })
    await expect(f.api.insure(increaseDraft)).resolves.toMatchObject({ processedCount: 1, processedStaffCodes: [1001] })
    expect(f.calls[0]).toEqual({ url: '/salary/salaryinsurance/insure', method: 'post', data: [{ ...actionRow, insuranceStartDate: '2026-09-15' }] })
    expect(f.api.cancelInsure()).toEqual({ cancelled: true })

    const terminateRow = { ...actionRow, insuranceStatus: 2, insuranceStopDate: '2026-09-30', reductionReason: '1' }
    const terminateDraft = f.api.prepareTerminate({ rows: [terminateRow] })
    expect(terminateDraft).toEqual({ draft: [terminateRow] })
    await expect(f.api.terminate(terminateDraft)).resolves.toBeUndefined()
    expect(f.calls[1]).toEqual({ url: '/salary/salaryinsurance/terminate', method: 'put', data: [terminateRow] })
    expect(f.api.cancelTerminate()).toEqual({ cancelled: true })
  })

  it('坏响应、坏分页、坏组织树和空批量不会被转成成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ staffCode: 0 }], total: 1 }]).api.list()).rejects.toThrow('staffCode')
    await expect(fixture([[{ id: 0, name: '坏' }]]).api.organizationTree()).rejects.toThrow('id')
    await expect(fixture().api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(() => fixture().api.prepareUpdateDepositUnit({ staffCodes: [], depositUnitId: 1 })).toThrow('不能为空')
    expect(() => fixture().api.prepareInsure({ rows: [{ ...actionRow, insuredArea: '' }] })).toThrow('insuredArea不能为空')
    expect(() => fixture().api.prepareTerminate({ rows: [{ ...actionRow, insuranceStatus: 2, insuranceStopDate: '2026-09-30', reductionReason: null }] })).toThrow('reductionReason不能为空')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约完整登记并锁定写入后的回查语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INSURANCE_SALARY_INSURANCE_PROCESS_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INSURANCE_SALARY_INSURANCE_PROCESS_METHODS).map(method => `insuranceSalaryInsuranceProcess.${method}`))])
    expect(contracts['insurance-process-list']?.output.fields.some(item => item.path === 'list[].staffCode')).toBe(true)
    expect(contracts['insurance-process-prepare-update-deposit-unit']?.steps.some(step => step.mapping?.staffCodes === 'result.draft[].staffCode')).toBe(true)
    expect(contracts['insurance-process-update-cost-center']?.idempotency).toContain('回查')
  })
})
