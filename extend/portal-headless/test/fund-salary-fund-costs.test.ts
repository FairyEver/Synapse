import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFundSalaryFundCostsCapability,
  FUND_ARCHIVE_PAGE_PATH,
  FUND_COST_PAGE_PATH,
  FUND_SALARY_FUND_COST_METHODS,
  fundSalaryFundCostsCapabilities,
  type FundSalaryCostRow,
} from '../src/capabilities/fund-salary-fund-costs.js'
import { FUND_SALARY_FUND_COST_AI_CONTRACTS as contracts, FUND_SALARY_FUND_COST_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-fund-salary-fund-costs.js'

type RequestConfig = Parameters<PortalRequest>[0]
const row: FundSalaryCostRow = {
  id: '9007199254740993', staffCode: 1001, name: '张三', organizationPath: '总部/财务', postName: '会计', idCard: 'x', insuredArea: '北京', depositUnitName: '法人', depositUnitId: 12,
  costDate: '2026-09', occurredDate: '2026-10', totalCost: '100.00', costType: 1, operatorName: '李四', operateTime: '2026-09-23 10:00:00', costCenterName: '中心', costCenterId: 13,
  companyBase: 100, individualBase: 100, companyRatio: 12, individualRatio: 8, companyCost: 12, individualCost: 8, archiveStatus: 1, salaryDocumentIds: null, salaryDocumentIdNames: null, isDel: 0, creator: 1, createTime: null, updater: null, updateTime: null,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFundSalaryFundCostsCapability(request), calls }
}

describe('公积金费用与公积金归档查询页面能力', () => {
  it('静态锁定菜单、路径、module-type、端点和Java字段', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const cost = readFileSync(join(root, 'app/portal/views/dashboard/hr/fund/cost/list.vue'), 'utf8')
    const archive = readFileSync(join(root, 'app/portal/views/dashboard/hr/fund/archive/list.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryFundCostsController.java'), 'utf8')
    const select = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryFundCostsSelectDTO.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryFundCostsDTO.java'), 'utf8')
    expect(menu).toContain(`path: '${FUND_COST_PAGE_PATH}'`)
    expect(menu).toContain(`path: '${FUND_ARCHIVE_PAGE_PATH}'`)
    expect(cost).toContain("getDataListURL: '/salary/salaryfundcosts/page'")
    expect(cost).toContain("url: '/salary/salaryfundcosts/archive'")
    expect(cost).toContain("http.put('/salary/salaryfundcosts/updateDepositUnit'")
    expect(cost).toContain("http.put('/salary/salaryfundcosts/updateCostCenter'")
    expect(cost).toContain("http.put('/salary/salaryfundcosts/copyArchivedData'")
    expect(archive).toContain("url: '/salary/salaryfundcosts/unarchive'")
    expect(controller).toContain('@RequestMapping("/salary/salaryfundcosts")')
    expect(controller).toContain('@PutMapping("archive")')
    expect(controller).toContain('@PutMapping("unarchive")')
    expect(select).toContain('private List<Long> orgIds')
    expect(dto).toContain('private Integer archiveStatus')
    expect(fundSalaryFundCostsCapabilities.some(item => item.id === 'fund-cost-organization-tree')).toBe(true)
    expect(fundSalaryFundCostsCapabilities.filter(item => item.pagePath === FUND_COST_PAGE_PATH).every(item => item.moduleType === 14 && item.permission === '/dashboard/fund/cost' && item.httpInstance === 'platform')).toBe(true)
    expect(fundSalaryFundCostsCapabilities.filter(item => item.pagePath === FUND_ARCHIVE_PAGE_PATH).every(item => item.moduleType === 14 && item.permission === '/dashboard/fund/archive' && item.httpInstance === 'platform')).toBe(true)
  })

  it('费用页和归档页按Portal默认值转换列表参数', async () => {
    const f = fixture([{ list: [{ ...row }], total: 1 }, { list: [], total: 0 }])
    await expect(f.api.costList()).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.archiveList()).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls[0]?.url).toBe('/salary/salaryfundcosts/page')
    expect(f.calls[0]).toEqual({ url: '/salary/salaryfundcosts/page', method: 'get', params: { order: '', orderField: '', orgIds: '', name: null, archiveStatus: 1, costDateStart: null, costDateEnd: null, pageNo: 1, pageSize: 20 } })
    expect(f.calls[1]).toEqual({ url: '/salary/salaryfundcosts/page', method: 'get', params: { order: '', orderField: '', archiveStatus: 2, orgIds: '', isSalaryUsed: null, name: null, costDateStart: null, costDateEnd: null, occurredDateStart: null, occurredDateEnd: null, pageNo: 1, pageSize: 20 } })
    const ranged = fixture([{ list: [], total: 0 }])
    await ranged.api.archiveList({ orgIds: [1, '2'], name: '张', isSalaryUsed: 1, belongMonth: ['2026-01', '2026-03'], occurMonth: ['2026-02', '2026-04'], pageNo: 2, pageSize: 200 })
    expect(ranged.calls[0]?.params).toEqual({ order: '', orderField: '', archiveStatus: 2, orgIds: '1,2', isSalaryUsed: 1, name: '张', costDateStart: '2026-01', costDateEnd: '2026-03', occurredDateStart: '2026-02', occurredDateEnd: '2026-04', pageNo: 2, pageSize: 200 })
  })

  it('组织树、批量归档/取消归档/删除和调整请求保留Portal body', async () => {
    const tree = [{ id: 1, name: '总部', children: [{ id: '2', name: '财务', children: [] }] }]
    const f = fixture([tree, undefined, undefined, undefined, undefined, undefined])
    await expect(f.api.organizationTree()).resolves.toEqual(tree)
    expect(f.api.prepareArchive({ items: [{ id: row.id, occurredDate: '2026-10' }] })).toEqual({ draft: [{ id: row.id, occurredDate: '2026-10' }] })
    await f.api.archive({ items: [{ id: row.id, occurredDate: '2026-10' }] })
    await f.api.unarchive({ ids: [row.id] })
    await f.api.remove({ ids: [row.id] })
    await f.api.updateDepositUnit({ items: [{ id: row.id, depositUnitId: 21 }] })
    await f.api.updateCostCenter({ items: [{ id: row.id, costCenterId: 31 }] })
    expect(f.calls.slice(1)).toEqual([
      { url: '/salary/salaryfundcosts/archive', method: 'put', data: [{ id: row.id, occurredDate: '2026-10' }] },
      { url: '/salary/salaryfundcosts/unarchive', method: 'put', data: [{ id: row.id }] },
      { url: '/salary/salaryfundcosts', method: 'delete', data: [row.id] },
      { url: '/salary/salaryfundcosts/updateDepositUnit', method: 'put', data: [{ id: row.id, depositUnitId: 21 }] },
      { url: '/salary/salaryfundcosts/updateCostCenter', method: 'put', data: [{ id: row.id, costCenterId: 31 }] },
    ])
  })

  it('文件导出、模板、导入和历史归档月份规则不会静默接受坏输入', async () => {
    const response = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel' } }
    const f = fixture([response, response, response, undefined, undefined])
    await expect(f.api.costExport({ ids: [1] })).resolves.toMatchObject({ fileName: '公积金费用.xlsx', byteLength: 3 })
    await expect(f.api.archiveExport({ ids: [1] })).resolves.toMatchObject({ fileName: '公积金归档查询.xlsx', byteLength: 3 })
    await expect(f.api.downloadTemplate()).resolves.toMatchObject({ fileName: '公积金费用模板', byteLength: 3 })
    expect(f.calls[0]?.params).toMatchObject({ type: 1, ids: '1' })
    expect(f.calls[1]?.params).toMatchObject({ type: 2, ids: '1' })
    expect(f.calls[2]).toEqual({ url: '/sys/oss/download', method: 'get', params: { fileName: '公积金费用模板' }, responseType: 'arraybuffer' })
    expect(f.api.prepareImport({ fileName: 'x.xlsx', base64: Buffer.from('x').toString('base64') })).toEqual({ fileName: 'x.xlsx', contentType: 'application/octet-stream', byteLength: 1 })
    await f.api.importExcel({ fileName: 'x.xlsx', base64: Buffer.from('x').toString('base64') })
    await f.api.copyArchivedData({ oldDate: '2026-01', newDate: '2026-02' })
    expect(f.calls[4]?.url).toBe('/salary/salaryfundcosts/copyArchivedData')
    expect(() => f.api.prepareArchive({ items: [] })).toThrow('不能为空')
    expect(() => f.api.prepareCopyArchivedData({ oldDate: '2026-13', newDate: '2026-02' })).toThrow('YYYY-MM')
  })

  it('坏分页、坏行、坏组织树和坏文件不会转成成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.costList()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, id: 0 }], total: 1 }]).api.costList()).rejects.toThrow('id')
    await expect(fixture([[{ id: 1, name: 'x', children: [{ id: 0, name: 'bad' }] }]]).api.organizationTree()).rejects.toThrow('id')
    await expect(fixture().api.remove({ ids: [] })).rejects.toThrow('不能为空')
    expect(() => fixture().api.prepareImport({ fileName: 'x', base64: '' })).toThrow('不能为空')
  })

  it('AI契约完整登记并锁定关键映射', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(FUND_SALARY_FUND_COST_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(FUND_SALARY_FUND_COST_METHODS).map(method => `fundSalaryFundCosts.${method}`))])
    expect(contracts['fund-cost-list']?.output.fields.some(item => item.path === 'list[].archiveStatus')).toBe(true)
    expect(contracts['fund-cost-prepare-archive']?.steps.some(step => step.mapping?.items === 'result.draft')).toBe(true)
    expect(contracts['fund-cost-import']?.gaps?.join('\n')).toContain('prepare→submit→cancel')
  })
})
