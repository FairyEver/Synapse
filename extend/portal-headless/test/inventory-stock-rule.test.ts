import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryStockRuleCapability,
  INVENTORY_STOCK_RULE_METHODS,
  INVENTORY_STOCK_RULE_PAGE_PATH,
  inventoryStockRuleCapabilities,
} from '../src/capabilities/inventory-stock-rule.js'
import { INVENTORY_STOCK_RULE_AI_CONTRACTS as contracts, INVENTORY_STOCK_RULE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-inventory-stock-rule.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryStockRuleCapability(request), calls }
}

const row = { id: 4, materielCategoryId: 8, materielCategoryName: '办公用品', minPrice: 10, maxPrice: 100, type: 'A', typeName: '常规', subtype: 1, isUpdate: 1, createTime: '2026-09-23' }

describe('库存规则页面能力', () => {
  it('静态锁定页面删除拼接、候选依赖、权限和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/material.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/material/store/material-rule/list.vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/material/store/material-rule/[mode]/[id].vue'), 'utf8')
    const category = readFileSync(join(root, 'app/portal/components/portal/material/tree-select/materiel-category-new/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/stock/StockRuleController.java'), 'utf8')
    expect(menu).toContain(`path: '${INVENTORY_STOCK_RULE_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/admin-api/inventory/stock-rule/page'")
    expect(page).toContain("deleteURL: '/admin-api/inventory/stock-rule/delete'")
    expect(detail).toContain("/admin-api/inventory/stock-rule/typeList")
    expect(category).toContain("/admin-api/supply/materiel-category/tree")
    expect(controller).toContain('@RequestMapping("/inventory/stock-rule")')
    expect(controller).toContain('@DeleteMapping("/delete")')
    expect(inventoryStockRuleCapabilities.every(item => item.pagePath === INVENTORY_STOCK_RULE_PAGE_PATH && item.permission === '/dashboard/material/store/material-rule' && item.moduleType === 34 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表、类型字典、分类树和详情请求保留Portal默认分页', async () => {
    const f = fixture([{ list: [row], total: 1 }, [{ label: '常规', value: 'A', dictType: 'stock_rule', remark: '', status: 0 }], [{ id: 8, name: '办公用品', children: [] }], row])
    await expect(f.api.list()).resolves.toMatchObject({ total: 1 })
    await expect(f.api.typeList()).resolves.toEqual([{ label: '常规', value: 'A', dictType: 'stock_rule', remark: '', status: 0 }])
    await expect(f.api.materialCategoryTree()).resolves.toHaveLength(1)
    await expect(f.api.get({ id: 4 })).resolves.toMatchObject({ id: 4, type: 'A' })
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/stock-rule/page', method: 'get', params: { order: '', orderField: '', materielCategoryId: null, type: null, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/inventory/stock-rule/typeList', method: 'get' },
      { url: '/admin-api/supply/materiel-category/tree', method: 'get' },
      { url: '/admin-api/inventory/stock-rule/get', method: 'get', params: { id: 4 } },
    ])
  })

  it('创建、修改保留JSON字段，删除遵循Portal通用模块的/delete/{id}路径', async () => {
    const draft = { materielCategoryId: 8, minPrice: 10, maxPrice: 100, type: 'A', isUpdate: 1 as const }
    const f = fixture([undefined, undefined, undefined])
    expect(f.api.prepareCreate(draft)).toEqual({ draft })
    await f.api.create(draft)
    await f.api.update({ ...draft, id: '4' })
    await f.api.remove({ id: 4 })
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/stock-rule/create', method: 'post', data: draft },
      { url: '/admin-api/inventory/stock-rule/update', method: 'put', data: { ...draft, id: '4' } },
      { url: '/admin-api/inventory/stock-rule/delete/4', method: 'delete' },
    ])
  })

  it('非法价格、缺少修改ID和坏候选响应会失败', async () => {
    expect(() => fixture().api.prepareCreate({ minPrice: -1 })).toThrow('范围0至∞')
    expect(() => fixture().api.prepareUpdate({ type: 'A' })).toThrow('必须传id')
    await expect(fixture([null]).api.typeList()).rejects.toThrow('必须是数组')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
  })

  it('AI契约逐能力登记并显式记录Portal与Java删除路径冲突', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_STOCK_RULE_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INVENTORY_STOCK_RULE_METHODS).map(method => `inventoryStockRule.${method}`))])
    expect(contracts['inventory-stock-rule-remove']?.boundaries.join('\n')).toContain('/delete/{id}')
    expect(contracts['inventory-stock-rule-prepare-remove']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
