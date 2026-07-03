import type { IFuseOptions } from "fuse.js"
import {
  Folders,
  LoaderCircle,
  PackageOpen,
  SearchX,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getContentTypeDefinition } from "@/config/content-types"
import {
  SYNAPSE_ALL_CATEGORY_ID,
  SYNAPSE_DELETED_CATEGORY_ID,
} from "@/lib/content-categories"
import { cn } from "@/lib/utils"
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentSortOrder } from "@/types/config"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"
import type { SynapseRepositoryLocalStatus } from "@/types/repository"

type ContentState = {
  description: string | null
  icon: LucideIcon
  title: string
  onRetry?: () => void
}

const SORT_OPTIONS: { value: SynapseContentSortOrder; label: string }[] = [
  { value: "modified-desc", label: "最近修改" },
  { value: "created-desc", label: "最近创建" },
  { value: "name-asc", label: "名称 A→Z" },
  { value: "name-desc", label: "名称 Z→A" },
]

const contentSearchOptions: IFuseOptions<SynapseContentMeta> = {
  ignoreLocation: true,
  keys: [
    { name: "title", weight: 0.45 },
    { name: "description", weight: 0.3 },
    { name: "createdByDisplayName", weight: 0.15 },
    { name: "modifiedByDisplayName", weight: 0.1 },
  ],
  threshold: 0.35,
}

function normalizeSearchQuery(value: string): string {
  return value.trim()
}

function sortContentItems(
  items: SynapseContentMeta[],
  order: SynapseContentSortOrder,
): SynapseContentMeta[] {
  const sorted = [...items]

  switch (order) {
    case "modified-desc":
      return sorted.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
    case "created-desc":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    case "name-asc":
      return sorted.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"))
    case "name-desc":
      return sorted.sort((a, b) => b.title.localeCompare(a.title, "zh-CN"))
  }
}

function countVisibleContentIds(
  ids: readonly string[],
  items: readonly Pick<SynapseContentMeta, "id">[],
): number {
  const itemIds = new Set(items.map((item) => item.id))
  return ids.filter((id) => itemIds.has(id)).length
}

function getContentState(params: {
  activeCategoryId: string
  categoryItems: SynapseCategoryViewItem[]
  error: Error | null
  filteredItems: SynapseContentMeta[]
  onRetry?: () => void
  isLoading: boolean
  items: SynapseContentMeta[]
  itemsInActiveCategory: SynapseContentMeta[]
  normalizedSearchQuery: string
  repositoryStatus: SynapseRepositoryLocalStatus | "checking"
  contentType: SynapseContentType
}): ContentState | null {
  const {
    activeCategoryId,
    categoryItems,
    error,
    filteredItems,
    isLoading,
    items,
    itemsInActiveCategory,
    normalizedSearchQuery,
    onRetry,
    repositoryStatus,
    contentType,
  } = params
  const definition = getContentTypeDefinition(contentType)
  const title = definition.pluralLabel

  if (repositoryStatus === "checking") {
    return {
      title: `正在加载 ${title}`,
      description: null,
      icon: LoaderCircle,
    }
  }

  if (repositoryStatus === "missing") {
    return {
      title: "本地目录不存在",
      description: "前往设置重新选择本地目录。",
      icon: TriangleAlert,
    }
  }

  if (repositoryStatus === "inaccessible") {
    return {
      title: "本地目录无法访问",
      description: "前往设置检查本地目录。",
      icon: TriangleAlert,
    }
  }

  if (error) {
    return {
      title: "读取失败",
      description: error.message,
      icon: TriangleAlert,
      onRetry,
    }
  }

  if (isLoading && items.length === 0) {
    return {
      title: `正在加载 ${title}`,
      description: null,
      icon: LoaderCircle,
    }
  }

  if (activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID && itemsInActiveCategory.length === 0) {
    return {
      title: "没有已删除的内容",
      description: null,
      icon: Trash2,
    }
  }

  if (items.length === 0) {
    return {
      title: `还没有 ${definition.emptyStateNoun}`,
      description: null,
      icon: PackageOpen,
    }
  }

  if (activeCategoryId !== SYNAPSE_ALL_CATEGORY_ID && itemsInActiveCategory.length === 0) {
    const categoryLabel = categoryItems.find((item) => item.id === activeCategoryId)?.label ?? "当前分类"

    return {
      title: `${categoryLabel} 里还没有内容`,
      description: null,
      icon: Folders,
    }
  }

  if (normalizedSearchQuery && filteredItems.length === 0) {
    return {
      title: "没有找到匹配结果",
      description: "试试别的关键词。",
      icon: SearchX,
    }
  }

  return null
}

function ContentStateView({ description, icon: Icon, onRetry, title }: ContentState) {
  return (
    <Empty className="min-h-80 rounded-lg border border-border bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className={cn(title.startsWith("正在加载") ? "animate-spin" : undefined)} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
        {onRetry ? (
          <Button variant="outline" size="sm" onClick={onRetry}>
            重试
          </Button>
        ) : null}
      </EmptyHeader>
    </Empty>
  )
}

export {
  contentSearchOptions,
  ContentStateView,
  countVisibleContentIds,
  getContentState,
  normalizeSearchQuery,
  SORT_OPTIONS,
  sortContentItems,
}
export type { ContentState }
