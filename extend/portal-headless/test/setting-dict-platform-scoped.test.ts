import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import type { SettingDictPlatformCapability } from '../src/capabilities/setting-dict-platform.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { createSettingDictPlatformHrCapability, SETTING_DICT_PLATFORM_HR_METHODS, SETTING_DICT_PLATFORM_HR_PAGE_PATH, SETTING_DICT_PLATFORM_HR_PERMISSION, SETTING_DICT_PLATFORM_HR_SYSTEM, settingDictPlatformHrCapabilities } from '../src/capabilities/setting-dict-platform-hr.js'
import { createSettingDictPlatformMaterialCapability, SETTING_DICT_PLATFORM_MATERIAL_METHODS, SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH, SETTING_DICT_PLATFORM_MATERIAL_PERMISSION, SETTING_DICT_PLATFORM_MATERIAL_SYSTEM, settingDictPlatformMaterialCapabilities } from '../src/capabilities/setting-dict-platform-material.js'
import { createSettingDictPlatformProductCapability, SETTING_DICT_PLATFORM_PRODUCT_METHODS, SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH, SETTING_DICT_PLATFORM_PRODUCT_PERMISSION, SETTING_DICT_PLATFORM_PRODUCT_SYSTEM, settingDictPlatformProductCapabilities } from '../src/capabilities/setting-dict-platform-product.js'
import { createSettingDictPlatformSupplyCapability, SETTING_DICT_PLATFORM_SUPPLY_METHODS, SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH, SETTING_DICT_PLATFORM_SUPPLY_PERMISSION, SETTING_DICT_PLATFORM_SUPPLY_SYSTEM, settingDictPlatformSupplyCapabilities } from '../src/capabilities/setting-dict-platform-supply.js'
import { createSettingDictPlatformSaleCapability, SETTING_DICT_PLATFORM_SALE_METHODS, SETTING_DICT_PLATFORM_SALE_PAGE_PATH, SETTING_DICT_PLATFORM_SALE_PERMISSION, SETTING_DICT_PLATFORM_SALE_SYSTEM, settingDictPlatformSaleCapabilities } from '../src/capabilities/setting-dict-platform-sale.js'

type RequestConfig = Parameters<PortalRequest>[0]
type PageConfig = {
  label: string
  key: string
  pagePath: string
  permission: string
  system: number
  listFile: string
  dataListFile: string
  dataFormFile: string
  create: (request: PortalRequest) => SettingDictPlatformCapability
  methods: Record<string, string>
  capabilityIds: string[]
  capabilities: Array<{ id: string; pagePath?: string; permission?: string; moduleType?: number | null; httpInstance?: string }>
}

function fixture (config: PageConfig, responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(requestConfig: RequestConfig) => {
    calls.push(requestConfig)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: config.create(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9107199254740993', name: '系统字典类型', type: 'system_dictionary_type', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 1, tenantEditable: 1 }
const dataRow = { id: '9107199254740994', sort: 1, label: '启用', value: 'enabled', dictType: 'system_dictionary_type', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 42, platform: false }

const pages: PageConfig[] = [
  { label: '人力', key: 'hr', pagePath: SETTING_DICT_PLATFORM_HR_PAGE_PATH, permission: SETTING_DICT_PLATFORM_HR_PERMISSION, system: SETTING_DICT_PLATFORM_HR_SYSTEM, listFile: 'app/portal/views/dashboard/common/setting/dict-platform/hr/list.vue', dataListFile: 'app/portal/views/dashboard/common/setting/dict-platform/hr/data/[type]/items.vue', dataFormFile: 'app/portal/views/dashboard/common/setting/dict-platform/hr/data/[type]/[mode]/[id].vue', create: createSettingDictPlatformHrCapability, methods: SETTING_DICT_PLATFORM_HR_METHODS, capabilityIds: ['setting-dict-platform-hr-type-list', 'setting-dict-platform-hr-data-list', 'setting-dict-platform-hr-data-get', 'setting-dict-platform-hr-data-create', 'setting-dict-platform-hr-data-update', 'setting-dict-platform-hr-data-remove'], capabilities: settingDictPlatformHrCapabilities },
  { label: '资产', key: 'material', pagePath: SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH, permission: SETTING_DICT_PLATFORM_MATERIAL_PERMISSION, system: SETTING_DICT_PLATFORM_MATERIAL_SYSTEM, listFile: 'app/portal/views/dashboard/common/setting/dict-platform/material/list.vue', dataListFile: 'app/portal/views/dashboard/common/setting/dict-platform/material/data/[type]/items.vue', dataFormFile: 'app/portal/views/dashboard/common/setting/dict-platform/material/data/[type]/[mode]/[id].vue', create: createSettingDictPlatformMaterialCapability, methods: SETTING_DICT_PLATFORM_MATERIAL_METHODS, capabilityIds: ['setting-dict-platform-material-type-list', 'setting-dict-platform-material-data-list', 'setting-dict-platform-material-data-get', 'setting-dict-platform-material-data-create', 'setting-dict-platform-material-data-update', 'setting-dict-platform-material-data-remove'], capabilities: settingDictPlatformMaterialCapabilities },
  { label: '生产', key: 'product', pagePath: SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH, permission: SETTING_DICT_PLATFORM_PRODUCT_PERMISSION, system: SETTING_DICT_PLATFORM_PRODUCT_SYSTEM, listFile: 'app/portal/views/dashboard/common/setting/dict-platform/product/list.vue', dataListFile: 'app/portal/views/dashboard/common/setting/dict-platform/product/data/[type]/items.vue', dataFormFile: 'app/portal/views/dashboard/common/setting/dict-platform/product/data/[type]/[mode]/[id].vue', create: createSettingDictPlatformProductCapability, methods: SETTING_DICT_PLATFORM_PRODUCT_METHODS, capabilityIds: ['setting-dict-platform-product-type-list', 'setting-dict-platform-product-data-list', 'setting-dict-platform-product-data-get', 'setting-dict-platform-product-data-create', 'setting-dict-platform-product-data-update', 'setting-dict-platform-product-data-remove'], capabilities: settingDictPlatformProductCapabilities },
  { label: '采购', key: 'supply', pagePath: SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH, permission: SETTING_DICT_PLATFORM_SUPPLY_PERMISSION, system: SETTING_DICT_PLATFORM_SUPPLY_SYSTEM, listFile: 'app/portal/views/dashboard/common/setting/dict-platform/supply/list.vue', dataListFile: 'app/portal/views/dashboard/common/setting/dict-platform/supply/data/[type]/items.vue', dataFormFile: 'app/portal/views/dashboard/common/setting/dict-platform/supply/data/[type]/[mode]/[id].vue', create: createSettingDictPlatformSupplyCapability, methods: SETTING_DICT_PLATFORM_SUPPLY_METHODS, capabilityIds: ['setting-dict-platform-supply-type-list', 'setting-dict-platform-supply-data-list', 'setting-dict-platform-supply-data-get', 'setting-dict-platform-supply-data-create', 'setting-dict-platform-supply-data-update', 'setting-dict-platform-supply-data-remove'], capabilities: settingDictPlatformSupplyCapabilities },
  { label: '销售', key: 'sale', pagePath: SETTING_DICT_PLATFORM_SALE_PAGE_PATH, permission: SETTING_DICT_PLATFORM_SALE_PERMISSION, system: SETTING_DICT_PLATFORM_SALE_SYSTEM, listFile: 'app/portal/views/dashboard/common/setting/dict-platform/sale/list.vue', dataListFile: 'app/portal/views/dashboard/common/setting/dict-platform/sale/data/[type]/items.vue', dataFormFile: 'app/portal/views/dashboard/common/setting/dict-platform/sale/data/[type]/[mode]/[id].vue', create: createSettingDictPlatformSaleCapability, methods: SETTING_DICT_PLATFORM_SALE_METHODS, capabilityIds: ['setting-dict-platform-sale-type-list', 'setting-dict-platform-sale-data-list', 'setting-dict-platform-sale-data-get', 'setting-dict-platform-sale-data-create', 'setting-dict-platform-sale-data-update', 'setting-dict-platform-sale-data-remove'], capabilities: settingDictPlatformSaleCapabilities },
]

describe.each(pages)('Portal 系统设置 → $label 字典', page => {
  it('逐页核对菜单 wrapper、共享子页、权限和能力目录', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, page.listFile)
    const dataList = read(portalRoot, page.dataListFile)
    const dataForm = read(portalRoot, page.dataFormFile)
    const sharedDataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const sharedDataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')
    expect(menu).toContain(`path: '${page.pagePath}'`)
    expect(menu).toContain(`permission: '${page.permission}'`)
    expect(list).toContain('ListPage')
    expect(list).toContain('SYSTEM_')
    expect(dataList).toContain('ListPage')
    expect(sharedDataList).toContain("'/admin-api/system/dict-data/page'")
    expect(dataForm).toContain('FormPage')
    expect(dataForm).toContain('SYSTEM_')
    expect(sharedDataForm).toContain("/admin-api/system/dict-data/")
    expect(page.capabilities.map(item => item.id)).toEqual(Object.keys(page.methods))
    expect(page.capabilityIds).toEqual(Object.keys(page.methods))
    expect(page.capabilities.every(item => item.pagePath === page.pagePath && item.permission === page.permission && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(page.pagePath).moduleType).toBeNull()
  })

  it('固定 useSystem 并复刻列表、详情、创建、更新、单条删除请求', async () => {
    const f = fixture(page, [{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '9107199254740995', true, true])
    await expect(f.api.list({ name: page.label, type: 'system', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [typeRow], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: page.system, name: page.label, type: 'system', pageNo: 2, pageSize: 50 } })
    await expect(f.api.dataList({ dictType: dataRow.dictType, label: dataRow.label, status: 0, pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [dataRow], total: 1 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: dataRow.dictType, label: dataRow.label, status: 0, pageNo: 1, pageSize: 20 } })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    expect(f.calls[2]).toEqual({ url: '/admin-api/system/dict-data/get', method: 'get', params: { id: dataRow.id } })
    await expect(f.api.dataCreate({ dictType: dataRow.dictType, label: '新值', value: 'new' })).resolves.toBe('9107199254740995')
    expect(f.calls[3]).toEqual({ url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: dataRow.dictType, label: '新值', value: 'new', status: 0, sort: 0, remark: '', dictType: dataRow.dictType } })
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: dataRow.dictType, label: '启用2', value: 'enabled2', sort: 2, status: 1, remark: '' })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/admin-api/system/dict-data/update', method: 'put', data: { id: dataRow.id, dictType: dataRow.dictType, label: '启用2', value: 'enabled2', sort: 2, status: 1, remark: '' } })
    await expect(f.api.dataRemove({ id: dataRow.id, platform: false })).resolves.toBe(true)
    expect(f.calls[5]).toEqual({ url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: dataRow.id } })
  })

  it('坏参数、平台行和坏响应在请求前或回执处失败', async () => {
    const f = fixture(page)
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: dataRow.dictType, label: ' ', value: 'x' })).rejects.toThrow('label')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: dataRow.dictType, label: '启用', value: 'enabled', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: dataRow.id, platform: true })).rejects.toThrow('只读')
    expect(f.calls).toHaveLength(0)
    await expect(fixture(page, [{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture(page, [false]).api.dataRemove({ id: dataRow.id })).rejects.toThrow('响应不是true')
  })
})
