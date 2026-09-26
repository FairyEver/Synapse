import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryStockLocationCapability,
  INVENTORY_STOCK_LOCATION_METHODS,
  INVENTORY_STOCK_LOCATION_PAGE_PATH,
  inventoryStockLocationCapabilities,
} from '../src/capabilities/inventory-stock-location.js'
import { INVENTORY_STOCK_LOCATION_AI_CONTRACTS as contracts, INVENTORY_STOCK_LOCATION_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-inventory-stock-location.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryStockLocationCapability(request), calls }
}

const row = { id: 4, unitId: 8, unitName: '工厂', materielCategoryId: 9, materielCategoryName: '原料', name: '一号库', creator: 2, creatorName: '管理员', createTime: '2026-09-23', minQuantity: 1.25, maxQuantity: 100, status: true }

describe('库存配置页面能力', () => {
  it('静态锁定列表/新增/启停端点、按钮权限和Java接口', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/material.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/material/store/point-setting/list.vue'), 'utf8')
    const modal = readFileSync(join(root, 'app/portal/views/dashboard/material/store/point-setting/components/create-point.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/stock/StockLocationController.java'), 'utf8')
    expect(menu).toContain(`path: '${INVENTORY_STOCK_LOCATION_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/admin-api/inventory/stock-location/page'")
    expect(page).toContain("/admin-api/inventory/stock-location/open")
    expect(page).toContain("/admin-api/inventory/stock-location/close")
    expect(page).toContain('material:store:point-setting:status')
    expect(modal).toContain("/admin-api/inventory/stock-location/create")
    expect(modal).toContain('materielCategoryId')
    expect(controller).toContain('@RequestMapping("/inventory/stock-location")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/open")')
    expect(controller).toContain('@PutMapping("/close")')
    expect(inventoryStockLocationCapabilities.every(item => item.pagePath === INVENTORY_STOCK_LOCATION_PAGE_PATH && item.permission === '/dashboard/material/store/point-setting' && item.moduleType === 34 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表、所属单元树和物料分类树保留精确URL与筛选字段', async () => {
    const f = fixture([{ list: [row], total: 1 }, [{ id: 8, name: '工厂', children: [] }], [{ id: 9, name: '原料', children: [] }]])
    await expect(f.api.list({ unitId: 8, name: '一号', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    await expect(f.api.unitTree()).resolves.toHaveLength(1)
    await expect(f.api.materialCategoryTree()).resolves.toHaveLength(1)
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/stock-location/page', method: 'get', params: { order: '', orderField: '', unitId: 8, name: '一号', pageNo: 2, pageSize: 50 } },
      { url: '/admin-api/supply/organization/tree?isFactory=1&includeParents=1', method: 'get' },
      { url: '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree', method: 'get' },
    ])
  })

  it('创建固定status=true并保留数量null，启停严格按prepare→submit发送open或close', async () => {
    const rows = [{ unitId: 8, materielCategoryId: 9, name: '一号库', minQuantity: 1.25, maxQuantity: null }]
    const f = fixture([undefined, true, true])
    expect(f.api.prepareCreate({ rows })).toEqual({ rows: [{ ...rows[0], status: true }] })
    await f.api.create({ rows })
    const close = f.api.prepareSetStatus({ id: 4, currentStatus: true, status: false })
    expect(close).toEqual({ draft: { id: 4, status: false }, previous: { id: 4, status: true } })
    await f.api.setStatus({ draft: close.draft })
    const open = f.api.prepareSetStatus({ id: 4, currentStatus: false, status: true })
    expect(open).toEqual({ draft: { id: 4, status: true }, previous: { id: 4, status: false } })
    await f.api.setStatus({ draft: open.draft })
    expect(f.api.cancelSetStatus()).toEqual({ cancelled: true })
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/stock-location/create', method: 'post', data: [{ ...rows[0], status: true }] },
      { url: '/admin-api/inventory/stock-location/close', method: 'put', data: { id: 4 } },
      { url: '/admin-api/inventory/stock-location/open', method: 'put', data: { id: 4 } },
    ])
    expect(() => fixture().api.prepareSetStatus({ id: 4, currentStatus: true, status: true })).toThrow('相反')
  })

  it('非法名称/数量、坏树和非true启停响应会失败', async () => {
    expect(() => fixture().api.prepareCreate({ rows: [{ unitId: 8, materielCategoryId: 9, name: 'x'.repeat(21) }] })).toThrow('最多20个字符')
    expect(() => fixture().api.prepareCreate({ rows: [{ unitId: 8, materielCategoryId: 9, name: '库', minQuantity: 1.234 }] })).toThrow('最多保留2位小数')
    await expect(fixture([null]).api.unitTree()).rejects.toThrow('必须是数组')
    await expect(fixture([false]).api.setStatus({ draft: { id: 4, status: false } })).rejects.toThrow('不是true')
    expect(() => fixture().api.prepareSetStatus({ id: 4, currentStatus: true, status: true })).toThrow('相反')
  })

  it('AI契约逐能力登记并锁定列表不可达CRUD和启停回查', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_STOCK_LOCATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INVENTORY_STOCK_LOCATION_METHODS).map(method => `inventoryStockLocation.${method}`))])
    expect(contracts['inventory-stock-location-list']?.boundaries.join('\n')).toContain('没有编辑或删除按钮')
    expect(contracts['inventory-stock-location-set-status']?.steps.some(step => step.capabilityId === 'inventory-stock-location-list')).toBe(true)
    expect(contracts['inventory-stock-location-cancel-set-status']?.effect).toBe('local')
  })
})
