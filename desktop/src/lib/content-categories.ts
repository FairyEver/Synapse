import { getContentTypeDefinition } from "@/config/content-types"
import type {
  SynapseCategoryDefinition,
  SynapseCategoryStatsResult,
  SynapseCategoryViewItem,
} from "@/types/category"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

export const SYNAPSE_ALL_CATEGORY_ID = "__all__"
export const SYNAPSE_FALLBACK_CATEGORY_ID = "__fallback__"
export const SYNAPSE_FAVORITES_CATEGORY_ID = "__favorites__"
export const SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID = "__recently_viewed__"
export const SYNAPSE_DELETED_CATEGORY_ID = "__deleted__"

function compareCategoryDefinitions(
  left: SynapseCategoryDefinition,
  right: SynapseCategoryDefinition,
): number {
  if (left.order !== right.order) {
    return left.order - right.order
  }

  return left.label.localeCompare(right.label, "zh-CN")
}

function getContentTypeLabel(contentType: SynapseContentType): string {
  return getContentTypeDefinition(contentType).pluralLabel
}

function getSortedCategoryDefinitions(contentType: SynapseContentType): SynapseCategoryDefinition[] {
  return [...getContentTypeDefinition(contentType).categories].sort(compareCategoryDefinitions)
}

function getCategoryDefinitionMap(
  contentType: SynapseContentType,
): Map<string, SynapseCategoryDefinition> {
  return new Map(
    getSortedCategoryDefinitions(contentType).map((category) => [category.id, category]),
  )
}

function createAllCategoryItem(
  contentType: SynapseContentType,
  totalCount: number,
): SynapseCategoryViewItem {
  return {
    id: SYNAPSE_ALL_CATEGORY_ID,
    label: "全部",
    description: `显示当前 ${getContentTypeLabel(contentType)} 模块的全部内容。`,
    order: -1,
    count: totalCount,
    isAll: true,
  }
}

function createFallbackCategoryItem(
  contentType: SynapseContentType,
  count: number,
): SynapseCategoryViewItem {
  return {
    id: SYNAPSE_FALLBACK_CATEGORY_ID,
    label: "未识别分类",
    description: `用于承接当前 ${getContentTypeLabel(contentType)} 配置中不存在的历史分类。`,
    order: Number.MAX_SAFE_INTEGER,
    count,
    isFallback: true,
  }
}

function getCategoryDefinitions(contentType: SynapseContentType): SynapseCategoryDefinition[] {
  return getSortedCategoryDefinitions(contentType)
}

function getCategoryDefinition(
  contentType: SynapseContentType,
  categoryId: string,
): SynapseCategoryDefinition | null {
  return getCategoryDefinitionMap(contentType).get(categoryId) ?? null
}

function resolveCategoryViewId(
  contentType: SynapseContentType,
  categoryId: string,
): string {
  return getCategoryDefinition(contentType, categoryId)
    ? categoryId
    : SYNAPSE_FALLBACK_CATEGORY_ID
}

function getCategoryLabel(
  contentType: SynapseContentType,
  categoryId: string,
): string {
  const definition = getCategoryDefinition(contentType, categoryId)

  return definition?.label ?? createFallbackCategoryItem(contentType, 0).label
}

function buildCategoryStats<T extends SynapseContentType>(
  contentType: T,
  items: SynapseContentMeta<T>[],
): SynapseCategoryStatsResult {
  const categoryDefinitions = getCategoryDefinitions(contentType)
  const categoryDefinitionMap = getCategoryDefinitionMap(contentType)
  const counts = new Map<string, number>()
  const unknownCategoryIds = new Set<string>()
  let fallbackCount = 0

  for (const category of categoryDefinitions) {
    counts.set(category.id, 0)
  }

  for (const item of items) {
    if (categoryDefinitionMap.has(item.category)) {
      counts.set(item.category, (counts.get(item.category) ?? 0) + 1)
      continue
    }

    fallbackCount += 1
    unknownCategoryIds.add(item.category)
  }

  const viewItems = categoryDefinitions.map((category) => ({
    ...category,
    count: counts.get(category.id) ?? 0,
  }))

  if (fallbackCount > 0) {
    viewItems.push(createFallbackCategoryItem(contentType, fallbackCount))
  }

  return {
    items: [createAllCategoryItem(contentType, items.length), ...viewItems],
    totalCount: items.length,
    unknownCategoryIds: [...unknownCategoryIds].sort((left, right) => left.localeCompare(right, "zh-CN")),
  }
}

export {
  buildCategoryStats,
  getCategoryDefinition,
  getCategoryDefinitions,
  getCategoryLabel,
  getContentTypeLabel,
  resolveCategoryViewId,
}
