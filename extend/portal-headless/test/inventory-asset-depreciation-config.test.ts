import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryAssetDepreciationConfigCapability,
  INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS,
  INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH,
  inventoryAssetDepreciationConfigCapabilities,
} from '../src/capabilities/inventory-asset-depreciation-config.js'
import { INVENTORY_ASSET_DEPRECIATION_CONFIG_AI_CONTRACTS as contracts, INVENTORY_ASSET_DEPRECIATION_CONFIG_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-inventory-asset-depreciation-config.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryAssetDepreciationConfigCapability(request), calls }
}

const row = {
  id: 7, assetCategory: 2, depreciationMethod: 1, depreciationYear: 5, depreciationLifeMonth: 60,
  depreciationDate: 15, netSalvageValueRate: 5, materialCategory: 8, materialCategoryPath: '设备/机器',
  isCurrMonthDep: 1, isDepreciationReduction: 0,
}

describe('折旧配置页面能力', () => {
  it('静态锁定列表/详情依赖、按钮权限和Java端点', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/material.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/material/assets/setting/list.vue'), 'utf8')
    const detail = readFileSync(join(root, 'app/portal/views/dashboard/material/assets/setting/[mode]/[id].vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/assetdepreciationconfig/AssetDepreciationConfigController.java'), 'utf8')
    expect(menu).toContain(`path: '${INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/admin-api/inventory/asset-depreciation-config/page'")
    expect(page).toContain('material:assets:setting:create')
    expect(page).toContain('material:assets:setting:edit')
    expect(page).toContain('material:assets:setting:delete')
    expect(detail).toContain("/admin-api/inventory/asset-depreciation-config/get")
    expect(detail).toContain("/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree")
    expect(detail).toContain("/admin-api/inventory/asset-category/page")
    expect(detail).toContain('loopFetch')
    expect(detail).toContain('pageSize: 500')
    expect(controller).toContain('@RequestMapping("/inventory/asset-depreciation-config")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@PutMapping("/update")')
    expect(controller).toContain('@DeleteMapping("/delete")')
    expect(inventoryAssetDepreciationConfigCapabilities.every(item => item.pagePath === INVENTORY_ASSET_DEPRECIATION_CONFIG_PAGE_PATH && item.permission === '/dashboard/material/assets/setting' && item.moduleType === 31 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表、详情和两个候选源保留Portal请求形状', async () => {
    const f = fixture([{ list: [row], total: 1 }, { ...row, depreciationMethod: 2 }, { list: [{ id: 2, categoryName: '设备' }], total: 1 }, [{ id: 8, name: '设备', children: [] }], [{ id: 8, name: '设备', children: [] }]])
    await expect(f.api.list({ depreciationLifeMonth: 60, materialCategory: 8, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    await expect(f.api.get({ id: 7 })).resolves.toMatchObject({ id: 7, depreciationMethod: '2' })
    await expect(f.api.assetCategories()).resolves.toEqual([{ id: 2, categoryName: '设备', label: '设备', value: 2 }])
    await expect(f.api.materialCategoryTree(5)).resolves.toHaveLength(1)
    await expect(f.api.materialCategoryTree()).resolves.toHaveLength(1)
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/asset-depreciation-config/page', method: 'get', params: { order: '', orderField: '', depreciationLifeMonth: 60, materialCategory: 8, pageNo: 2, pageSize: 50 } },
      { url: '/admin-api/inventory/asset-depreciation-config/get', method: 'get', params: { id: 7 } },
      { url: '/admin-api/inventory/asset-category/page', method: 'get', params: { pageNo: 1, pageSize: 500 } },
      { url: '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree', method: 'get', params: { level: 5 } },
      { url: '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree', method: 'get' },
    ])
  })

  it('资产类别候选按Portal的loopFetch继续拉取后续页', async () => {
    const f = fixture([
      { list: [{ id: 2, categoryName: '设备' }], total: 501 },
      { list: [{ id: 3, categoryName: '车辆' }], total: 501 },
    ])
    await expect(f.api.assetCategories()).resolves.toEqual([
      { id: 2, categoryName: '设备', label: '设备', value: 2 },
      { id: 3, categoryName: '车辆', label: '车辆', value: 3 },
    ])
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/asset-category/page', method: 'get', params: { pageNo: 1, pageSize: 500 } },
      { url: '/admin-api/inventory/asset-category/page', method: 'get', params: { pageNo: 2, pageSize: 500 } },
    ])
  })

  it('创建、修改和删除按详情表单的空值与范围规则提交', async () => {
    const draft = { assetCategory: 2, depreciationMethod: 1, depreciationYear: 5, depreciationDate: 15, netSalvageValueRate: 5, materialCategory: '', isCurrMonthDep: 1 as const, isDepreciationReduction: 0 as const }
    const f = fixture([undefined, undefined, undefined])
    expect(f.api.prepareCreate(draft)).toEqual({ draft: { ...draft, materialCategory: null } })
    await f.api.create(draft)
    await f.api.update({ ...draft, id: '7', materialCategory: 8 })
    await f.api.remove({ id: 7 })
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/asset-depreciation-config/create', method: 'post', data: { ...draft, materialCategory: null } },
      { url: '/admin-api/inventory/asset-depreciation-config/update', method: 'put', data: { ...draft, id: '7', materialCategory: 8 } },
      { url: '/admin-api/inventory/asset-depreciation-config/delete', method: 'delete', params: { id: 7 } },
    ])
  })

  it('非法范围、缺少修改ID和坏树响应不会转成成功', async () => {
    expect(() => fixture().api.prepareCreate({ assetCategory: 2, depreciationMethod: 1, depreciationYear: 5, depreciationDate: 26, netSalvageValueRate: 5 })).toThrow('范围1至25')
    expect(() => fixture().api.prepareCreate({ assetCategory: 2, depreciationMethod: 1, depreciationYear: 5, depreciationDate: 15, netSalvageValueRate: 101 })).toThrow('范围0至100')
    expect(() => fixture().api.prepareUpdate({ assetCategory: 2, depreciationMethod: 1, depreciationYear: 5, depreciationDate: 15, netSalvageValueRate: 5 })).toThrow('必须传id')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([null]).api.materialCategoryTree()).rejects.toThrow('必须是数组')
  })

  it('AI契约逐能力登记并锁定创建取消与回查语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INVENTORY_ASSET_DEPRECIATION_CONFIG_METHODS).map(method => `inventoryAssetDepreciationConfig.${method}`))])
    expect(contracts['inventory-asset-depreciation-config-create']?.steps.some(step => step.capabilityId === 'inventory-asset-depreciation-config-list')).toBe(true)
    expect(contracts['inventory-asset-depreciation-config-prepare-update']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
