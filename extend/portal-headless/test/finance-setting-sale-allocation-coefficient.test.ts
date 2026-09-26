import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createFinanceSettingSaleAllocationCoefficientCapability,
  financeSettingSaleAllocationCoefficientCapabilities,
  FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS,
  FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH,
  type FinanceSaleAllocationCoefficientRow,
} from '../src/capabilities/finance-setting-sale-allocation-coefficient.js'
import {
  FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_AI_CONTRACTS as contracts,
  FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-finance-setting-sale-allocation-coefficient.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row: FinanceSaleAllocationCoefficientRow = {
  id: '9007199254740993',
  tenantName: '企业A',
  categoryName: '分类A,分类B',
  coefficient: '12.50',
  status: 1,
  updateTime: '2026-09-23 10:00:00',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createFinanceSettingSaleAllocationCoefficientCapability(request), calls }
}

describe('财务设置→销售分配系数页面能力', () => {
  it('静态锁定菜单、页面权限、列表/详情/新建/启停路径及按钮权限', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = readFileSync(join(root, 'app/portal/menus/finance.js'), 'utf8')
    const route = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/sale-allocation-coefficient.vue'), 'utf8')
    const list = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/sale-allocation-coefficient/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/sale-allocation-coefficient/[mode]/[id].vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/finance/setting/sale-allocation-coefficient/detail/[id].vue'), 'utf8')
    const java = readFileSync(join(process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java', 'erp-module-finance/erp-module-finance-biz/src/main/java/com/wdbc/erp/module/finance/controller/admin/salesallocationcoefficient/SalesAllocationCoefficientController.java'), 'utf8')

    expect(menu).toContain("path: '" + FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_PAGE_PATH + "'")
    expect(menu).toContain("permission: '/dashboard/finance/setting/sale-allocation-coefficient'")
    expect(route).toContain('permission: /dashboard/finance/setting/sale-allocation-coefficient')
    expect(list).toContain("getDataListURL: '/admin-api/finance/sales-allocation-coefficient/page'")
    expect(list).toContain("status: 'finance:setting:sale-allocation-coefficient:status'")
    expect(list).toContain("detail: 'finance:setting:sale-allocation-coefficient:detail'")
    expect(list).toContain("http.put('/admin-api/finance/sales-allocation-coefficient/update-status'")
    expect(form).toContain("http.post('/admin-api/finance/sales-allocation-coefficient/create'")
    expect(detail).toContain("/admin-api/finance/sales-allocation-coefficient/get?id=")
    expect(java).toContain('@RequestMapping("/finance/sales-allocation-coefficient")')
    expect(java).toContain('@PutMapping("/update-status")')
    expect(financeSettingSaleAllocationCoefficientCapabilities.map(item => item.id)).toEqual(Object.keys(FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS))
    expect(financeSettingSaleAllocationCoefficientCapabilities.every(item => item.permission === '/dashboard/finance/setting/sale-allocation-coefficient' && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(financeSettingSaleAllocationCoefficientCapabilities.find(item => item.id === 'finance-setting-sale-allocation-coefficient-create')?.write).toBe(true)
    expect(financeSettingSaleAllocationCoefficientCapabilities.find(item => item.id === 'finance-setting-sale-allocation-coefficient-set-status')?.write).toBe(true)
  })

  it('默认列表复现页面表单内部初始字段、分页和页面可见筛选字段', async () => {
    const f = fixture([{ list: [{ ...row, ignored: true }], total: 1 }])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/sales-allocation-coefficient/page',
      method: 'get',
      params: {
        order: '', orderField: '', unit: null, allocateOrg: '', ruleType: null,
        expenseType: null, indicator: null, status: 1, pageNo: 1, pageSize: 20,
      },
    })
    const filtered = fixture([{ list: [], total: 0 }])
    await expect(filtered.api.list({ tenantName: '企业', productGroupId: 7, categoryId: '8', status: 0, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [], total: 0 })
    expect(filtered.calls[0]?.params).toEqual({
      order: '', orderField: '', unit: null, allocateOrg: '', ruleType: null,
      expenseType: null, indicator: null, status: 0, tenantName: '企业', productGroupId: 7, categoryId: '8', pageNo: 2, pageSize: 50,
    })
  })

  it('详情只投影详情页消费字段并保持ID/系数原值', async () => {
    const f = fixture([{ ...row, productGroupName: '产品组', ignored: 'x' }, null])
    await expect(f.api.get({ id: row.id })).resolves.toEqual({ id: row.id, tenantName: row.tenantName, categoryName: row.categoryName, coefficient: row.coefficient })
    await expect(f.api.get({ id: 3 })).resolves.toBeNull()
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/sales-allocation-coefficient/get', method: 'get', params: { id: row.id } },
      { url: '/admin-api/finance/sales-allocation-coefficient/get', method: 'get', params: { id: 3 } },
    ])
  })

  it('新建严格复现表单字段、系数范围和Long ID返回', async () => {
    const f = fixture(['9007199254740997'])
    const input = { productGroupId: '7' as const, categoryId: [11, 12], coefficient: 100.25 }
    expect(f.api.prepareCreate(input)).toEqual({ draft: input })
    await expect(f.api.create(input)).resolves.toBe('9007199254740997')
    expect(f.calls[0]).toEqual({
      url: '/admin-api/finance/sales-allocation-coefficient/create',
      method: 'post',
      data: input,
    })
    expect(() => f.api.prepareCreate({ productGroupId: 7, categoryId: [], coefficient: 1 })).toThrow('非空')
    expect(() => f.api.prepareCreate({ productGroupId: 7, categoryId: [1, 1], coefficient: 1 })).toThrow('重复')
    expect(() => f.api.prepareCreate({ productGroupId: 7, categoryId: [1], coefficient: 10000.01 })).toThrow('0至10000')
    expect(() => f.api.prepareCreate({ productGroupId: 7, categoryId: [1], coefficient: 1.234 })).toThrow('最多两位')
  })

  it('启停使用绝对状态和最小PUT载荷，previous可作为补偿', async () => {
    const f = fixture([true, true])
    const prepared = f.api.prepareSetStatus({ current: row, targetStatus: 0 })
    expect(prepared).toEqual({ draft: { id: row.id, status: 0 }, previous: { id: row.id, status: 1 } })
    await expect(f.api.setStatus({ draft: prepared.draft })).resolves.toBe(true)
    await expect(f.api.setStatus({ draft: prepared.previous })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/finance/sales-allocation-coefficient/update-status', method: 'put', data: { id: row.id, status: 0 } },
      { url: '/admin-api/finance/sales-allocation-coefficient/update-status', method: 'put', data: { id: row.id, status: 1 } },
    ])
    expect(() => f.api.prepareSetStatus({ current: row, targetStatus: 1 })).toThrow('相反')
    const bad = fixture([false])
    await expect(bad.api.setStatus({ draft: { id: 1, status: 0 } })).rejects.toThrow('不是true')
  })

  it('坏响应和坏字段不会被静默改写为空或成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, id: 0 }], total: 1 }]).api.list()).rejects.toThrow('id')
    await expect(fixture([{ list: [{ ...row, coefficient: 'bad' }], total: 1 }]).api.list()).rejects.toThrow('coefficient')
    await expect(fixture([{ id: 1, tenantName: null, categoryName: null, coefficient: null }]).api.get({ id: 1 })).resolves.toEqual({ id: 1, tenantName: null, categoryName: null, coefficient: null })
  })

  it('AI契约逐方法登记且关键字段映射存在；破坏字段映射时断言失败', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(FINANCE_SETTING_SALE_ALLOCATION_COEFFICIENT_METHODS).map(method => `financeSettingSaleAllocationCoefficient.${method}`))
    expect(contracts['finance-setting-sale-allocation-coefficient-list']?.output.fields.some(field => field.path === 'list[].status')).toBe(true)
    expect(contracts['finance-setting-sale-allocation-coefficient-prepare-create']?.steps.some(step => step.mapping?.coefficient === 'result.draft.coefficient')).toBe(true)
    expect(contracts['finance-setting-sale-allocation-coefficient-set-status']?.steps.some(step => step.mapping?.draft === 'context.previous')).toBe(true)
    expect(contracts['finance-setting-sale-allocation-coefficient-create']?.output.fields.some(field => field.path === '$')).toBe(true)
  })
})
