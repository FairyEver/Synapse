import type { AiContract } from './ai-contract.js'
import {
  PRODUCT_HATCHERY_UNIT_METHODS,
  productHatcheryUnitCapabilities,
  PRODUCT_HATCHERY_UNIT_PAGE_PATH,
  PRODUCT_HATCHERY_UNIT_PERMISSION,
} from '../capabilities/product-hatchery-unit.js'
import { PRODUCT_SETTING_HATCH_MANAGE_UNIT_AI_CONTRACTS } from './contracts-product-setting-hatch-manage-unit.js'

const OLD_PREFIX = 'product-setting-hatch-manage-unit'
const NEW_PREFIX = 'product-hatchery-unit'
const OLD_METHOD_PREFIX = 'productSettingHatchManageUnit'
const NEW_METHOD_PREFIX = 'productHatcheryUnit'
const OLD_PAGE_PATH = '/dashboard/product/setting/hatch-manage/unit/list'
const OLD_PERMISSION = '/dashboard/frame/breeding-plan/unit'

function cloneAndRebind (value: unknown): unknown {
  if (typeof value === 'string') {
    return value
      .replaceAll(OLD_PREFIX, NEW_PREFIX)
      .replaceAll(OLD_METHOD_PREFIX, NEW_METHOD_PREFIX)
      .replaceAll(OLD_PAGE_PATH, PRODUCT_HATCHERY_UNIT_PAGE_PATH)
      .replaceAll(OLD_PERMISSION, PRODUCT_HATCHERY_UNIT_PERMISSION)
      .replaceAll('养殖预案', '孵化预案')
      .replaceAll('docs/pages/产品设置标准设置.md', 'docs/pages/标准设置-孵化预案.md')
  }
  if (Array.isArray(value)) return value.map(cloneAndRebind)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneAndRebind(child)]))
  return value
}

const contracts = Object.fromEntries(productHatcheryUnitCapabilities.map(definition => {
  const sourceId = definition.id.replace(NEW_PREFIX, OLD_PREFIX)
  const source = PRODUCT_SETTING_HATCH_MANAGE_UNIT_AI_CONTRACTS[sourceId]
  if (!source) throw new Error(`孵化预案标准设置缺少对应养殖标准设置契约：${sourceId}`)
  const rebound = cloneAndRebind(source) as AiContract
  return [definition.id, {
    ...rebound,
    evidence: [
      ...rebound.evidence,
      { source: 'app/portal/views/dashboard/product/setting/hatchery-manage/unit/list.vue', kind: 'reference' as const, note: '核对孵化预案包装页面实际复用养殖预案标准设置组件，接口、列表筛选和表单提交规则保持一致，但路径和权限独立。' },
      { source: 'docs/pages/标准设置-孵化预案.md', kind: 'reference' as const, note: '记录孵化预案包装路由、独立权限、返回字段、写后回查和证据边界。' },
    ],
  }]
}))

export const PRODUCT_HATCHERY_UNIT_AI_CONTRACTS: Record<string, AiContract> = contracts
export const PRODUCT_HATCHERY_UNIT_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_HATCHERY_UNIT_METHODS).map(([id, method]) => [
    `productHatcheryUnit.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为productHatcheryUnit.${method}；页面组件来自Portal的hatchery-manage/unit包装器，写操作遵循prepare→submit→回查步骤。`] },
  ]),
)
