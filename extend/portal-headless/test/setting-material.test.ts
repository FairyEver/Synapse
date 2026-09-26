import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingMaterialCapability,
  SETTING_MATERIAL_METHODS,
  SETTING_MATERIAL_MODULE_TYPE,
  SETTING_MATERIAL_PAGE_PATH,
  SETTING_MATERIAL_PERMISSION,
  settingMaterialCapabilities,
} from '../src/capabilities/setting-material.js'
import { SETTING_MATERIAL_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-material.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingMaterialCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const material = {
  id: '9007199254740993', supplierId: 8, matCode: 'M-001', matName: '玉米-甲-袋', matDescribe: '玉米', img: null,
  unit: 'kg', type: 1, categoryId: 5, price: '1.20', purMethod: '1', status: 1, salesSystemId: null, isEntry: false,
  entryTime: null, giveScale: null, qualityStandards: null, specDes: '袋', internalUnitPrice: null, levelOfAttention: null,
  sysBrandId: null, sysBrandName: null, supplierName: '甲公司', supplierCode: 'S001', supplierAbbreviation: '甲',
  createTime: '2026-09-23 10:00:00', updateTime: '2026-09-23 10:00:00', updaterName: '管理员', addedByTenant: 1,
  selectable: true, categoryName: '一级/二级', viewSalesList: [], typeName: '采购视图',
}

describe('Portal 系统设置 → 物料管理页面能力', () => {
  it('逐页锁定菜单、列表、隐藏路由、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/material/list.vue')
    const create = read(portalRoot, 'app/portal/views/dashboard/hr/setting/material/[mode]/[id].vue')
    const detail = read(portalRoot, 'app/portal/views/dashboard/hr/setting/material/material-view/[id].vue')
    const conversion = read(portalRoot, 'app/portal/views/dashboard/hr/setting/material/material-spec-conversion/[id].vue')
    for (const fragment of [`path: '${SETTING_MATERIAL_PAGE_PATH}'`, `permission: '${SETTING_MATERIAL_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      "getDataListURL: '/admin-api/system/sys-materiel/page'", "matName: null", "matDescribe: null", "supplierId: null", "categoryId: null",
      "path: './material-view/' + record.id", "path: './material-spec-conversion/' + record.id", "url: '/admin-api/system/sys-materiel/delete'",
      "http.post('/admin-api/system/sys-materiel/update-use-tenant'", "title: '平台物料库中选择'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/sys-materiel-unit/simple-list'", "loopFetch", "pageSize: 500",
      "'/admin-api/system/sys-materiel-category/tree'", "'/admin-api/system/sys-materiel/batch-create'", "required: true",
    ]) expect(create).toContain(fragment)
    for (const fragment of ["'/admin-api/system/sys-materiel/get'", "'/admin-api/supply/materiel-receive-info/page'", "'/admin-api/system/materiel-view-sales/spec-groups-with-names'"]) expect(detail).toContain(fragment)
    for (const fragment of ["'/admin-api/system/sys-materiel-unit-conversion/list-by-materiel-id-group-by-prop'", "'/admin-api/system/sys-materiel-unit-conversion/batch-create'", "url: `/admin-api/system/sys-materiel-unit-conversion/delete`", '存在两个或以上换算组规格未填写']) expect(conversion).toContain(fragment)
    expect(settingMaterialCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_MATERIAL_METHODS))
    expect(settingMaterialCapabilities.every(item => item.pagePath === SETTING_MATERIAL_PAGE_PATH && item.permission === SETTING_MATERIAL_PERMISSION && item.moduleType === SETTING_MATERIAL_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_MATERIAL_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 的物料、平台租户、表单和单位换算规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const controller = read(root, 'controller/admin/materiel/SysMaterielController.java')
    const base = read(root, 'controller/admin/materiel/vo/SysMaterielBaseVO.java')
    const conversionController = read(root, 'controller/admin/materiel/SysMaterielUnitConversionController.java')
    const conversionService = read(root, 'service/materiel/SysMaterielUnitConversionServiceImpl.java')
    for (const fragment of ['@RequestMapping("/system/sys-materiel")', '@PostMapping("/batch-create")', '@DeleteMapping("/delete")', '@GetMapping("/select-platform-page")', '@PostMapping("/update-use-tenant")']) expect(controller).toContain(fragment)
    for (const fragment of ['@NotEmpty(message = "物料名称不能为空")', '@NotEmpty(message = "单位不能为空")', '@NotNull(message = "分类id不能为空")', 'private Long supplierId']) expect(base).toContain(fragment)
    for (const fragment of ['@PostMapping("/batch-create")', '@DeleteMapping("/delete")', 'list-by-materiel-id-group-by-prop']) expect(conversionController).toContain(fragment)
    for (const fragment of ['deleteUnitConversionByMaterielId(materielIds)', 'unitConversionMapper.insertBatch', 'getUnitConversionListByMaterielIdGroupByProp']) expect(conversionService).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖列表、准备、新建、删除、平台选择和详情辅助请求', async () => {
    const categoryTree = [{ id: 5, catName: '分类', children: [] }]
    const f = fixture([
      { list: [material], total: 1 },
      [{ unitName: 'kg' }], { list: [material], total: 1 }, categoryTree,
      ['101', '102'], true,
      { list: [material], total: 1 }, true,
      material,
      [{ shopId: 1, shopName: '店铺' }], [{ brandId: 2, brandName: '品牌' }], categoryTree, [{ propValueIds: '1', propValueNames: '20kg' }],
      { list: [{ id: 1, orgFullPath: '组织' }], total: 1 },
    ])
    await expect(f.api.list()).resolves.toEqual({ list: [material], total: 1 })
    await expect(f.api.prepareCreate()).resolves.toMatchObject({ units: [{ unitName: 'kg' }], suppliers: { total: 1 }, categories: categoryTree })
    await expect(f.api.create({ materials: [{ matName: '物料', matDescribe: '描述', categoryId: 5, unit: 'kg', supplierId: 8 }] })).resolves.toEqual(['101', '102'])
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    await expect(f.api.platformList()).resolves.toEqual({ list: [material], total: 1 })
    await expect(f.api.addPlatform({ materielIds: [101], tenantId: 8 })).resolves.toBe(true)
    await expect(f.api.get({ id: '9007199254740993' })).resolves.toEqual(material)
    await expect(f.api.viewLookups({ materielId: 101 })).resolves.toMatchObject({ shops: [{ shopId: 1 }], brands: [{ brandId: 2 }], specGroups: [{ propValueIds: '1' }] })
    await expect(f.api.receiveConfigList({ materielId: 101 })).resolves.toEqual({ list: [{ id: 1, orgFullPath: '组织' }], total: 1 })
    expect(f.calls).toEqual([
      { url: '/admin-api/system/sys-materiel/page', method: 'get', params: { order: '', orderField: '', matName: null, matDescribe: null, supplierId: null, categoryId: null, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/sys-materiel-unit/simple-list', method: 'get' },
      { url: '/admin-api/system/sys-supplier/page', method: 'get', params: { pageNo: 1, pageSize: 500 } },
      { url: '/admin-api/system/sys-materiel-category/tree', method: 'get' },
      { url: '/admin-api/system/sys-materiel/batch-create', method: 'post', data: [{ matName: '物料', matDescribe: '描述', categoryId: 5, unit: 'kg', supplierId: 8, matCode: '', supplierCode: '', specDes: '', isEntry: false, entryTime: null }] },
      { url: '/admin-api/system/sys-materiel/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/system/sys-materiel/select-platform-page', method: 'get', params: { order: '', orderField: '', matName: '', matDescribe: '', supplierId: '', categoryId: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/sys-materiel/update-use-tenant', method: 'post', data: { materielIds: [101], tenantId: 8 } },
      { url: '/admin-api/system/sys-materiel/get', method: 'get', params: { id: '9007199254740993' } },
      { url: '/admin-api/sales/shop/current-tenant-shops', method: 'get' },
      { url: '/admin-api/supply/materiel/brand-list', method: 'get', params: { materielId: 101 } },
      { url: '/sys/categoryCat/getTree', method: 'get', httpInstance: 'platform-mall-admin' },
      { url: '/admin-api/system/materiel-view-sales/spec-groups-with-names', method: 'get', params: { materielId: 101 } },
      { url: '/admin-api/supply/materiel-receive-info/page', method: 'get', params: { order: '', orderField: '', orgId: undefined, materielId: 101, pageNo: 1, pageSize: 20 } },
    ])
  })

  it('准备新增会按Portal的loopFetch继续拉取供应商后续页', async () => {
    const f = fixture([
      [{ unitName: 'kg' }],
      { list: [material], total: 501 },
      [{ id: 5, catName: '分类', children: [] }],
      { list: [{ ...material, id: 901 }], total: 501 },
    ])
    await expect(f.api.prepareCreate()).resolves.toMatchObject({ suppliers: { list: [material, { ...material, id: 901 }], total: 501 } })
    expect(f.calls).toEqual([
      { url: '/admin-api/system/sys-materiel-unit/simple-list', method: 'get' },
      { url: '/admin-api/system/sys-supplier/page', method: 'get', params: { pageNo: 1, pageSize: 500 } },
      { url: '/admin-api/system/sys-materiel-category/tree', method: 'get' },
      { url: '/admin-api/system/sys-supplier/page', method: 'get', params: { pageNo: 2, pageSize: 500 } },
    ])
  })

  it('单位换算上下文、整组替换和单条删除遵循页面规则', async () => {
    const rule = { id: 7, relUnit: 'kg', baseUnit: 'kg', coefficient: 1, targetUnit: '袋', targetCoefficient: 2, materielId: 101, propValueIds: '' }
    const f = fixture([material, [{ propValueIds: '', propValueNames: '' }], [{ propValueIds: '', propId: 0, list: [rule] }], [{ unitName: 'kg' }, { unitName: '袋' }], ['201'], true])
    await expect(f.api.conversionContext({ materielId: 101 })).resolves.toMatchObject({ materiel: material, rules: [{ list: [rule] }] })
    await expect(f.api.conversionSave({ materielId: 101, baseUnit: 'kg', groups: [{ items: [{ id: 7, targetUnit: '袋', targetCoefficient: 2 }] }] })).resolves.toEqual(['201'])
    await expect(f.api.conversionRemove({ id: 7 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/sys-materiel/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/system/materiel-view-sales/spec-groups-with-names', method: 'get', params: { materielId: 101 } },
      { url: '/admin-api/system/sys-materiel-unit-conversion/list-by-materiel-id-group-by-prop', method: 'get', params: { materielId: 101 } },
      { url: '/admin-api/system/sys-materiel-unit/simple-list', method: 'get' },
      { url: '/admin-api/system/sys-materiel-unit-conversion/batch-create', method: 'post', data: [{ id: 7, targetUnit: '袋', targetCoefficient: 2, relUnit: 'kg', baseUnit: 'kg', coefficient: 1, materielId: 101, groupId: 'group_0', propId: null, propValueIds: '' }] },
      { url: '/admin-api/system/sys-materiel-unit-conversion/delete', method: 'delete', params: { id: 7 } },
    ])
  })

  it('表单、平台选择、整组换算和坏响应在请求前或边界处失败', async () => {
    const f = fixture([])
    await expect(f.api.create({ materials: [{ matName: '物料', matDescribe: '描述', categoryId: 5, unit: 'kg', supplierId: 8, specDes: 'x'.repeat(21) }] })).rejects.toThrow('specDes')
    await expect(f.api.create({ materials: [{ matName: '物料', matDescribe: ' ', categoryId: 5, unit: 'kg', supplierId: 8 }] })).rejects.toThrow('matDescribe')
    await expect(f.api.addPlatform({ materielIds: [], tenantId: 8 })).rejects.toThrow('materielIds')
    await expect(f.api.conversionSave({ materielId: 101, baseUnit: 'kg', groups: [{ items: [{ targetUnit: '袋', targetCoefficient: 1 }] }, { items: [] }] })).rejects.toThrow('最多只能')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toEqual([])
    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('AI说明覆盖页面动作、表单规则、平台权限和换算整组替换，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_MATERIAL_METHODS).sort())
    expect(contracts['setting-material-create']?.inputs.materials?.constraints?.join(' ')).toContain('categoryId、unit、supplierId 必填。')
    expect(contracts['setting-material-conversion-save']?.boundaries.join(' ')).toContain('整组替换')
    expect(contracts['setting-material-add-platform']?.steps[0]).toMatchObject({ capabilityId: 'setting-material-list' })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
