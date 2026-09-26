import type { AiContract } from './ai-contract.js'
import {
  PRODUCT_HATCHERY_METHODS,
  productHatcheryMethodCapabilities,
  PRODUCT_HATCHERY_METHOD_PAGE_PATH,
  PRODUCT_HATCHERY_METHOD_PERMISSION,
} from '../capabilities/product-hatchery-method.js'
import { PRODUCT_SETTING_HATCH_MANAGE_METHOD_AI_CONTRACTS } from './contracts-product-setting-hatch-manage-method.js'

const OLD_PREFIX = 'product-setting-hatch-manage-method'
const NEW_PREFIX = 'product-hatchery-method'
const OLD_METHOD_PREFIX = 'productSettingHatchManageMethod'
const NEW_METHOD_PREFIX = 'productHatcheryMethod'
const OLD_PAGE_PATH = '/dashboard/product/setting/hatch-manage/method/list'
const OLD_PERMISSION = '/dashboard/frame/breeding-plan/method'
const OLD_DOC = 'docs/pages/产品设置方法设置.md'
const NEW_DOC = 'docs/pages/方法设置-孵化预案.md'

function cloneAndRebind (value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll(OLD_PREFIX, NEW_PREFIX)
      .replaceAll(OLD_METHOD_PREFIX, NEW_METHOD_PREFIX)
      .replaceAll(OLD_PAGE_PATH, PRODUCT_HATCHERY_METHOD_PAGE_PATH)
      .replaceAll(OLD_PERMISSION, PRODUCT_HATCHERY_METHOD_PERMISSION)
      .replaceAll(OLD_DOC, NEW_DOC)
  }
  if (Array.isArray(value)) return value.map(cloneAndRebind)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndRebind(child)]))
  return value
}

const contracts = Object.fromEntries(productHatcheryMethodCapabilities.map(definition => {
  const sourceId = definition.id.replace(NEW_PREFIX, OLD_PREFIX)
  const source = PRODUCT_SETTING_HATCH_MANAGE_METHOD_AI_CONTRACTS[sourceId]
  if (!source) throw new Error(`孵化预案方法设置缺少对应养殖预案契约：${sourceId}`)
  const rebound = cloneAndRebind(source) as AiContract
  return [definition.id, {
    ...rebound,
    boundaries: [...rebound.boundaries, 'Portal孵化预案页面是包装器，实际复用养殖预案方法设置组件；SDK只复用接口和表单行为，不复用养殖预案页面路径或菜单权限。'],
    evidence: [...rebound.evidence, { source: 'app/portal/menus/product/operation.js、app/portal/views/dashboard/product/setting/hatchery-manage/method.vue 与 list.vue', kind: 'reference' as const, note: '核对孵化预案菜单路径、独立路由权限及其对养殖预案方法设置组件的包装复用关系。' }],
  }]
}))

for (const id of Object.keys(contracts)) if (!productHatcheryMethodCapabilities.some(definition => definition.id === id)) throw new Error(`孵化预案方法设置契约没有对应能力定义：${id}`)

export const PRODUCT_HATCHERY_METHOD_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_HATCHERY_METHOD_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HATCHERY_METHODS).map(([id, method]) => [
    `productHatcheryMethod.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productHatcheryMethod.${method}；写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
