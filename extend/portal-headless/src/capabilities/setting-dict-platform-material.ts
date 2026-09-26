import type { PortalRequest } from '../session/types.js'
import { createSettingDictPlatformScopedCapabilities, createSettingDictPlatformScopedCapability } from './setting-dict-platform-scoped.js'
import type { SettingDictDataCreateInput, SettingDictDataGetInput, SettingDictDataQuery, SettingDictDataRemoveInput, SettingDictDataRow, SettingDictDataUpdateInput, SettingDictPlatformCapability, SettingDictPlatformId, SettingDictTypeQuery, SettingDictTypeRow } from './setting-dict-platform.js'

/** Portal「系统设置 → 资产字典」及其可达的字典数据子页。 */
export const SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH = '/dashboard/setting/dict-platform/material/list'
export const SETTING_DICT_PLATFORM_MATERIAL_PERMISSION = '/dashboard/setting/dict-platform/material'
export const SETTING_DICT_PLATFORM_MATERIAL_MODULE_TYPE = null
export const SETTING_DICT_PLATFORM_MATERIAL_SYSTEM = 3

export type SettingDictPlatformMaterialTypeQuery = SettingDictTypeQuery
export type SettingDictPlatformMaterialTypeRow = SettingDictTypeRow
export type SettingDictPlatformMaterialDataQuery = SettingDictDataQuery
export type SettingDictPlatformMaterialDataRow = SettingDictDataRow
export type SettingDictPlatformMaterialDataCreateInput = SettingDictDataCreateInput
export type SettingDictPlatformMaterialDataGetInput = SettingDictDataGetInput
export type SettingDictPlatformMaterialDataUpdateInput = SettingDictDataUpdateInput
export type SettingDictPlatformMaterialDataRemoveInput = SettingDictDataRemoveInput
export type SettingDictPlatformMaterialId = SettingDictPlatformId

export function createSettingDictPlatformMaterialCapability (request: PortalRequest) {
  return createSettingDictPlatformScopedCapability(request, SETTING_DICT_PLATFORM_MATERIAL_SYSTEM)
}

export type SettingDictPlatformMaterialCapability = SettingDictPlatformCapability

export const SETTING_DICT_PLATFORM_MATERIAL_METHODS = {
  'setting-dict-platform-material-type-list': 'list',
  'setting-dict-platform-material-data-list': 'dataList',
  'setting-dict-platform-material-data-get': 'dataGet',
  'setting-dict-platform-material-data-create': 'dataCreate',
  'setting-dict-platform-material-data-update': 'dataUpdate',
  'setting-dict-platform-material-data-remove': 'dataRemove',
} as const

export const settingDictPlatformMaterialCapabilities = createSettingDictPlatformScopedCapabilities({
  key: 'material',
  label: '资产',
  pagePath: SETTING_DICT_PLATFORM_MATERIAL_PAGE_PATH,
  permission: SETTING_DICT_PLATFORM_MATERIAL_PERMISSION,
  system: SETTING_DICT_PLATFORM_MATERIAL_SYSTEM,
})
