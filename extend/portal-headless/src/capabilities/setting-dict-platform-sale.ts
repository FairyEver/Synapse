import type { PortalRequest } from '../session/types.js'
import { createSettingDictPlatformScopedCapabilities, createSettingDictPlatformScopedCapability } from './setting-dict-platform-scoped.js'
import type { SettingDictDataCreateInput, SettingDictDataGetInput, SettingDictDataQuery, SettingDictDataRemoveInput, SettingDictDataRow, SettingDictDataUpdateInput, SettingDictPlatformCapability, SettingDictPlatformId, SettingDictTypeQuery, SettingDictTypeRow } from './setting-dict-platform.js'

export const SETTING_DICT_PLATFORM_SALE_PAGE_PATH = '/dashboard/setting/dict-platform/sale/list'
export const SETTING_DICT_PLATFORM_SALE_PERMISSION = '/dashboard/setting/dict-platform/sale'
export const SETTING_DICT_PLATFORM_SALE_MODULE_TYPE = null
export const SETTING_DICT_PLATFORM_SALE_SYSTEM = 6

export type SettingDictPlatformSaleTypeQuery = SettingDictTypeQuery
export type SettingDictPlatformSaleTypeRow = SettingDictTypeRow
export type SettingDictPlatformSaleDataQuery = SettingDictDataQuery
export type SettingDictPlatformSaleDataRow = SettingDictDataRow
export type SettingDictPlatformSaleDataCreateInput = SettingDictDataCreateInput
export type SettingDictPlatformSaleDataGetInput = SettingDictDataGetInput
export type SettingDictPlatformSaleDataUpdateInput = SettingDictDataUpdateInput
export type SettingDictPlatformSaleDataRemoveInput = SettingDictDataRemoveInput
export type SettingDictPlatformSaleId = SettingDictPlatformId

export function createSettingDictPlatformSaleCapability (request: PortalRequest) {
  return createSettingDictPlatformScopedCapability(request, SETTING_DICT_PLATFORM_SALE_SYSTEM)
}
export type SettingDictPlatformSaleCapability = SettingDictPlatformCapability

export const SETTING_DICT_PLATFORM_SALE_METHODS = {
  'setting-dict-platform-sale-type-list': 'list',
  'setting-dict-platform-sale-data-list': 'dataList',
  'setting-dict-platform-sale-data-get': 'dataGet',
  'setting-dict-platform-sale-data-create': 'dataCreate',
  'setting-dict-platform-sale-data-update': 'dataUpdate',
  'setting-dict-platform-sale-data-remove': 'dataRemove',
} as const

export const settingDictPlatformSaleCapabilities = createSettingDictPlatformScopedCapabilities({ key: 'sale', label: '销售', pagePath: SETTING_DICT_PLATFORM_SALE_PAGE_PATH, permission: SETTING_DICT_PLATFORM_SALE_PERMISSION, system: SETTING_DICT_PLATFORM_SALE_SYSTEM })
