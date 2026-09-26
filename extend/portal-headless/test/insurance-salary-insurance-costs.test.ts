import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInsuranceSalaryInsuranceCostsCapability,
  INSURANCE_ARCHIVE_PAGE_PATH,
  INSURANCE_COST_PAGE_PATH,
  INSURANCE_SALARY_INSURANCE_COST_METHODS,
  insuranceSalaryInsuranceCostsCapabilities,
} from '../src/capabilities/insurance-salary-insurance-costs.js'
import { INSURANCE_SALARY_INSURANCE_COST_AI_CONTRACTS as contracts, INSURANCE_SALARY_INSURANCE_COST_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-insurance-salary-insurance-costs.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInsuranceSalaryInsuranceCostsCapability(request), calls }
}
const response = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel' } }

describe('社保费用和社保归档查询页面能力', () => {
  it('静态锁定页面、旧版角色组织树、权限和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const cost = readFileSync(join(root, 'app/portal/views/dashboard/hr/insurance/cost/list.vue'), 'utf8')
    const archive = readFileSync(join(root, 'app/portal/views/dashboard/hr/insurance/archive/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryInsuranceCostsController.java'), 'utf8')
    expect(menu).toContain(`path: '${INSURANCE_COST_PAGE_PATH}'`)
    expect(menu).toContain(`path: '${INSURANCE_ARCHIVE_PAGE_PATH}'`)
    expect(cost).toContain("getDataListURL: '/salary/salaryinsurancecosts/page'")
    expect(cost).toContain("/salary/salaryinsurancecosts/importExcel")
    expect(cost).toContain("/salary/salaryinsurancecosts/archive")
    expect(archive).toContain("/salary/salaryinsurancecosts/unarchive")
    expect(cost).toContain('<portal-hxr-tree-select-role-organization')
    expect(controller).toContain('@RequestMapping("/salary/salaryinsurancecosts")')
    expect(controller).toContain('@PutMapping("archive")')
    expect(controller).toContain('@PutMapping("unarchive")')
    expect(insuranceSalaryInsuranceCostsCapabilities.filter(item => item.pagePath === INSURANCE_COST_PAGE_PATH).every(item => item.moduleType === 14 && item.permission === '/dashboard/insurance/cost' && item.httpInstance === 'platform')).toBe(true)
    expect(insuranceSalaryInsuranceCostsCapabilities.filter(item => item.pagePath === INSURANCE_ARCHIVE_PAGE_PATH).every(item => item.moduleType === 14 && item.permission === '/dashboard/insurance/archive' && item.httpInstance === 'platform')).toBe(true)
  })

  it('费用页和归档页按页面默认值发送排序、月份和分页参数', async () => {
    const f = fixture([{ list: [{ id: 1, archiveStatus: 1 }], total: 1 }, { list: [], total: 0 }])
    await expect(f.api.costList()).resolves.toMatchObject({ total: 1, list: [{ id: 1, archiveStatus: 1, costMonth: null }] })
    await expect(f.api.archiveList()).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]).toEqual({ url: '/salary/salaryinsurancecosts/page', method: 'get', params: { order: '', orderField: '', archiveStatus: 1, orgIds: '', name: null, costDateStart: null, costDateEnd: null, pageNo: 1, pageSize: 20 } })
    expect(f.calls[1]).toEqual({ url: '/salary/salaryinsurancecosts/page', method: 'get', params: { order: '', orderField: '', archiveStatus: 2, orgIds: '', name: null, costDateStart: null, costDateEnd: null, pageNo: 1, pageSize: 20, isSalaryUsed: null, occurredDateStart: null, occurredDateEnd: null } })
  })

  it('导出严格按Portal去掉分页，写请求保留body和multipart字段', async () => {
    const f = fixture([response, response, undefined, undefined, undefined, undefined, undefined, undefined])
    await expect(f.api.costExport({ ids: [1], belongMonth: ['2026-01', '2026-03'], pageNo: 2, pageSize: 200 })).resolves.toMatchObject({ fileName: '社保费用.xlsx', byteLength: 3 })
    await expect(f.api.archiveExport({ ids: [2], belongMonth: ['2026-01', '2026-03'], occurMonth: ['2026-02', '2026-04'], isSalaryUsed: 1, pageNo: 2, pageSize: 200 })).resolves.toMatchObject({ fileName: '社保归档查询.xlsx', byteLength: 3 })
    expect(f.calls[0]?.params).toEqual({ type: 1, archiveStatus: 1, orgIds: '', name: null, costDateStart: '2026-01', costDateEnd: '2026-03', ids: '1' })
    expect(f.calls[1]?.params).toEqual({ type: 2, archiveStatus: 2, orgIds: '', name: null, costDateStart: '2026-01', costDateEnd: '2026-03', isSalaryUsed: 1, occurredDateStart: '2026-02', occurredDateEnd: '2026-04', ids: '2' })
    expect(f.api.prepareArchive({ items: [{ id: 1, occurredMonth: '2026-03' }] })).toEqual({ draft: [{ id: 1, occurredMonth: '2026-03' }] })
    expect(f.api.prepareUnarchive({ ids: [1] })).toEqual({ draft: [{ id: 1 }] })
    await f.api.archive({ items: [{ id: 1, occurredMonth: '2026-03' }] })
    await f.api.unarchive({ ids: [1] })
    await f.api.remove({ ids: [1] })
    await f.api.updateDepositUnit({ items: [{ id: 1, depositUnitId: 2 }] })
    await f.api.updateCostCenter({ items: [{ id: 1, costCenterId: 3 }] })
    await f.api.copyArchivedData({ oldDate: '2026-01', newDate: '2026-02' })
    expect(f.calls.slice(2, 8)).toEqual([
      { url: '/salary/salaryinsurancecosts/archive', method: 'put', data: [{ id: 1, occurredMonth: '2026-03' }] },
      { url: '/salary/salaryinsurancecosts/unarchive', method: 'put', data: [{ id: 1 }] },
      { url: '/salary/salaryinsurancecosts', method: 'delete', data: [1] },
      { url: '/salary/salaryinsurancecosts/updateDepositUnit', method: 'put', data: [{ id: 1, depositUnitId: 2 }] },
      { url: '/salary/salaryinsurancecosts/updateCostCenter', method: 'put', data: [{ id: 1, costCenterId: 3 }] },
      { url: '/salary/salaryinsurancecosts/importArchiveData', method: 'put', data: { oldDate: '2026-01', newDate: '2026-02' } },
    ])
    await f.api.importExcel({ fileName: 'x.xlsx', base64: Buffer.from('x').toString('base64') })
    expect(f.calls[8]?.url).toBe('/salary/salaryinsurancecosts/importExcel')
    expect(f.calls[8]?.method).toBe('post')
    expect(f.calls[8]?.data).toBeInstanceOf(FormData)
    expect(f.api.prepareImport({ fileName: 'x.xlsx', base64: Buffer.from('x').toString('base64') })).toMatchObject({ fileName: 'x.xlsx', byteLength: 1 })
  })

  it('坏响应、状态、月份和空批量不会静默成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.costList()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ id: 1, archiveStatus: 3 }], total: 1 }]).api.costList()).rejects.toThrow('archiveStatus')
    await expect(fixture().api.costList({ archiveStatus: 3 })).rejects.toThrow('archiveStatus')
    await expect(fixture([[{ id: 0, name: 'bad', children: [] }]]).api.organizationTree()).rejects.toThrow('id')
    expect(() => fixture().api.prepareArchive({ items: [] })).toThrow('不能为空')
    expect(() => fixture().api.prepareCopyArchivedData({ oldDate: '2026-13', newDate: '2026-02' })).toThrow('YYYY-MM')
    expect(() => fixture().api.prepareImport({ fileName: 'x', base64: '' })).toThrow('不能为空')
  })

  it('AI契约逐能力登记，并锁定两个页面的关键返回字段', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INSURANCE_SALARY_INSURANCE_COST_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INSURANCE_SALARY_INSURANCE_COST_METHODS).map(method => `insuranceSalaryInsuranceCosts.${method}`))])
    expect(contracts['insurance-cost-list']?.output.fields.some(item => item.path === 'list[].pensionUnitCost')).toBe(true)
    expect(contracts['insurance-cost-archive']?.idempotency).toContain('requestId')
    expect(contracts['insurance-cost-prepare-import']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
