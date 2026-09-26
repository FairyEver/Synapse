import type { PortalRequest } from '../session/types.js'
import type { CapabilityDefinition, ParamSpec } from './types.js'
import {
  createSettingDictPlatformCapability,
  type SettingDictDataCreateInput,
  type SettingDictDataGetInput,
  type SettingDictDataQuery,
  type SettingDictDataRemoveInput,
  type SettingDictDataRow,
  type SettingDictTypeQuery,
  type SettingDictTypeRow,
  type SettingDictPlatformId,
} from './setting-dict-platform.js'

/** Portal「系统设置 → 系统字典 → 采购字典」及其可达的字典数据子页。 */
export const SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH = '/dashboard/setting/dict-platform/supply/list'
export const SETTING_DICT_PLATFORM_SUPPLY_PERMISSION = '/dashboard/setting/dict-platform/supply'
/** 该页面不命中 Portal 的按业务模块切分规则。 */
export const SETTING_DICT_PLATFORM_SUPPLY_MODULE_TYPE = null
export const SETTING_DICT_PLATFORM_SUPPLY_SYSTEM = 5

const TYPE_PAGE_URL = '/admin-api/system/dict-type/page'

/**
 * The shared dictionary page receives useSystem from the supply wrapper.
 * Keep that value fixed so callers cannot widen the root list to another system.
 */
function supplyRequest (request: PortalRequest): PortalRequest {
  return config => {
    if (config.url !== TYPE_PAGE_URL) return request(config)
    const params = (config.params ?? {}) as Record<string, unknown>
    return request({
      ...config,
      params: {
        order: params.order,
        orderField: params.orderField,
        useSystem: SETTING_DICT_PLATFORM_SUPPLY_SYSTEM,
        name: params.name,
        type: params.type,
        pageNo: params.pageNo,
        pageSize: params.pageSize,
      },
    })
  }
}

export type SettingDictPlatformSupplyTypeQuery = SettingDictTypeQuery
export type SettingDictPlatformSupplyTypeRow = SettingDictTypeRow
export type SettingDictPlatformSupplyDataQuery = SettingDictDataQuery
export type SettingDictPlatformSupplyDataRow = SettingDictDataRow
export type SettingDictPlatformSupplyDataCreateInput = SettingDictDataCreateInput
export type SettingDictPlatformSupplyDataGetInput = SettingDictDataGetInput
export type SettingDictPlatformSupplyDataRemoveInput = SettingDictDataRemoveInput
export type SettingDictPlatformSupplyId = SettingDictPlatformId

/** The injected request must be bound to SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH. */
export function createSettingDictPlatformSupplyCapability (request: PortalRequest) {
  return createSettingDictPlatformCapability(supplyRequest(request))
}

export type SettingDictPlatformSupplyCapability = ReturnType<typeof createSettingDictPlatformSupplyCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_DICT_PLATFORM_SUPPLY_METHODS = {
  'setting-dict-platform-supply-type-list': 'list',
  'setting-dict-platform-supply-data-list': 'dataList',
  'setting-dict-platform-supply-data-get': 'dataGet',
  'setting-dict-platform-supply-data-create': 'dataCreate',
  'setting-dict-platform-supply-data-update': 'dataUpdate',
  'setting-dict-platform-supply-data-remove': 'dataRemove',
} as const

export const settingDictPlatformSupplyCapabilities: CapabilityDefinition[] = [
  { id: 'setting-dict-platform-supply-type-list', title: '查询采购字典类型', write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-supply-data-list', title: '查询采购字典数据', write: false, params: [p('dictType', 'text', true, '从采购字典类型列表的type或当前路由获得'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-supply-data-get', title: '读取采购字典数据详情', write: false, params: [p('id', 'text', true, '字典数据主键')] },
  { id: 'setting-dict-platform-supply-data-create', title: '创建采购字典数据', write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-supply-data-update', title: '修改采购字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-supply-data-remove', title: '删除采购字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '来自列表行；true时Portal禁用编辑和删除')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH,
  permission: SETTING_DICT_PLATFORM_SUPPLY_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_DICT_PLATFORM_SUPPLY_MODULE_TYPE,
}))
