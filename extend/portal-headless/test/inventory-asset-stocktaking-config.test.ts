import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH,
  INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION,
  createInventoryAssetStocktakingConfigCapability,
  inventoryAssetStocktakingConfigCapabilities,
} from '../src/capabilities/inventory-asset-stocktaking-config.js'
import { INVENTORY_ASSET_STOCKTAKING_CONFIG_AI_CONTRACTS as contracts } from '../src/catalog/contracts-inventory-asset-stocktaking-config.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryAssetStocktakingConfigCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const page = {
  list: [{
    id: 7001,
    type: 3,
    typeName: '清盘',
    orgId: 1001,
    orgName: '石家庄分公司',
    stocktakerUserId: 2001,
    stocktakerUserName: '张三',
    triggerMonth: 11,
    triggerDay: 20,
    createTime: '2026-09-24 10:00:00',
    updateTime: '2026-09-24 10:00:00',
  }],
  total: 1,
}
const users = { list: [{ id: 2001, realName: '张三', nickname: 'zhangsan', code: 'A001' }], total: 1 }

describe('Portal 物料 → 资产 → 盘点配置页面能力', () => {
  it('逐页锁定菜单、模块、列表、弹窗、按钮权限和日期序列化规则', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/material.js')
    const route = read(root, 'app/portal/views/dashboard/material/assets/stocktaking-config.vue')
    const list = read(root, 'app/portal/views/dashboard/material/assets/stocktaking-config/list.vue')
    const form = read(root, 'app/portal/views/dashboard/material/assets/stocktaking-config/components/form-modal.vue')

    expect(menu).toContain(`path: '${INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION}'`)
    for (const fragment of [
      `permission: ${INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION}`,
      'common-layout-dashboard-crud-container',
    ]) expect(route).toContain(fragment)
    for (const fragment of [
      "http.get('/admin-api/inventory/asset-stocktaking-config/page'",
      'params: {',
      "omit(form, ['createTime'])",
      'createTime:',
      "paramsArrayFormat: 'repeat'",
      'getDataListIsPage: true',
      "http.delete('/admin-api/inventory/asset-stocktaking-config/delete'",
      "buttonPermissionFlag('material:assets:stocktaking-config:create')",
      "buttonPermissionFlag('material:assets:stocktaking-config:edit')",
      "buttonPermissionFlag('material:assets:stocktaking-config:delete')",
      "http.get('/admin-api/system/user/simple-page'",
      'pageSize: 500',
      'companyUnitId: orgId',
    ]) expect(`${list}\n${form}`).toContain(fragment)
    for (const fragment of [
      "getPlatformDictListByType('inventory_stocktaking_type', true)",
      '[2, 3].includes(Number(item.value))',
      'toStocktakingTypeNumber',
      'isClearInventory',
      '清盘配置必须填写触发月日',
      'triggerMonth: isClearInventory.value ? formState.triggerMonth : null',
      'triggerDay: isClearInventory.value ? formState.triggerDay : null',
      "http.post('/admin-api/inventory/asset-stocktaking-config/create', payload)",
      "http.put('/admin-api/inventory/asset-stocktaking-config/update', payload)",
      'formState.id',
    ]) expect(form).toContain(fragment)

    expect(resolveModuleType(INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH).moduleType).toBe(INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE)
    expect(inventoryAssetStocktakingConfigCapabilities).toHaveLength(Object.keys(INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS).length)
    expect(inventoryAssetStocktakingConfigCapabilities.every(item => item.pagePath === INVENTORY_ASSET_STOCKTAKING_CONFIG_PAGE_PATH && item.permission === INVENTORY_ASSET_STOCKTAKING_CONFIG_PERMISSION && item.moduleType === INVENTORY_ASSET_STOCKTAKING_CONFIG_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    const bindingIds = new Set(CAPABILITY_BINDINGS.map(binding => binding.capabilityId))
    for (const id of Object.keys(INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS)) expect(bindingIds).toContain(id)
  })

  it('逐页锁定 Java Controller、VO、Service、Mapper 和按钮/页面权限', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = join(root, 'erp-module-inventory/erp-module-inventory-biz/src/main')
    const controller = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/assetstocktakingconfig/AssetStocktakingConfigController.java')
    const pageReq = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/assetstocktakingconfig/vo/AssetStocktakingConfigPageReqVO.java')
    const saveReq = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/assetstocktakingconfig/vo/AssetStocktakingConfigSaveReqVO.java')
    const response = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/assetstocktakingconfig/vo/AssetStocktakingConfigRespVO.java')
    const service = read(base, 'java/com/wdbc/erp/module/inventory/service/assetstocktakingconfig/AssetStocktakingConfigServiceImpl.java')
    const mapper = read(root, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/dal/mysql/assetstocktaking/AssetStocktakingConfigMapper.java')

    for (const fragment of [
      '@RequestMapping("/inventory/asset-stocktaking-config")',
      '@PostMapping("/create")',
      '@PutMapping("/update")',
      '@DeleteMapping("/delete")',
      '@GetMapping("/page")',
      "material:assets:stocktaking-config:create",
      "material:assets:stocktaking-config:edit",
      "material:assets:stocktaking-config:delete",
      "'/dashboard/material/assets/stocktaking-config'",
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['private Integer type', 'private Long orgId', 'private Long stocktakerUserId', 'private Integer triggerMonth', 'private Integer triggerDay', '@Min(value = 1', '@Max(value = 12']) expect(`${pageReq}\n${saveReq}\n${response}`).toContain(fragment)
    for (const fragment of ['ASSET_STOCKTAKING_CONFIG_TYPE_IMMUTABLE', 'ASSET_STOCKTAKING_CONFIG_DUPLICATE', 'sanitizeByType', '清盘配置必须填写触发月日', 'ASSET_STOCKTAKING_CONFIG_REFERENCED']) expect(service).toContain(fragment)
    for (const fragment of ['getType, reqVO.getType()', 'getOrgId, reqVO.getOrgId()', 'getStocktakerUserId, reqVO.getStocktakerUserId()', 'betweenIfPresent', 'orderByDesc(AssetStocktakingConfigDO::getId)']) expect(mapper).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖分页、重复数组、长选项搜索和表单提交', async () => {
    const f = fixture([page, users, 7002, true, true])
    await expect(f.api.list({ type: 3, stocktakerUserId: 2001, orgId: 1001, createTime: ['2026-09-01', '2026-09-24'], pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [expect.objectContaining({ id: 7001, type: 3, triggerMonth: 11, triggerDay: 20 })], total: 1 })
    await expect(f.api.searchStocktakerUsers({ keyword: '张', orgId: 1001, pageSize: 50 })).resolves.toEqual({ list: [expect.objectContaining({ id: 2001, label: '张三(A001)' })], total: 1 })
    const create = f.api.prepareCreate({ type: 2, orgId: 1001, stocktakerUserId: 2001, triggerMonth: 11, triggerDay: 20 })
    expect(create.draft).toEqual({ type: 2, orgId: 1001, stocktakerUserId: 2001, triggerMonth: null, triggerDay: null })
    await expect(f.api.create(create)).resolves.toBe(7002)
    const update = f.api.prepareUpdate({ id: 7002, type: 3, orgId: 1001, stocktakerUserId: 2001, triggerMonth: 11, triggerDay: 20 })
    await expect(f.api.update(update)).resolves.toBe(true)
    await expect(f.api.remove({ id: 7002 })).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/asset-stocktaking-config/page', method: 'get', params: { order: '', orderField: '', type: 3, stocktakerUserId: 2001, orgId: 1001, pageNo: 2, pageSize: 50, createTime: ['2026-09-01 00:00:00', '2026-09-24 23:59:59'] }, paramsArrayFormat: 'repeat' },
      { url: '/admin-api/system/user/simple-page', method: 'get', params: { pageNo: 1, pageSize: 50, nickname: '张', companyUnitId: 1001 } },
      { url: '/admin-api/inventory/asset-stocktaking-config/create', method: 'post', data: { type: 2, orgId: 1001, stocktakerUserId: 2001, triggerMonth: null, triggerDay: null } },
      { url: '/admin-api/inventory/asset-stocktaking-config/update', method: 'put', data: { id: 7002, type: 3, orgId: 1001, stocktakerUserId: 2001, triggerMonth: 11, triggerDay: 20 } },
      { url: '/admin-api/inventory/asset-stocktaking-config/delete', method: 'delete', params: { id: 7002 } },
    ])
  })

  it('反证清盘日期、不可用类型、长选项和坏响应不能静默通过', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ type: 2, orgId: 1001, stocktakerUserId: 2001, triggerMonth: 2, triggerDay: 31 })).not.toThrow()
    expect(() => f.api.prepareCreate({ type: 3, orgId: 1001, stocktakerUserId: 2001, triggerMonth: null, triggerDay: 20 })).toThrow('清盘配置必须填写')
    expect(() => f.api.prepareCreate({ type: 1 as never, orgId: 1001, stocktakerUserId: 2001, triggerMonth: null, triggerDay: null })).toThrow('只能是2')
    await expect(f.api.searchStocktakerUsers({ keyword: '' })).rejects.toThrow('必须先提供关键字')
    await expect(fixture([{}]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ list: [], total: -1 }]).api.searchStocktakerUsers({ keyword: '张' })).rejects.toThrow('有效list或total')
    await expect(fixture([page, 0]).api.create({ draft: { type: 2, orgId: 1001, stocktakerUserId: 2001, triggerMonth: null, triggerDay: null } })).rejects.toThrow('返回的id')
    await expect(fixture([page, true, false]).api.update({ draft: { id: 7002, type: 3, orgId: 1001, stocktakerUserId: 2001, triggerMonth: 11, triggerDay: 20 } })).rejects.toThrow('不是true')
  })

  it('AI说明登记了页面规则、类型联动、权限和后续回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(INVENTORY_ASSET_STOCKTAKING_CONFIG_METHODS).sort())
    expect(contracts['inventory-asset-stocktaking-config-create']?.boundaries.join(' ')).toContain('POST /admin-api/inventory/asset-stocktaking-config/create')
    expect(contracts['inventory-asset-stocktaking-config-update']?.boundaries.join(' ')).toContain('PUT /admin-api/inventory/asset-stocktaking-config/update')
    expect(contracts['inventory-asset-stocktaking-config-search-users']?.boundaries.join(' ')).toContain('关键字')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
