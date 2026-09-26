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

/** Portal「产品运营 → 使用分析 → 高产用户使用分析」。 */
export const PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH = '/dashboard/product/operation/business/usage-chicken/list'
export const PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION = '/dashboard/product/operation/business/usage-chicken'
const REPORT_URL = '/use/statistics/highProductionRecordSituation'

export type ProductHighProductionUsageId = ProductProductionUsageId
export type ProductHighProductionUsageGroup = ProductProductionUsageGroup
export type ProductHighProductionUsageQuery = ProductProductionUsageQuery
export type ProductHighProductionUsageTreeNode = ProductProductionUsageTreeNode
export type ProductHighProductionUsageRow = ProductProductionUsageRow

export function createProductHighProductionUsageCapability (request: PortalRequest): ProductHighProductionUsageCapability {
  return createProductProductionUsageCapability(request, {
    treeType: '1',
    reportUrl: REPORT_URL,
    reportLabel: '高产用户使用分析',
    treeLabel: '高产用户使用分析',
  })
}

export type ProductHighProductionUsageCapability = ProductProductionUsageCapability

export const PRODUCT_HIGH_PRODUCTION_USAGE_METHODS = {
  'product-high-production-usage-tree': 'tree',
  'product-high-production-usage-list': 'list',
} as const

export const productHighProductionUsageCapabilities = productProductionUsageCapabilities({
  prefix: 'product-high-production-usage',
  title: '高产用户使用分析',
  pagePath: PRODUCT_HIGH_PRODUCTION_USAGE_PAGE_PATH,
  permission: PRODUCT_HIGH_PRODUCTION_USAGE_PERMISSION,
})
