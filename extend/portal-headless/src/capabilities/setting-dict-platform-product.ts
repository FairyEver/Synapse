import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  createSettingDictPlatformCapability,
  type SettingDictDataCreateInput,
  type SettingDictDataGetInput,
  type SettingDictDataQuery,
  type SettingDictDataRemoveInput,
  type SettingDictDataRow,
  type SettingDictDataUpdateInput,
  type SettingDictTypeQuery,
  type SettingDictTypeRow,
  type SettingDictPlatformId,
} from './setting-dict-platform.js'

/** Portal「系统设置 → 生产字典」及其可达的字典数据子页。 */
export const SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH = '/dashboard/setting/dict-platform/product/list'
export const SETTING_DICT_PLATFORM_PRODUCT_PERMISSION = '/dashboard/setting/dict-platform/product'
/** 该页面不命中 Portal 的按业务模块切分规则。 */
export const SETTING_DICT_PLATFORM_PRODUCT_MODULE_TYPE = null
/** product/list.vue wrapper 传入的 SYSTEM_PRODUCT_VALUE。 */
export const SETTING_DICT_PLATFORM_PRODUCT_SYSTEM = 4

const TYPE_PAGE_URL = '/admin-api/system/dict-type/page'

/**
 * The product wrapper fixes useSystem before calling the shared dictionary page.
 * Data requests do not carry useSystem; their scope is the selected dictType.
 */
function productRequest (request: PortalRequest): PortalRequest {
  return config => {
    if (config.url !== TYPE_PAGE_URL) return request(config)
    const params = (config.params ?? {}) as Record<string, unknown>
    return request({
      ...config,
      params: {
        order: params.order,
        orderField: params.orderField,
        useSystem: SETTING_DICT_PLATFORM_PRODUCT_SYSTEM,
        name: params.name,
        type: params.type,
        pageNo: params.pageNo,
        pageSize: params.pageSize,
      },
    })
  }
}

export type SettingDictPlatformProductTypeQuery = SettingDictTypeQuery
export type SettingDictPlatformProductTypeRow = SettingDictTypeRow
export type SettingDictPlatformProductDataQuery = SettingDictDataQuery
export type SettingDictPlatformProductDataRow = SettingDictDataRow
export type SettingDictPlatformProductDataCreateInput = SettingDictDataCreateInput
export type SettingDictPlatformProductDataGetInput = SettingDictDataGetInput
export type SettingDictPlatformProductDataRemoveInput = SettingDictDataRemoveInput
export type SettingDictPlatformProductDataUpdateInput = SettingDictDataUpdateInput
export type SettingDictPlatformProductId = SettingDictPlatformId

/** The injected request must be bound to SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH. */
export function createSettingDictPlatformProductCapability (request: PortalRequest) {
  return createSettingDictPlatformCapability(productRequest(request))
}

export type SettingDictPlatformProductCapability = ReturnType<typeof createSettingDictPlatformProductCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_DICT_PLATFORM_PRODUCT_METHODS = {
  'setting-dict-platform-product-type-list': 'list',
  'setting-dict-platform-product-data-list': 'dataList',
  'setting-dict-platform-product-data-get': 'dataGet',
  'setting-dict-platform-product-data-create': 'dataCreate',
  'setting-dict-platform-product-data-update': 'dataUpdate',
  'setting-dict-platform-product-data-remove': 'dataRemove',
} as const

export const settingDictPlatformProductCapabilities: CapabilityDefinition[] = [
  { id: 'setting-dict-platform-product-type-list', title: '查询生产字典类型', write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-product-data-list', title: '查询生产字典数据', write: false, params: [p('dictType', 'text', true, '从生产字典类型列表的type或当前路由获得'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-product-data-get', title: '读取生产字典数据详情', write: false, params: [p('id', 'text', true, '字典数据主键')] },
  { id: 'setting-dict-platform-product-data-create', title: '创建生产字典数据', write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-product-data-update', title: '修改生产字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-product-data-remove', title: '删除生产字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '来自列表行；true时Portal禁用编辑和删除')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH,
  permission: SETTING_DICT_PLATFORM_PRODUCT_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_DICT_PLATFORM_PRODUCT_MODULE_TYPE,
}))
