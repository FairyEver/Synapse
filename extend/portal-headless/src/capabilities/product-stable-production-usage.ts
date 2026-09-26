import type { PortalRequest } from '../session/types.js'
import {
  createProductProductionUsageCapability,
  productProductionUsageCapabilities,
  type ProductProductionUsageCapability,
  type ProductProductionUsageGroup,
  type ProductProductionUsageId,
  type ProductProductionUsageQuery,
  type ProductProductionUsageRow,
  type ProductProductionUsageTreeNode,
} from './product-production-usage.js'

/** Portal「产品运营 → 使用分析 → 稳产用户使用分析」。 */
export const PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH = '/dashboard/product/operation/business/usage-layer/list'
export const PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION = '/dashboard/product/operation/business/usage-layer'
const REPORT_URL = '/use/statistics/stableProductionRecordSituation'

export type ProductStableProductionUsageId = ProductProductionUsageId
export type ProductStableProductionUsageGroup = ProductProductionUsageGroup
export type ProductStableProductionUsageQuery = ProductProductionUsageQuery
export type ProductStableProductionUsageTreeNode = ProductProductionUsageTreeNode
export type ProductStableProductionUsageRow = ProductProductionUsageRow

export function createProductStableProductionUsageCapability (request: PortalRequest): ProductStableProductionUsageCapability {
  return createProductProductionUsageCapability(request, {
    treeType: '2',
    reportUrl: REPORT_URL,
    reportLabel: '稳产用户使用分析',
    treeLabel: '稳产用户使用分析',
  })
}

export type ProductStableProductionUsageCapability = ProductProductionUsageCapability

export const PRODUCT_STABLE_PRODUCTION_USAGE_METHODS = {
  'product-stable-production-usage-tree': 'tree',
  'product-stable-production-usage-list': 'list',
} as const

export const productStableProductionUsageCapabilities = productProductionUsageCapabilities({
  prefix: 'product-stable-production-usage',
  title: '稳产用户使用分析',
  pagePath: PRODUCT_STABLE_PRODUCTION_USAGE_PAGE_PATH,
  permission: PRODUCT_STABLE_PRODUCTION_USAGE_PERMISSION,
})
