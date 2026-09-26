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

/** Portal「系统设置 → 系统字典 → 财务字典」及其可达的字典数据子页。 */
export const SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH = '/dashboard/setting/dict-platform/finance/list'
export const SETTING_DICT_PLATFORM_FINANCE_PERMISSION = '/dashboard/setting/dict-platform/finance'
/** 该页面不命中 Portal 的按业务模块切分规则。 */
export const SETTING_DICT_PLATFORM_FINANCE_MODULE_TYPE = null
export const SETTING_DICT_PLATFORM_FINANCE_SYSTEM = 2

const TYPE_PAGE_URL = '/admin-api/system/dict-type/page'

/**
 * The shared page receives useSystem from the finance wrapper. Keep that value
 * fixed in the headless request so callers cannot widen the page to another system.
 */
function financeRequest (request: PortalRequest): PortalRequest {
  return config => {
    if (config.url !== TYPE_PAGE_URL) return request(config)
    const params = (config.params ?? {}) as Record<string, unknown>
    return request({
      ...config,
      params: {
        order: params.order,
        orderField: params.orderField,
        useSystem: SETTING_DICT_PLATFORM_FINANCE_SYSTEM,
        name: params.name,
        type: params.type,
        pageNo: params.pageNo,
        pageSize: params.pageSize,
      },
    })
  }
}

export type SettingDictPlatformFinanceTypeQuery = SettingDictTypeQuery
export type SettingDictPlatformFinanceTypeRow = SettingDictTypeRow
export type SettingDictPlatformFinanceDataQuery = SettingDictDataQuery
export type SettingDictPlatformFinanceDataRow = SettingDictDataRow
export type SettingDictPlatformFinanceDataCreateInput = SettingDictDataCreateInput
export type SettingDictPlatformFinanceDataGetInput = SettingDictDataGetInput
export type SettingDictPlatformFinanceDataRemoveInput = SettingDictDataRemoveInput
export type SettingDictPlatformFinanceId = SettingDictPlatformId

/** The injected request must be bound to SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH. */
export function createSettingDictPlatformFinanceCapability (request: PortalRequest) {
  return createSettingDictPlatformCapability(financeRequest(request))
}

export type SettingDictPlatformFinanceCapability = ReturnType<typeof createSettingDictPlatformFinanceCapability>

const p = (name: string, kind: ParamSpec['kind'], required: boolean, description: string): ParamSpec => ({ name, kind, required, description })

export const SETTING_DICT_PLATFORM_FINANCE_METHODS = {
  'setting-dict-platform-finance-type-list': 'list',
  'setting-dict-platform-finance-data-list': 'dataList',
  'setting-dict-platform-finance-data-get': 'dataGet',
  'setting-dict-platform-finance-data-create': 'dataCreate',
  'setting-dict-platform-finance-data-update': 'dataUpdate',
  'setting-dict-platform-finance-data-remove': 'dataRemove',
} as const

export const settingDictPlatformFinanceCapabilities: CapabilityDefinition[] = [
  { id: 'setting-dict-platform-finance-type-list', title: '查询财务字典类型', write: false, params: [p('name', 'text', false, '字典名称，模糊筛选'), p('type', 'text', false, '字典类型，模糊筛选'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-finance-data-list', title: '查询财务字典数据', write: false, params: [p('dictType', 'text', true, '从财务字典类型列表的type或当前路由获得'), p('label', 'text', false, '字典标签，模糊筛选'), p('status', 'number', false, '状态：0开启、1关闭'), p('pageNo', 'number', false, '页码，默认1'), p('pageSize', 'number', false, '每页条数，页面支持10、20、50、100，默认20')] },
  { id: 'setting-dict-platform-finance-data-get', title: '读取财务字典数据详情', write: false, params: [p('id', 'text', true, '字典数据主键')] },
  { id: 'setting-dict-platform-finance-data-create', title: '创建财务字典数据', write: true, params: [p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭，默认0'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-finance-data-update', title: '修改财务字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('dictType', 'text', true, '字典类型代码'), p('label', 'text', true, '字典标签'), p('value', 'text', true, '字典值'), p('sort', 'number', false, '非负排序，默认0'), p('status', 'number', false, '状态：0开启、1关闭'), p('remark', 'text', false, '备注')] },
  { id: 'setting-dict-platform-finance-data-remove', title: '删除财务字典数据', write: true, params: [p('id', 'text', true, '字典数据主键'), p('platform', 'boolean', false, '来自列表行；true时Portal禁用编辑和删除')] },
].map(definition => ({
  ...definition,
  pagePath: SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH,
  permission: SETTING_DICT_PLATFORM_FINANCE_PERMISSION,
  httpInstance: 'platform',
  moduleType: SETTING_DICT_PLATFORM_FINANCE_MODULE_TYPE,
}))
