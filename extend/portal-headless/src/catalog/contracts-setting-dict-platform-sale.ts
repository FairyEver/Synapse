import { createSettingDictPlatformScopedContracts } from './contracts-setting-dict-platform-scoped.js'
import { SETTING_DICT_PLATFORM_SALE_METHODS } from '../capabilities/setting-dict-platform-sale.js'

const scoped = createSettingDictPlatformScopedContracts({ key: 'sale', namespace: 'settingDictPlatformSale', label: '销售', system: 6, pagePath: '/dashboard/setting/dict-platform/sale/list', permission: '/dashboard/setting/dict-platform/sale', portalSource: 'app/portal/menus/common.js、app/portal/views/dashboard/common/setting/dict-platform/sale/list.vue、sale/data/[type]/**' })

export const SETTING_DICT_PLATFORM_SALE_AI_CONTRACTS = scoped.aiContracts
export const SETTING_DICT_PLATFORM_SALE_METHOD_CONTRACTS = scoped.methodContracts
export { SETTING_DICT_PLATFORM_SALE_METHODS }
