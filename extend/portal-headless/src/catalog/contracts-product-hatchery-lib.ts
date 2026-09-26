import type { AiContract } from './ai-contract.js'
import {
  PRODUCT_HATCHERY_LIB_METHODS,
  productHatcheryLibCapabilities,
  PRODUCT_HATCHERY_LIB_PAGE_PATH,
  PRODUCT_HATCHERY_LIB_PERMISSION,
} from '../capabilities/product-hatchery-lib.js'
import { PRODUCT_SETTING_HATCH_MANAGE_LIB_AI_CONTRACTS } from './contracts-product-setting-hatch-manage-lib.js'

const OLD_PREFIX = 'product-setting-hatch-manage-lib'
const NEW_PREFIX = 'product-hatchery-lib'
const OLD_METHOD_PREFIX = 'productSettingHatchManageLib'
const NEW_METHOD_PREFIX = 'productHatcheryLib'
const OLD_PAGE_PATH = '/dashboard/product/setting/hatch-manage/lib/list'
const OLD_PERMISSION = '/dashboard/frame/breeding-plan/lib'

function cloneAndRebind (value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll(OLD_PREFIX, NEW_PREFIX)
      .replaceAll(OLD_METHOD_PREFIX, NEW_METHOD_PREFIX)
      .replaceAll(OLD_PAGE_PATH, PRODUCT_HATCHERY_LIB_PAGE_PATH)
      .replaceAll(OLD_PERMISSION, PRODUCT_HATCHERY_LIB_PERMISSION)
  }
  if (Array.isArray(value)) return value.map(cloneAndRebind)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndRebind(child)]))
  return value
}

const contracts = Object.fromEntries(productHatcheryLibCapabilities.map(definition => {
  const sourceId = definition.id.replace(NEW_PREFIX, OLD_PREFIX)
  const source = PRODUCT_SETTING_HATCH_MANAGE_LIB_AI_CONTRACTS[sourceId]
  if (!source) throw new Error(`孵化预案标准库缺少对应养殖标准库契约：${sourceId}`)
  const rebound = cloneAndRebind(source) as AiContract
  return [definition.id, {
    ...rebound,
    evidence: [...rebound.evidence, { source: 'docs/pages/标准库.md', kind: 'reference' as const, note: '记录孵化预案包装页面与实际复用组件的路径、权限、表单和证据边界。' }],
  }]
}))

export const PRODUCT_HATCHERY_LIB_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_HATCHERY_LIB_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HATCHERY_LIB_METHODS).map(([id, method]) => [
    `productHatcheryLib.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productHatcheryLib.${method}；页面组件来自Portal的hatch-manage/lib复用包装器。`] },
  ]),
)
