import type { AiContract } from './ai-contract.js'
import {
  PRODUCT_HIGH_PRODUCTION_USAGE_AI_CONTRACTS,
} from './contracts-product-high-production-usage.js'
import {
  PRODUCT_STABLE_PRODUCTION_USAGE_METHODS,
  productStableProductionUsageCapabilities,
} from '../capabilities/product-stable-production-usage.js'

function stableText (value: string): string {
  return value
    .replaceAll('product-high-production-usage', 'product-stable-production-usage')
    .replaceAll('productHighProductionUsage', 'productStableProductionUsage')
    .replaceAll('usage-chicken', 'usage-layer')
    .replaceAll('product-high-production-usage.test.ts', 'product-stable-production-usage.test.ts')
    .replaceAll('product-high-production-usage.ts', 'product-stable-production-usage.ts')
    .replaceAll('contracts-product-high-production-usage.ts', 'contracts-product-stable-production-usage.ts')
    .replaceAll('highProductionRecordSituation', 'stableProductionRecordSituation')
    .replaceAll('types=1', 'types=2')
    .replaceAll('高产', '稳产')
}

function rewrite (value: unknown): unknown {
  if (typeof value === 'string') return stableText(value)
  if (Array.isArray(value)) return value.map(rewrite)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rewrite(item)]))
  }
  return value
}

const highContracts = PRODUCT_HIGH_PRODUCTION_USAGE_AI_CONTRACTS
const contracts: Record<string, AiContract> = {
  'product-stable-production-usage-tree': rewrite(highContracts['product-high-production-usage-tree']) as AiContract,
  'product-stable-production-usage-list': rewrite(highContracts['product-high-production-usage-list']) as AiContract,
}

for (const id of Object.keys(contracts)) {
  if (!productStableProductionUsageCapabilities.some(definition => definition.id === id)) {
    throw new Error(`稳产用户使用分析契约没有对应能力定义：${id}`)
  }
}

export const PRODUCT_STABLE_PRODUCTION_USAGE_AI_CONTRACTS = contracts
export const PRODUCT_STABLE_PRODUCTION_USAGE_METHOD_CONTRACTS: Record<string, AiContract> = Object.fromEntries(
  Object.entries(PRODUCT_STABLE_PRODUCTION_USAGE_METHODS).map(([id, method]) => [
    `productStableProductionUsage.${method}`,
    { ...contracts[id]!, boundaries: [...contracts[id]!.boundaries, `直接方法路径为 productStableProductionUsage.${method}；该页面只有只读能力，不存在prepare、submit、cancel或导出动作。`] },
  ]),
)
