import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFundSalaryFundProcessCapability,
  FUND_SALARY_FUND_PROCESS_MODULE_TYPE,
  FUND_SALARY_FUND_PROCESS_METHODS,
  FUND_SALARY_FUND_PROCESS_PAGE_PATH,
  FUND_SALARY_FUND_PROCESS_PERMISSION,
  fundSalaryFundProcessCapabilities,
  type FundSalaryFundProcessRow,
} from '../src/capabilities/fund-salary-fund-process.js'
import { FUND_SALARY_FUND_PROCESS_AI_CONTRACTS as contracts, FUND_SALARY_FUND_PROCESS_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-fund-salary-fund-process.js'

type RequestConfig = Parameters<PortalRequest>[0]
const row: FundSalaryFundProcessRow = {
  id: 9, staffCode: '1001', name: '张三', organizationPath: '总部/财务', postName: '会计', idCard: 'x', householdType: 1, employmentType: 1, entryTime: '2026-09-01 10:00:00',
  depositUnitName: '法人', depositUnitId: 12, costCenterName: '中心', costCenterId: 13, insuredArea: '1', insuranceStatus: 2, insuranceStartDate: '2026-09-01', insuranceStopDate: null,
  companyBase: '100.00', individualBase: 100, companyRatio: '12', individualRatio: 8, companyFee: '12.00', individualFee: '8.00', total: '20.00', reductionReason: null,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFundSalaryFundProcessCapability(request), calls }
}

describe('公积金办理页面能力', () => {
  it('静态锁定页面组件、权限、旧版角色组织树和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/hr/fund/process/list.vue'), 'utf8')
    const increase = readFileSync(join(root, 'app/portal/views/dashboard/hr/fund/process/increase/list.vue'), 'utf8')
    const reduce = readFileSync(join(root, 'app/portal/views/dashboard/hr/fund/process/reduce/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryFundController.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryFundDTO.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryFundServiceImpl.java'), 'utf8')
    expect(menu).toContain(`path: '${FUND_SALARY_FUND_PROCESS_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${FUND_SALARY_FUND_PROCESS_PERMISSION}'`)
    expect(page).toContain("getDataListURL: '/salary/salaryfund/page'")
    expect(page).toContain('router.push(`./increase/list?bridge=${bridgeSet(selectedRows)}`)')
    expect(page).toContain('router.push(`./reduce/list?bridge=${bridgeSet(selectedRows)}`)')
    expect(page).toContain("http.put('/salary/salaryfund/updateDepositUnit'")
    expect(page).toContain("http.put('/salary/salaryfund/updateCostCenter'")
    expect(page).toContain("/admin-api/salary/salaryfund/export")
    expect(page).toContain("http('/system/area/getTree')")
    expect(page).toContain('<portal-hxr-tree-select-role-organization')
    for (const fragment of ["method: 'POST'", "url: '/salary/salaryfund/insure'", 'data: formState.value.map(({ insuranceStartDate, ...rest }) =>', 'insuranceStartDate: insuranceStartDate || null']) expect(increase).toContain(fragment)
    for (const fragment of ["method: 'PUT'", "url: '/salary/salaryfund/terminate'", 'insuranceStopDate: e.insuranceStopDate.format(\'YYYY-MM-DD\')', 'reductionReason']) expect(reduce).toContain(fragment)
    expect(controller).toContain('@RequestMapping("/salary/salaryfund")')
    expect(controller).toContain('@PostMapping("insure")')
    expect(controller).toContain('@PutMapping("terminate")')
    expect(controller).toContain('List<SalaryFundDTO>')
    expect(controller).toContain('@PutMapping("updateDepositUnit")')
    expect(controller).toContain('@PutMapping("updateCostCenter")')
    for (const fragment of ['private Long staffCode', 'private Long depositUnitId', 'private Long costCenterId', 'private String insuredArea', 'private LocalDate insuranceStartDate', 'private LocalDate insuranceStopDate', 'private String reductionReason']) expect(dto).toContain(fragment)
    for (const fragment of ['public HrStaffSalaryEligibilityResultDTO insure', 'public void terminate', 'getInsuranceStartDate', 'getInsuranceStopDate', 'getReductionReason']) expect(service).toContain(fragment)
    expect(fundSalaryFundProcessCapabilities.every(item => item.moduleType === FUND_SALARY_FUND_PROCESS_MODULE_TYPE && item.permission === FUND_SALARY_FUND_PROCESS_PERMISSION && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表按Portal表单、排序和日期规则转换参数，导出不带分页冗余键', async () => {
    const f = fixture([{ list: [row], total: 1 }, { data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.ms-excel' } }])
    await expect(f.api.list({ businessDate: '2026-09-23', orgIds: [1, '2'], entryTime: ['2026-09-01', '2026-09-30'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/salary/salaryfund/page', method: 'get', params: { order: '', orderField: '', name: '', orgIds: '1,2', staffStatus: null, insuranceStatus: null, businessDate: '2026-09-23', entryTimeStart: '2026-09-01', entryTimeEnd: '2026-10-01', pageNo: 2, pageSize: 50 } })
    await expect(f.api.export({ businessDate: '2026-09-23', entryTime: [], pageNo: 3, pageSize: 100 })).resolves.toMatchObject({ fileName: '公积金办理.xlsx', byteLength: 2 })
    expect(f.calls[1]?.params).toEqual({ name: '', orgIds: '', staffStatus: null, insuranceStatus: null, businessDate: '2026-09-23', entryTimeStart: null, entryTimeEnd: null, limit: 100, pageNo: 3 })
  })

  it('组织树、地区树和调整写请求保留Portal body，并提供本地prepare草稿', async () => {
    const f = fixture([[{ id: 1, name: '总部', children: [] }], [{ id: 2, name: '北京', children: [] }], undefined, undefined])
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 1, name: '总部', children: [] }])
    await expect(f.api.areaTree()).resolves.toEqual([{ id: 2, name: '北京', children: [] }])
    expect(f.api.prepareUpdateDepositUnit({ staffCodes: [row.staffCode], depositUnitId: 21 })).toEqual({ draft: [{ staffCode: row.staffCode, depositUnitId: 21 }] })
    expect(f.api.prepareUpdateCostCenter({ staffCodes: [row.staffCode], costCenterId: 31 })).toEqual({ draft: [{ staffCode: row.staffCode, costCenterId: 31 }] })
    await f.api.updateDepositUnit({ staffCodes: [row.staffCode], depositUnitId: 21 })
    await f.api.updateCostCenter({ staffCodes: [row.staffCode], costCenterId: 31 })
    expect(f.calls.slice(2)).toEqual([
      { url: '/salary/salaryfund/updateDepositUnit', method: 'put', data: [{ staffCode: row.staffCode, depositUnitId: 21 }] },
      { url: '/salary/salaryfund/updateCostCenter', method: 'put', data: [{ staffCode: row.staffCode, costCenterId: 31 }] },
    ])
  })

  it('增员和减员完整执行prepare → submit → cancel，并逐字保留Portal完整行body', async () => {
    const f = fixture([{
      processedIds: [9], processedStaffCodes: [1001], processedCount: 1,
      eligibleStaffIds: [9], eligibleStaffCodes: [1001], excludedStaffList: [],
    }, undefined])
    const increaseRow = { ...row, insuranceStatus: 1 }
    const increaseDraft = f.api.prepareInsure({ rows: [increaseRow] })
    expect(increaseDraft).toEqual({ draft: [{ ...increaseRow, insuranceStartDate: '2026-09-01' }] })
    await expect(f.api.insure(increaseDraft)).resolves.toMatchObject({ processedCount: 1, processedStaffCodes: [1001] })
    expect(f.calls[0]).toEqual({ url: '/salary/salaryfund/insure', method: 'post', data: [{ ...increaseRow, insuranceStartDate: '2026-09-01' }] })
    expect(f.api.cancelInsure()).toEqual({ cancelled: true })

    const terminateRow = { ...row, insuranceStopDate: '2026-09-30', reductionReason: '1' }
    const terminateDraft = f.api.prepareTerminate({ rows: [terminateRow] })
    expect(terminateDraft).toEqual({ draft: [terminateRow] })
    await expect(f.api.terminate(terminateDraft)).resolves.toBeUndefined()
    expect(f.calls[1]).toEqual({ url: '/salary/salaryfund/terminate', method: 'put', data: [terminateRow] })
    expect(f.api.cancelTerminate()).toEqual({ cancelled: true })
  })

  it('坏分页、坏树和非法批量输入不会转成成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, staffCode: 0 }], total: 1 }]).api.list()).rejects.toThrow('staffCode')
    await expect(fixture([[{ id: 0, name: 'bad', children: [] }]]).api.organizationTree()).rejects.toThrow('id')
    expect(() => fixture().api.prepareUpdateDepositUnit({ staffCodes: [], depositUnitId: 1 })).toThrow('不能为空')
    expect(() => fixture().api.prepareUpdateCostCenter({ staffCodes: [1], costCenterId: 0 })).toThrow('安全正整数')
    expect(() => fixture().api.prepareInsure({ rows: [{ ...row, insuranceStatus: 1, companyFee: '' }] })).toThrow('companyFee不能为空')
    expect(() => fixture().api.prepareTerminate({ rows: [{ ...row, insuranceStopDate: null }] })).toThrow('insuranceStopDate不能为空')
  })

  it('AI契约逐能力登记，并保留写操作回查和取消语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(FUND_SALARY_FUND_PROCESS_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(FUND_SALARY_FUND_PROCESS_METHODS).map(method => `fundSalaryFundProcess.${method}`))])
    expect(contracts['fund-process-list']?.output.fields.some(item => item.path === 'list[].staffCode')).toBe(true)
    expect(contracts['fund-process-prepare-update-deposit-unit']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['fund-process-update-cost-center']?.idempotency).toContain('requestId')
  })
})
