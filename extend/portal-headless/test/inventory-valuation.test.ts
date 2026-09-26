import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryValuationCapability,
  INVENTORY_VALUATION_METHODS,
  INVENTORY_VALUATION_MODULE_TYPE,
  INVENTORY_VALUATION_PAGE_PATH,
  INVENTORY_VALUATION_PERMISSION,
  inventoryValuationCapabilities,
} from '../src/capabilities/inventory-valuation.js'
import {
  INVENTORY_VALUATION_AI_CONTRACTS as contracts,
  INVENTORY_VALUATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-inventory-valuation.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createInventoryValuationCapability(request), calls }
}

const row = {
  id: '9007199254740993',
  typeName: '采购入库',
  companyName: '测试公司',
  factoryId: '1001',
  factoryName: '测试工厂',
  materielId: '2001',
  materielCategoryId: '3001',
  materielCategoryName: '原料',
  materielName: '钢板',
  pricingMethod: 4,
  type: 'inventory_inbound_type',
  subtype: 1,
  price: 12.345,
  inAvgPrice: 10,
  outAvgPrice: null,
  updateTime: '2026-09-24 10:00:00',
  updaterName: '修改人',
  updater: '99',
}

describe('物料→库存管理→计价配置页面能力', () => {
  it('目录、module-type、权限和Portal/Java页面端点逐项锁定', () => {
    expect(inventoryValuationCapabilities.map(item => item.id)).toEqual(Object.keys(INVENTORY_VALUATION_METHODS))
    expect(inventoryValuationCapabilities.every(item => item.pagePath === INVENTORY_VALUATION_PAGE_PATH)).toBe(true)
    expect(inventoryValuationCapabilities.every(item => item.permission === INVENTORY_VALUATION_PERMISSION)).toBe(true)
    expect(inventoryValuationCapabilities.every(item => item.moduleType === INVENTORY_VALUATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(inventoryValuationCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'inventory-valuation-create',
      'inventory-valuation-update',
      'inventory-valuation-remove',
    ])

    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const list = readFileSync(join(root, 'app/portal/views/dashboard/material/store/valuation/list.vue'), 'utf8')
    const create = readFileSync(join(root, 'app/portal/views/dashboard/material/store/valuation/components/create-valuation.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/material/store/valuation/[mode]/[id].vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/material/store/valuation/detail/[id].vue'), 'utf8')
    const history = readFileSync(join(root, 'app/portal/views/dashboard/material/store/valuation/actions/view-price.vue'), 'utf8')
    expect(list).toContain("materielCategoryIds: form.materielCategoryIds.join(',')")
    expect(list).toContain("/admin-api/inventory/pricing-method-config/page")
    expect(list).toContain("http.delete(`/admin-api/inventory/pricing-method-config/delete?id=${record.id}`)")
    expect(create).toContain("http.post('/admin-api/inventory/pricing-method-config/create', requestData)")
    expect(create).toContain('subtype: item.moveType.split(\'-\')[1]')
    expect(form).toContain("http.put('/admin-api/inventory/pricing-method-config/update'")
    expect(form).toContain('subtype: Number(subtype)')
    expect(detail).toContain("/admin-api/inventory/pricing-method-change-log/page")
    expect(detail).toContain('pageSize: 500')
    expect(history).toContain("/admin-api/inventory/stock-avg-price-history/page")

    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/pricingmethod/PricingMethodConfigController.java'), 'utf8')
    for (const fragment of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', "@PreAuthorize(\"@ss.hasPermission('/dashboard/material/store/valuation')\")"]) expect(controller).toContain(fragment)
    const stockController = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/stock/StockController.java'), 'utf8')
    expect(stockController).toContain('@GetMapping("/typeList")')
  })

  it('列表严格复刻初始参数、分类join和分页响应', async () => {
    const { api, calls } = setup({ list: [row], total: 1 })
    await expect(api.list({ factoryId: '1001', pricingMethod: '4', materielCategoryIds: ['3001', 3002], moveType: 'inventory_inbound_type-1', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(calls).toEqual([{
      url: '/admin-api/inventory/pricing-method-config/page',
      method: 'get',
      params: { order: '', orderField: '', factoryId: '1001', pricingMethod: 4, materielCategoryIds: '3001,3002', moveType: 'inventory_inbound_type-1', pageNo: 2, pageSize: 50 },
    }])
    const empty = setup({ list: [], total: 0 })
    await expect(empty.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(empty.calls[0]).toMatchObject({ params: { factoryId: null, pricingMethod: null, materielCategoryIds: '', moveType: null, pageNo: 1, pageSize: 20 } })
  })

  it('候选端点复刻Portal参数和选择器派生规则', async () => {
    const categories = [{ id: '3001', catName: '原料', children: [{ id: 3002, catName: '钢材', children: [] }] }]
    const units = [{ id: '1001', name: '测试工厂', isFactory: 1, children: [{ id: 1002, name: '部门', isFactory: 0, children: [] }] }]
    const { api, calls } = setup([{ label: '采购入库', value: 'inventory_inbound_type-1', dictType: 'inventory_inbound_type', remark: null, status: 0 }], categories, units)
    await expect(api.typeList()).resolves.toMatchObject([{ label: '采购入库', value: 'inventory_inbound_type-1' }])
    await expect(api.materialCategoryTree()).resolves.toMatchObject([{ id: '3001', name: '原料', level: 1, children: [{ id: 3002, name: '钢材', level: 2 }] }])
    await expect(api.unitTree()).resolves.toMatchObject([{ id: '1001', disabled: false, children: [{ id: 1002, disabled: true }] }])
    expect(calls).toEqual([
      { url: '/admin-api/inventory/stock/typeList', method: 'get' },
      { url: '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree', method: 'get', params: { level: 5 } },
      { url: '/admin-api/supply/organization/tree?isFactory=1&includeParents=1', method: 'get' },
    ])
  })

  it('创建和编辑严格区分表单校验及subtype线格式', async () => {
    const createResult = setup(true)
    const preparedCreate = createResult.api.prepareCreate({ rows: [{ factoryId: '1001', materielCategoryId: '3001', pricingMethod: '4', moveType: 'inventory_inbound_type-1', price: 12.345 }] })
    expect(preparedCreate).toEqual({ draft: [{ factoryId: '1001', materielCategoryId: '3001', pricingMethod: 4, type: 'inventory_inbound_type', subtype: '1', price: 12.345 }] })
    await expect(createResult.api.create(preparedCreate)).resolves.toBe(true)
    expect(createResult.calls[0]).toEqual({ url: '/admin-api/inventory/pricing-method-config/create', method: 'post', data: preparedCreate.draft })

    const updateResult = setup(true)
    const preparedUpdate = updateResult.api.prepareUpdate({ id: '9001', factoryId: '1001', materielCategoryId: '3001', pricingMethod: '2', moveType: 'inventory_outbound_type-6', price: null })
    expect(preparedUpdate).toEqual({ draft: { id: '9001', factoryId: '1001', materielCategoryId: '3001', pricingMethod: 2, type: 'inventory_outbound_type', subtype: 6, price: null } })
    await expect(updateResult.api.update(preparedUpdate)).resolves.toBe(true)
    expect(updateResult.calls[0]).toEqual({ url: '/admin-api/inventory/pricing-method-config/update', method: 'put', data: preparedUpdate.draft })
    expect(() => createResult.api.prepareCreate({ rows: [{ factoryId: 1, materielCategoryId: 2, pricingMethod: 4, moveType: 'inventory_inbound_type-1', price: null }] })).toThrow('必填')
    expect(() => createResult.api.prepareCreate({ rows: [{ factoryId: 1, materielCategoryId: 2, pricingMethod: 2, moveType: 'inventory_inbound_type-1', price: -1 }] })).toThrow('范围')
    expect(() => updateResult.api.prepareUpdate({ id: 1, factoryId: 2, materielCategoryId: 3, pricingMethod: 2, moveType: 'inventory_outbound_type-1', price: 1.2345 })).toThrow('3位')
  })

  it('删除保持Portal的无前端状态门禁，并复刻详情循环分页和单价历史分页', async () => {
    const logs = [{ id: '1', factoryId: '1001', materielId: '9001', oldPricingMethod: null, newPricingMethod: 4, createTime: '2026-09-01', creator: null, creatorName: '张三' }]
    const history = [{ id: '2', factoryId: '1001', materielId: '2001', year: 2026, month: 9, inAvgPrice: 1.2, outAvgPrice: null, createTime: '2026-09-01' }]
    const result = setup(true, { list: logs, total: 2 }, { list: [{ ...logs[0], id: '3' }], total: 2 }, { list: history, total: 1 })
    const removeDraft = result.api.prepareRemove({ id: '9001' })
    await expect(result.api.remove(removeDraft)).resolves.toBe(true)
    await expect(result.api.changeLogs({ factoryId: '1001', materielId: '9001' })).resolves.toHaveLength(2)
    await expect(result.api.priceHistoryList({ factoryId: '1001', materielId: '2001' })).resolves.toEqual({ list: history, total: 1 })
    expect(result.calls).toEqual([
      { url: '/admin-api/inventory/pricing-method-config/delete', method: 'delete', params: { id: '9001' } },
      { url: '/admin-api/inventory/pricing-method-change-log/page', method: 'get', params: { pageNo: 1, pageSize: 500, factoryId: '1001', materielId: '9001' } },
      { url: '/admin-api/inventory/pricing-method-change-log/page', method: 'get', params: { pageNo: 2, pageSize: 500, factoryId: '1001', materielId: '9001' } },
      { url: '/admin-api/inventory/stock-avg-price-history/page', method: 'get', params: { order: '', orderField: '', factoryId: '1001', materielId: '2001', pageNo: 1, pageSize: 20 } },
    ])
  })

  it('坏响应、非法参数和非true写回执不会被吞掉', async () => {
    const bad = setup(false)
    await expect(bad.api.remove({ draft: { id: 1 } })).rejects.toThrow('不是true')
    expect(() => bad.api.prepareRemove({ id: 0 })).toThrow()
    await expect(bad.api.list({ pageSize: 25 })).rejects.toThrow('页面支持')
    expect(bad.calls).toHaveLength(1)
  })
})

describe('计价配置AI契约', () => {
  it('每个能力都有结构化契约，并明确真实环境验证缺口', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_VALUATION_METHODS))
    expect(validateAiContracts(contracts, { definitions: inventoryValuationCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: inventoryValuationCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    expect(Object.values(contracts).every(contract => contract.gaps?.some(gap => gap.includes('尚未在真实测试环境')))).toBe(true)
  })

  it('契约锁住Portal的创建/编辑线格式、分页和后续回查', () => {
    expect(methodContracts['inventoryValuation.create']?.boundaries.join(' ')).toContain('subtype是moveType拆分后的字符串')
    expect(methodContracts['inventoryValuation.update']?.boundaries.join(' ')).toContain('subtype经Number转换为数字')
    expect(contracts['inventory-valuation-prepare-create']?.steps[0]?.mapping?.draft).toContain('result.draft')
    expect(contracts['inventory-valuation-change-logs']?.inputs.materielId?.meaning).toContain('路由计价配置ID')
  })
})
