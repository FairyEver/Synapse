import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryAssetBatchConfigCapability,
  INVENTORY_ASSET_BATCH_CONFIG_METHODS,
  INVENTORY_ASSET_BATCH_CONFIG_MODULE_TYPE,
  INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH,
  inventoryAssetBatchConfigCapabilities,
} from '../src/capabilities/inventory-asset-batch-config.js'
import {
  INVENTORY_ASSET_BATCH_CONFIG_AI_CONTRACTS as contracts,
  INVENTORY_ASSET_BATCH_CONFIG_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-inventory-asset-batch-config.js'

type RequestConfig = Parameters<PortalRequest>[0]

function setup (...results: unknown[]) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const result = results.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { api: createInventoryAssetBatchConfigCapability(request), calls }
}

const row = {
  id: '9007199254740993',
  configType: 1,
  categoryId: null,
  categoryName: null,
  categoryPathName: '原料-钢材',
  materielId: '3001',
  materielName: '钢板',
  materielCategoryId: '2001',
  materielCode: 'MAT-001',
  standardUnitId: '10',
  standardUnitName: '测试工厂',
  unit: 'KG',
  materielStatus: 1,
  batchEnabled: false,
  shelfLifeDays: null,
  creator: '11',
  creatorName: '创建人',
  createTime: '2026-09-24 10:00:00',
  updater: '12',
  updaterName: '修改人',
  updateTime: '2026-09-24 10:10:00',
}

afterEach(() => {
  delete process.env.PORTAL_REPO
})

describe('物料→库存管理→批次配置页面能力', () => {
  it('目录绑定、module-type、platform及Portal/Java页面端点逐项锁定', () => {
    expect(inventoryAssetBatchConfigCapabilities.map(item => item.id)).toEqual(Object.keys(INVENTORY_ASSET_BATCH_CONFIG_METHODS))
    expect(inventoryAssetBatchConfigCapabilities.every(item => item.pagePath === INVENTORY_ASSET_BATCH_CONFIG_PAGE_PATH)).toBe(true)
    expect(inventoryAssetBatchConfigCapabilities.every(item => item.permission === '/dashboard/material/store/batch-setting')).toBe(true)
    expect(inventoryAssetBatchConfigCapabilities.every(item => item.moduleType === INVENTORY_ASSET_BATCH_CONFIG_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(inventoryAssetBatchConfigCapabilities.filter(item => item.write).map(item => item.id)).toEqual([
      'inventory-asset-batch-config-create-materiel',
      'inventory-asset-batch-config-create-category',
      'inventory-asset-batch-config-enable-batch',
      'inventory-asset-batch-config-disable-batch',
      'inventory-asset-batch-config-remove',
    ])

    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const list = readFileSync(join(root, 'app/portal/views/dashboard/material/store/batch-setting/list.vue'), 'utf8')
    const form = readFileSync(join(root, 'app/portal/views/dashboard/material/store/batch-setting/[mode]/[id].vue'), 'utf8')
    const materialSelector = readFileSync(join(root, 'app/portal/components/portal/material/material-select-table/table-dialog.vue'), 'utf8')
    const categorySelector = readFileSync(join(root, 'app/portal/components/portal/material/tree-select/materiel-category/index.vue'), 'utf8')
    const unitSelector = readFileSync(join(root, 'app/portal/components/portal/material/tree-select/unit/index.vue'), 'utf8')
    expect(list).toContain("/admin-api/inventory/asset-batch-config/page")
    expect(list).toContain("http.put('/admin-api/inventory/asset-batch-config/disable-batch', null, { params: { id: record.id } })")
    expect(list).toContain("http.put('/admin-api/inventory/asset-batch-config/enable-batch', null, { params: { id: record.id } })")
    expect(list).toContain("http.delete('/admin-api/inventory/asset-batch-config/delete', { params: { id: record.id } })")
    expect(form).toContain("/admin-api/inventory/asset-batch-config/batch-create-materiel")
    expect(form).toContain("/admin-api/inventory/asset-batch-config/batch-create-materiel-category")
    expect(materialSelector).toContain("/admin-api/supply/materiel/page")
    expect(categorySelector).toContain("/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree")
    expect(unitSelector).toContain("/admin-api/supply/organization/tree?isFactory=1&includeParents=1")

    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/assetbatchconfig/AssetBatchConfigController.java'), 'utf8')
    for (const fragment of ['@PostMapping("/batch-create-materiel")', '@PostMapping("/batch-create-materiel-category")', '@PutMapping("/enable-batch")', '@PutMapping("/disable-batch")', '@DeleteMapping("/delete")']) expect(controller).toContain(fragment)
    expect(controller).toContain("@PreAuthorize(\"@ss.hasPermission('/dashboard/material/store/batch-setting')\")")
  })

  it('列表复刻Portal初始参数和后端分页投影，分类与组织候选使用真实端点', async () => {
    const categoryTree = [{ id: '2001', catName: '钢材', children: [{ id: 2002, catName: '板材', children: [] }] }]
    const unitTree = [{ id: '10', name: '测试工厂', isFactory: 1, children: [{ id: 11, name: '部门', isFactory: 0, children: [] }] }]
    const { api, calls } = setup({ list: [row], total: 1 }, categoryTree, unitTree)
    await expect(api.list({ materielName: '钢', categoryId: '2001', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(api.materialCategoryTree()).resolves.toMatchObject([{ id: '2001', name: '钢材', level: 1, children: [{ id: 2002, name: '板材', level: 2 }] }])
    await expect(api.unitTree()).resolves.toMatchObject([{ id: '10', disabled: false, children: [{ id: 11, disabled: true }] }])
    expect(calls).toEqual([
      { url: '/admin-api/inventory/asset-batch-config/page', method: 'get', params: { order: '', orderField: '', materielName: '钢', categoryId: '2001', pageNo: 2, pageSize: 50 } },
      { url: '/admin-api/inventory/asset-depreciation-config/get-materiel-category-tree', method: 'get', params: { level: 5 } },
      { url: '/admin-api/supply/organization/tree?isFactory=1&includeParents=1', method: 'get' },
    ])
  })

  it('物料候选要求关键字并只搜索启用物料，保留Portal候选展示字段', async () => {
    const page = { list: [{ id: '3001', matCode: 'MAT-001', matName: '钢板', unit: 'KG', categoryId: '2001', catNameCombination: '原料-钢材' }], total: 1 }
    const { api, calls } = setup(page)
    await expect(api.searchMaterials({ keyword: '  MAT- ', pageNo: 2, pageSize: 100 })).resolves.toEqual({
      list: [{ ...page.list[0], label: '钢板' }], total: 1,
    })
    expect(calls[0]).toEqual({
      url: '/admin-api/supply/materiel/page', method: 'get',
      params: { pageNo: 2, pageSize: 100, status: 1, matNameOrCoder: 'MAT-' },
    })
    const rejected = setup()
    await expect(rejected.api.searchMaterials({ keyword: ' ' })).rejects.toThrow('关键字')
    expect(rejected.calls).toHaveLength(0)
  })

  it('按物料与按分类的prepare→submit严格复刻两个批量payload，并拒绝重复行', async () => {
    const materialResult = setup(true)
    const materialRows = [{ materielId: '3001', materielCode: 'MAT-001', standardUnitId: '10', standardUnitName: '测试工厂', unit: 'KG', shelfLifeDays: 0 }]
    const materialPrepared = materialResult.api.prepareCreateMateriel({ rows: materialRows })
    expect(materialPrepared).toEqual({ draft: materialRows })
    await expect(materialResult.api.createMateriel(materialPrepared)).resolves.toBe(true)
    expect(materialResult.calls[0]).toEqual({ url: '/admin-api/inventory/asset-batch-config/batch-create-materiel', method: 'post', data: materialRows })

    const categoryResult = setup(true)
    const categoryRows = [{ categoryId: 2001, categoryName: '钢材', standardUnitId: 10, standardUnitName: '测试工厂', shelfLifeDays: 30 }]
    const categoryPrepared = categoryResult.api.prepareCreateCategory({ rows: categoryRows })
    await expect(categoryResult.api.createCategory(categoryPrepared)).resolves.toBe(true)
    expect(categoryResult.calls[0]).toEqual({ url: '/admin-api/inventory/asset-batch-config/batch-create-materiel-category', method: 'post', data: categoryRows })

    expect(() => materialResult.api.prepareCreateMateriel({ rows: [materialRows[0]!, { ...materialRows[0]! }] })).toThrow('重复')
    expect(() => materialResult.api.prepareCreateMateriel({ rows: [{ ...materialRows[0]!, shelfLifeDays: -1 }] })).toThrow('shelfLifeDays')
    expect(() => materialResult.api.prepareCreateCategory({ rows: [] })).toThrow('至少包含一行')
  })

  it('启停复刻PUT的null body与query id，删除严格遵守仅关闭状态可达', async () => {
    const ok = setup(true, true, true)
    const enable = ok.api.prepareEnableBatch({ id: row.id, currentBatchEnabled: false })
    const disable = ok.api.prepareDisableBatch({ id: row.id, currentBatchEnabled: true })
    const remove = ok.api.prepareRemove({ id: row.id, batchEnabled: false })
    await expect(ok.api.enableBatch({ draft: enable.draft })).resolves.toBe(true)
    await expect(ok.api.disableBatch({ draft: disable.draft })).resolves.toBe(true)
    await expect(ok.api.remove({ draft: remove.draft })).resolves.toBe(true)
    expect(ok.calls).toEqual([
      { url: '/admin-api/inventory/asset-batch-config/enable-batch', method: 'put', data: null, params: { id: row.id } },
      { url: '/admin-api/inventory/asset-batch-config/disable-batch', method: 'put', data: null, params: { id: row.id } },
      { url: '/admin-api/inventory/asset-batch-config/delete', method: 'delete', params: { id: row.id } },
    ])
    const rejected = setup()
    expect(() => rejected.api.prepareEnableBatch({ id: row.id, currentBatchEnabled: true })).toThrow('重复')
    expect(() => rejected.api.prepareDisableBatch({ id: row.id, currentBatchEnabled: false })).toThrow('重复')
    expect(() => rejected.api.prepareRemove({ id: row.id, batchEnabled: true })).toThrow('不显示删除按钮')
    expect(rejected.calls).toHaveLength(0)
  })

  it('写响应、取消路径和非法参数不会被吞掉', async () => {
    const failed = setup(false)
    await expect(failed.api.createMateriel({ draft: [{ materielId: 1, standardUnitId: 2, shelfLifeDays: 30 }] })).rejects.toThrow('不是true')
    expect(failed.calls).toHaveLength(1)
    const invalid = setup()
    expect(() => invalid.api.prepareCreateMateriel({ rows: [{ materielId: 1, standardUnitId: 2, shelfLifeDays: 1 }, { materielId: 1, standardUnitId: 2, shelfLifeDays: 2 }] })).toThrow()
    await expect(invalid.api.list({ pageSize: 25 })).rejects.toThrow('页面支持')
    expect(invalid.calls).toHaveLength(0)
  })
})

describe('批次配置AI契约', () => {
  it('每个能力都有结构化契约，并保留真实环境验证缺口', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_ASSET_BATCH_CONFIG_METHODS))
    expect(validateAiContracts(contracts, { definitions: inventoryAssetBatchConfigCapabilities, contracts })).toEqual([])
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: inventoryAssetBatchConfigCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(Object.keys(contracts).length).fill('incomplete-evidence'))
    expect(Object.values(contracts).every(contract => contract.gaps?.some(gap => gap.includes('尚未在真实测试环境')))).toBe(true)
  })

  it('关键动作契约锁住两个批量端点、启停请求映射和删除状态规则', () => {
    expect(methodContracts['inventoryAssetBatchConfig.createMateriel']?.boundaries.join(' ')).toContain('batch-create-materiel')
    expect(methodContracts['inventoryAssetBatchConfig.createCategory']?.boundaries.join(' ')).toContain('batch-create-materiel-category')
    expect(methodContracts['inventoryAssetBatchConfig.enableBatch']?.boundaries.join(' ')).toContain('body为null')
    expect(methodContracts['inventoryAssetBatchConfig.remove']?.boundaries.join(' ')).toContain('DELETE')
    expect(contracts['inventory-asset-batch-config-prepare-remove']?.inputs.batchEnabled?.meaning).toContain('必须为false')
  })
})
