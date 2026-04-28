import { type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import Fuse, { type IFuseOptions } from "fuse.js"
import {
  Folders,
  LoaderCircle,
  PackageOpen,
  RotateCcw,
  SearchX,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { purgeContent, restoreContent } from "@/app-shell/content"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { useCurrentRepoProfile, useIdentity, useRepoProfileMap } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useActiveRepository, usePendingPushes, useRepositoryState } from "@/app-shell/use-repository-manager"
import {
  ModuleSidebar,
  ModuleSidebarHeader,
  ModuleSidebarItem,
  ModuleSidebarList,
} from "@/components/module-sidebar"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getContentTypeDefinition } from "@/config/content-types"
import {
  getCategoryLabel,
  resolveCategoryViewId,
  SYNAPSE_ALL_CATEGORY_ID,
  SYNAPSE_BUILTIN_CATEGORY_ID,
  SYNAPSE_DELETED_CATEGORY_ID,
  SYNAPSE_FAVORITES_CATEGORY_ID,
  SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID,
} from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { cn } from "@/lib/utils"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { ContentItemMeta } from "@/modules/content/components/content-item-meta"
import { useContentCatalog } from "@/modules/content/hooks/use-content-catalog"
import { useContentFavorites } from "@/modules/content/hooks/use-content-favorites"
import { useContentRecentlyViewed } from "@/modules/content/hooks/use-content-recently-viewed"
import { useContentSortOrder } from "@/modules/content/hooks/use-content-sort-order"
import { useDeletedContent } from "@/modules/content/hooks/use-deleted-content"
import {
  countSavedContentMutations,
  isContentMutationSaved,
} from "@/modules/content/lib/content-mutation"
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentSortOrder } from "@/types/config"
import type { SynapseContentMeta, SynapseContentMutationResult, SynapseContentType } from "@/types/content"

type ContentBrowserDetailDialogProps = {
  item: SynapseContentMeta | null
  onOpenChange: (open: boolean) => void
  open: boolean
}

type ContentBrowserPageProps = {
  contentType: SynapseContentType
  onCreateClick?: () => void
  onCreateDialogOpenChange?: (open: boolean) => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
  pendingContentOpenRequest?: ContentOpenRequest | null
  onPendingContentOpenRequestConsumed?: (requestId: string) => void
  renderDetailDialog: (props: ContentBrowserDetailDialogProps) => ReactNode
}

type ContentState = {
  description: string | null
  icon: LucideIcon
  title: string
}

function normalizeSearchQuery(value: string): string {
  return value.trim()
}

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

const SORT_OPTIONS: { value: SynapseContentSortOrder; label: string }[] = [
  { value: "modified-desc", label: "最近修改" },
  { value: "created-desc", label: "最近创建" },
  { value: "name-asc", label: "名称 A→Z" },
  { value: "name-desc", label: "名称 Z→A" },
]

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

function getContentState(params: {
  activeCategoryId: string
  categoryItems: SynapseCategoryViewItem[]
  error: Error | null
  filteredItems: SynapseContentMeta[]
  isLoading: boolean
  items: SynapseContentMeta[]
  itemsInActiveCategory: SynapseContentMeta[]
  normalizedSearchQuery: string
  repositoryStatus: "checking" | "missing" | "ready"
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

  if (error) {
    return {
      title: "读取失败",
      description: error.message,
      icon: TriangleAlert,
    }
  }

  if (isLoading && items.length === 0) {
    return {
      title: `正在加载 ${title}`,
      description: null,
      icon: LoaderCircle,
    }
  }

  if (items.length === 0) {
    return {
      title: `还没有 ${definition.emptyStateNoun}`,
      description: null,
      icon: PackageOpen,
    }
  }

  if (activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID && itemsInActiveCategory.length === 0) {
    return {
      title: "没有已删除的内容",
      description: null,
      icon: Trash2,
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

function ContentStateView({ description, icon: Icon, title }: ContentState) {
  return (
    <Empty className="min-h-80 rounded-lg border border-border bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className={cn(title.startsWith("正在加载") ? "animate-spin" : undefined)} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? <EmptyDescription>{description}</EmptyDescription> : null}
      </EmptyHeader>
    </Empty>
  )
}

function getRemainingDays(modifiedAt: string): number {
  const deletedDate = new Date(modifiedAt)
  const expiresAt = deletedDate.getTime() + 90 * 24 * 60 * 60 * 1000
  return Math.max(0, Math.ceil((expiresAt - Date.now()) / (24 * 60 * 60 * 1000)))
}

function DeletedContentCard({
  contentType,
  item,
  onRestore,
  onPurge,
  disabled,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onRestore: () => void
  onPurge: () => void
  disabled?: boolean
}) {
  const repoProfileMap = useRepoProfileMap()
  const deletedByLabel = resolveDisplayName(
    item.modifiedBy,
    repoProfileMap,
    item.modifiedByDisplayName,
  )
  const remainingDays = getRemainingDays(item.modifiedAt)

  return (
    <div
      className="flex items-start gap-3 rounded-lg bg-background px-3 py-3 opacity-60"
    >
      <ContentItemIcon
        contentId={item.id}
        contentType={contentType}
        icon={item.icon}
        iconType={item.iconType}
        iconImage={item.iconImage}
        title={item.title}
        tone={item.iconBg}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          还剩 {remainingDays} 天 · 由 {deletedByLabel} 删除
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="恢复"
          disabled={disabled}
          onClick={onRestore}
        >
          {disabled
            ? <LoaderCircle className="size-4 animate-spin" />
            : <RotateCcw className="size-4" />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 text-destructive hover:text-destructive"
          title="永久删除"
          disabled={disabled}
          onClick={onPurge}
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

function ContentListCard({
  contentType,
  isPendingPush,
  item,
  onInstallDialogOpenChange,
  onOpen,
}: {
  contentType: SynapseContentType
  isPendingPush: boolean
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)
  const repoProfileMap = useRepoProfileMap()
  const authorLabel = resolveDisplayName(
    item.createdBy,
    repoProfileMap,
    item.createdByDisplayName,
  )

  return (
    <div
      className="flex items-start gap-3 rounded-lg bg-background px-3 py-3 transition-shadow hover:ring-2 hover:ring-muted-foreground/25"
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onOpen}
      >
        {isPendingPush ? (
          <ContentIconBadge className="size-10 [&_svg]:size-5" size="md" title="正在同步...">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
          </ContentIconBadge>
        ) : (
          <ContentItemIcon
            contentId={item.id}
            contentType={contentType}
            icon={item.icon}
            iconType={item.iconType}
            iconImage={item.iconImage}
            title={item.title}
            tone={item.iconBg}
          />
        )}
        <ContentItemMeta
          author={authorLabel}
          category={categoryLabel}
          className="flex-1"
          description={item.description}
          title={item.title}
        />
      </button>

      <div
        className="shrink-0 self-start"
        onClick={(event) => {
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
        }}
      >
        <ContentActionSplitButton
          item={item}
          onInstallDialogOpenChange={onInstallDialogOpenChange}
        />
      </div>
    </div>
  )
}

function ContentBrowserPage({
  contentType,
  onCreateClick,
  onCreateDialogOpenChange,
  onDetailDialogOpenChange,
  onInstallDialogOpenChange,
  pendingContentOpenRequest,
  onPendingContentOpenRequestConsumed,
  renderDetailDialog,
}: ContentBrowserPageProps) {
  const definition = getContentTypeDefinition(contentType)
  const logger = useMemo(() => createRendererLogger(`content.browser.${contentType}`), [contentType])
  const activeRepository = useActiveRepository()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const { categories, error, isLoading, items, refresh, totalCount } = useContentCatalog(contentType)
  const { favoriteIds } = useContentFavorites(contentType)
  const { recentlyViewedIds, addRecentlyViewed } = useContentRecentlyViewed(contentType)
  const { sortOrder, setSortOrder } = useContentSortOrder()
  const deletedContent = useDeletedContent(contentType)
  const pendingPushState = usePendingPushes(activeRepository?.uuid ?? "")
  const isSyncing = (pendingPushState?.count ?? 0) > 0
  const pendingTargetIds = useMemo(
    () => new Set(pendingPushState?.items.map((entry) => entry.targetId) ?? []),
    [pendingPushState?.items],
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategoryId, setActiveCategoryIdRaw] = useState(SYNAPSE_ALL_CATEGORY_ID)
  const activeCategoryIdRef = useRef(activeCategoryId)
  activeCategoryIdRef.current = activeCategoryId
  const setActiveCategoryId = useCallback((nextId: string) => {
    const prevId = activeCategoryIdRef.current
    if (prevId !== nextId) {
      logger.info("Category switched.", { contentType, from: prevId, to: nextId })
    }
    setActiveCategoryIdRaw(nextId)
  }, [contentType, logger])
  const [selectedItem, setSelectedItem] = useState<SynapseContentMeta | null>(null)
  const consumedOpenRequestIdRef = useRef<string | null>(null)
  const refreshedOpenRequestIdRef = useRef<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<SynapseContentMeta | null>(null)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [deletedFilter, setDeletedFilterRaw] = useState<"mine" | "all">("mine")
  const deletedFilterRef = useRef(deletedFilter)
  deletedFilterRef.current = deletedFilter
  const setDeletedFilter = useCallback((nextFilter: "mine" | "all") => {
    const prevFilter = deletedFilterRef.current
    if (prevFilter !== nextFilter) {
      logger.info("Deleted filter changed.", { contentType, from: prevFilter, to: nextFilter })
    }
    setDeletedFilterRaw(nextFilter)
  }, [contentType, logger])
  const [batchAction, setBatchAction] = useState<"restore" | "purge" | null>(null)
  const [busyBatchAction, setBusyBatchAction] = useState<"restore" | "purge" | null>(null)
  const isBatchBusy = busyBatchAction !== null
  const isDeletedView = activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID
  const { localIdentityState } = useIdentity()
  const currentUserId = localIdentityState?.status === "ready" ? localIdentityState.identity.userId : null

  const repositoryStatus = activeRepositoryState?.status ?? "checking"
  const canBrowseContent = repositoryStatus === "ready"
  const canCreateContent =
    canBrowseContent
    && currentRepoProfileState?.status !== "needs-onboarding"
    && !isSyncing
  const normalizedSearchQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery])
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)
  const lastLoggedSearchQueryRef = useRef(deferredSearchQuery)

  useEffect(() => {
    if (lastLoggedSearchQueryRef.current === deferredSearchQuery) {
      return
    }

    logger.info("Search query changed.", {
      contentType,
      from: lastLoggedSearchQueryRef.current,
      to: deferredSearchQuery,
    })
    lastLoggedSearchQueryRef.current = deferredSearchQuery
  }, [deferredSearchQuery, contentType, logger])

  useEffect(() => {
    onCreateDialogOpenChange?.(false)
  }, [onCreateDialogOpenChange])

  useEffect(() => {
    if (!isDeletedView) setDeletedFilter("mine")
  }, [isDeletedView])

  useEffect(() => {
    // "我的收藏"是特殊分类，不在 categories 数组中，不需要检查
    if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID) {
      return
    }

    // "最近删除"是特殊分类，不在 categories 数组中，不需要检查
    if (activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID) {
      return
    }

    // 如果当前是"最近浏览"但过滤已删除后为空，重置到"全部"
    if (activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID) {
      const hasVisibleItems = recentlyViewedIds.some((id) => items.some((item) => item.id === id))
      if (!hasVisibleItems) {
        setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
      }
      return
    }

    if (!categories.some((item) => item.id === activeCategoryId)) {
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
    }
  }, [activeCategoryId, categories, favoriteIds, recentlyViewedIds, items])

  useEffect(() => {
    if (!selectedItem) {
      onDetailDialogOpenChange?.(false)
      return
    }

    const itemExists = items.some((item) => item.id === selectedItem.id)
    if (!itemExists) {
      setSelectedItem(null)
      return
    }

    const nextSelectedItem = items.find((item) => item.id === selectedItem.id) ?? null
    if (nextSelectedItem && nextSelectedItem !== selectedItem) {
      setSelectedItem(nextSelectedItem)
    }

    onDetailDialogOpenChange?.(true)
  }, [items, onDetailDialogOpenChange, selectedItem])

  useEffect(() => {
    const request = pendingContentOpenRequest
    if (
      !request
      || request.contentType !== contentType
      || request.kind !== "detail"
      || consumedOpenRequestIdRef.current === request.requestId
      || isLoading
    ) {
      return
    }

    const item = items.find((candidate) => candidate.id === request.contentId) ?? null
    if (!item && items.length === 0 && refreshedOpenRequestIdRef.current !== request.requestId) {
      refreshedOpenRequestIdRef.current = request.requestId
      void refresh()
      return
    }

    consumedOpenRequestIdRef.current = request.requestId

    if (item) {
      logger.info("Content detail opened from external request.", {
        contentId: item.id,
        contentType: item.type,
      })
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
      addRecentlyViewed(contentType, item.id)
      setSelectedItem(item)
    } else {
      logger.warn("Content detail external request target not found.", {
        contentId: request.contentId,
        contentType,
      })
    }

    onPendingContentOpenRequestConsumed?.(request.requestId)
  }, [
    addRecentlyViewed,
    contentType,
    isLoading,
    items,
    logger,
    onPendingContentOpenRequestConsumed,
    pendingContentOpenRequest,
    refresh,
    setActiveCategoryId,
  ])

  const itemsInActiveCategory = useMemo(
    () => {
      if (activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID) {
        if (deletedFilter === "mine" && currentUserId) {
          return deletedContent.items.filter((item) => item.modifiedBy === currentUserId)
        }
        return deletedContent.items
      }

      if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID) {
        return items.filter((item) => favoriteIds.includes(item.id))
      }

      if (activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID) {
        const itemMap = new Map(items.map((item) => [item.id, item]))
        return recentlyViewedIds
          .map((id) => itemMap.get(id))
          .filter((item): item is SynapseContentMeta => item !== undefined)
      }

      if (activeCategoryId === SYNAPSE_BUILTIN_CATEGORY_ID) {
        return items.filter((item) => item.source === "builtin")
      }

      return items.filter((item) => (
        activeCategoryId === SYNAPSE_ALL_CATEGORY_ID
        || resolveCategoryViewId(contentType, item.category) === activeCategoryId
      ))
    },
    [activeCategoryId, contentType, items, favoriteIds, recentlyViewedIds, deletedContent.items, deletedFilter, currentUserId],
  )
  const contentSearch = useMemo(
    () => new Fuse(itemsInActiveCategory, contentSearchOptions),
    [itemsInActiveCategory],
  )

  const filteredItems = useMemo(
    () => {
      if (deferredSearchQuery) {
        const searchResults = contentSearch.search(deferredSearchQuery).map((result) => result.item)
        return sortOrder ? sortContentItems(searchResults, sortOrder) : searchResults
      }

      return sortContentItems(itemsInActiveCategory, sortOrder)
    },
    [activeCategoryId, contentSearch, itemsInActiveCategory, deferredSearchQuery, sortOrder],
  )

  const summaryLabel = useMemo(() => {
    if (isDeletedView) {
      return `共 ${filteredItems.length} 项`
    }

    if (
      activeCategoryId === SYNAPSE_ALL_CATEGORY_ID
      || activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID
      || activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID
    ) {
      if (!deferredSearchQuery) {
        return `共 ${filteredItems.length} 项`
      }
      return `显示 ${filteredItems.length} / ${itemsInActiveCategory.length} 项`
    }

    return `显示 ${filteredItems.length} / ${totalCount} 项`
  }, [activeCategoryId, filteredItems.length, isDeletedView, deferredSearchQuery, totalCount, itemsInActiveCategory.length])

  const recentlyViewedCount = useMemo(() => {
    const itemIds = new Set(items.map((item) => item.id))
    return recentlyViewedIds.filter((id) => itemIds.has(id)).length
  }, [items, recentlyViewedIds])

  const state = useMemo(
    () => getContentState({
      activeCategoryId,
      categoryItems: categories,
      error,
      filteredItems,
      isLoading,
      items,
      itemsInActiveCategory,
      normalizedSearchQuery: deferredSearchQuery,
      repositoryStatus,
      contentType,
    }),
    [
      activeCategoryId,
      categories,
      error,
      filteredItems,
      isLoading,
      items,
      itemsInActiveCategory,
      deferredSearchQuery,
      repositoryStatus,
      contentType,
    ],
  )

  if (activeRepository === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">先选择本地目录</p>
      </div>
    )
  }

  const createButtonTitle =
    repositoryStatus === "checking"
      ? "正在检查目录状态..."
      : repositoryStatus === "missing"
        ? "当前目录不存在，不能新建"
        : currentRepoProfileState?.status === "needs-onboarding"
          ? "先完成当前目录的身份设置"
          : isSyncing
            ? "正在同步变更，请稍后"
          : `新建 ${definition.singularLabel}`

  return (
    <>
      <SidebarContentLayout
        contentClassName="bg-muted/30"
        sidebar={
          <ModuleSidebar variant="bare">
            <ModuleSidebarHeader
              searchValue={searchQuery}
              onSearchChange={setSearchQuery}
              searchPlaceholder={`搜索 ${definition.pluralLabel}`}
              searchDisabled={!canBrowseContent}
              onAddClick={() => {
                logger.info("Create entry requested from browser page.", {
                  contentType,
                  repositoryUuid: activeRepository.uuid,
                })

                if (!onCreateClick) {
                  logger.warn("Create entry requested without a registered handler.", {
                    contentType,
                    repositoryUuid: activeRepository.uuid,
                  })
                  return
                }

                onCreateClick()
              }}
              addDisabled={!canCreateContent}
              addTitle={createButtonTitle}
            />
            <ModuleSidebarList>
              {/* 全部分类 */}
              {categories[0] && (
                <ModuleSidebarItem
                  key={categories[0].id}
                  active={categories[0].id === activeCategoryId}
                  disabled={!canBrowseContent}
                  onClick={() => setActiveCategoryId(categories[0].id)}
                  className="h-8 px-4"
                  trailing={
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {categories[0].count}
                    </span>
                  }
                >
                  {categories[0].label}
                </ModuleSidebarItem>
              )}

              {/* 我的收藏 */}
              <ModuleSidebarItem
                active={activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID}
                disabled={!canBrowseContent}
                onClick={() => setActiveCategoryId(SYNAPSE_FAVORITES_CATEGORY_ID)}
                className="h-8 px-4"
                trailing={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {favoriteIds.length}
                  </span>
                }
              >
                我的收藏
              </ModuleSidebarItem>

              {/* 最近浏览 */}
              <ModuleSidebarItem
                active={activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID}
                disabled={!canBrowseContent}
                onClick={() => setActiveCategoryId(SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID)}
                className="h-8 px-4"
                trailing={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {recentlyViewedCount}
                  </span>
                }
              >
                最近浏览
              </ModuleSidebarItem>

              {/* 分类分隔符 */}
              <Separator className="my-2 bg-border/50" />

              {/* 其余分类 */}
              {categories.slice(1).map((category) => (
                <ModuleSidebarItem
                  key={category.id}
                  active={category.id === activeCategoryId}
                  disabled={!canBrowseContent}
                  onClick={() => setActiveCategoryId(category.id)}
                  className="h-8 px-4"
                  trailing={
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {category.count}
                    </span>
                  }
                >
                  {category.label}
                </ModuleSidebarItem>
              ))}

              {/* 最近删除分隔符 */}
              <Separator className="my-2 bg-border/50" />

              {/* 最近删除 */}
              <ModuleSidebarItem
                active={activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID}
                disabled={!canBrowseContent}
                onClick={() => setActiveCategoryId(SYNAPSE_DELETED_CATEGORY_ID)}
                className="h-8 px-4"
                trailing={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {deletedContent.count}
                  </span>
                }
              >
                最近删除
              </ModuleSidebarItem>
            </ModuleSidebarList>
          </ModuleSidebar>
        }
      >
        <section className="h-full min-h-0">
          <div className="flex min-h-full flex-col gap-2.5">
            <div
                      className="flex flex-wrap items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <h2 className="text-base font-medium text-foreground">
                  {isDeletedView ? "最近删除" : definition.pluralLabel}
                </h2>
              </div>

              <div className="flex shrink-0 items-center gap-3">
                {!isDeletedView && (
                  <Select
                    data-track="content-sort-order"
                    value={sortOrder}
                    onValueChange={(value) => setSortOrder(value as SynapseContentSortOrder)}
                  >
                    <SelectTrigger size="sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-sm text-muted-foreground">{summaryLabel}</p>
              </div>
            </div>

            {isDeletedView && (
              <div
                          className="flex items-center justify-between gap-3"
              >
                <Tabs
                  data-track="deleted-filter"
                  value={deletedFilter}
                  onValueChange={(value) => setDeletedFilter(value as "mine" | "all")}
                >
                  <TabsList className="h-8">
                    <TabsTrigger value="mine">我删除的</TabsTrigger>
                    <TabsTrigger value="all">全部</TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={filteredItems.length === 0 || isBatchBusy}
                    onClick={() => {
                      logger.info("Batch action dialog opened.", { action: "restore", contentType })
                      setBatchAction("restore")
                    }}
                  >
                    <RotateCcw className="mr-1 size-3.5" />
                    {busyBatchAction === "restore" ? "恢复中..." : "全部恢复"}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    disabled={filteredItems.length === 0 || isBatchBusy}
                    onClick={() => {
                      logger.info("Batch action dialog opened.", { action: "purge", contentType })
                      setBatchAction("purge")
                    }}
                  >
                    <Trash2 className="mr-1 size-3.5" />
                    {busyBatchAction === "purge" ? "删除中..." : "全部删除"}
                  </Button>
                </div>
              </div>
            )}

            {state ? (
              <ContentStateView {...state} />
            ) : isDeletedView ? (
              <div className="grid grid-cols-2 gap-3">
                {filteredItems.map((item) => (
                  <DeletedContentCard
                    key={item.id}
                    contentType={contentType}
                    item={item}
                    disabled={busyItemId === item.id}
                    onRestore={async () => {
                      if (busyItemId) return
                      setBusyItemId(item.id)
                      const startedAt = performance.now()
                      logger.info("Content restore initiated.", { contentId: item.id, contentType })
                      try {
                        const result = await restoreContent({
                          id: item.id,
                          type: contentType,
                          baseHistoryDirname: item.latestHistoryDirname,
                        })
                        if (!isContentMutationSaved(result)) {
                          logger.warn("Content restore conflict detected.", { contentId: item.id, contentType, latestHistoryDirname: result.latestHistoryDirname })
                          toast.warning("内容已变化，请刷新后重试。")
                          void deletedContent.refresh()
                          return
                        }
                        logger.info("Content restored.", { contentId: item.id, contentType, elapsedMs: Math.round(performance.now() - startedAt) })
                        toast.success(`已恢复「${item.title}」`)
                        void Promise.all([deletedContent.refresh(), refresh()])
                      } catch (err) {
                        logger.error("Content restore failed.", { contentId: item.id, contentType, elapsedMs: Math.round(performance.now() - startedAt), error: err })
                        toast.error("恢复失败，请稍后重试。")
                      } finally {
                        setBusyItemId(null)
                      }
                    }}
                    onPurge={() => {
                      logger.info("Content purge confirm dialog opened.", { contentId: item.id, contentType })
                      setPurgeTarget(item)
                    }}
                  />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredItems.map((item) => (
                  <ContentListCard
                    key={item.id}
                    contentType={contentType}
                    isPendingPush={pendingTargetIds.has(item.id)}
                    item={item}
                    onInstallDialogOpenChange={onInstallDialogOpenChange}
                    onOpen={() => {
                      logger.info("Content detail opened from browser page.", {
                        contentId: item.id,
                        contentType: item.type,
                      })
                      addRecentlyViewed(contentType, item.id)
                      setSelectedItem(item)
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </section>
      </SidebarContentLayout>

      {renderDetailDialog({
        item: selectedItem,
        open: selectedItem !== null,
        onOpenChange: (open) => {
          if (!open) {
            setSelectedItem(null)
          }
        },
      })}

      <AlertDialog open={purgeTarget !== null} onOpenChange={(open) => { if (!open) setPurgeTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>永久删除</AlertDialogTitle>
            <AlertDialogDescription>
              此操作不可撤销，内容将被彻底清除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={async () => {
                if (!purgeTarget) return
                const startedAt = performance.now()
                logger.info("Content purge initiated.", { contentId: purgeTarget.id, contentType })
                try {
                  await purgeContent({
                    id: purgeTarget.id,
                    type: contentType,
                  })
                  logger.info("Content purged.", { contentId: purgeTarget.id, contentType, elapsedMs: Math.round(performance.now() - startedAt) })
                  toast.success(`已永久删除「${purgeTarget.title}」`)
                  setPurgeTarget(null)
                  void deletedContent.refresh()
                } catch (err) {
                  logger.error("Content purge failed.", { contentId: purgeTarget.id, contentType, elapsedMs: Math.round(performance.now() - startedAt), error: err })
                  toast.error("永久删除失败，请稍后重试。")
                }
              }}
            >
              永久删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={batchAction !== null} onOpenChange={(open) => { if (!open) setBatchAction(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {batchAction === "restore" ? "全部恢复" : "全部永久删除"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {batchAction === "restore"
                ? `将恢复当前列表中的 ${filteredItems.length} 项内容。`
                : `此操作不可撤销，当前列表中的 ${filteredItems.length} 项内容将被彻底清除。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isBatchBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              className={batchAction === "purge" ? "bg-destructive text-white hover:bg-destructive/90" : ""}
              disabled={isBatchBusy}
              onClick={async () => {
                if (isBatchBusy) return
                const action = batchAction
                const targets = [...filteredItems]
                setBatchAction(null)
                if (!action || targets.length === 0) return
                const startedAt = performance.now()
                logger.info("Batch action initiated.", { action, contentType, count: targets.length })
                setBusyBatchAction(action)
                const results: SynapseContentMutationResult[] = []
                let successCount = 0
                try {
                  for (const item of targets) {
                    try {
                      if (action === "restore") {
                        const result = await restoreContent({
                          id: item.id,
                          type: contentType,
                          baseHistoryDirname: item.latestHistoryDirname,
                        })
                        results.push(result)
                      } else {
                        await purgeContent({ id: item.id, type: contentType })
                        successCount++
                      }
                    } catch (err) {
                      logger.error("Batch action item failed.", { action, contentId: item.id, contentType, error: err })
                    }
                  }
                  if (action === "restore") {
                    successCount = countSavedContentMutations(results)
                  }
                  logger.info("Batch action completed.", { action, contentType, successCount, total: targets.length, elapsedMs: Math.round(performance.now() - startedAt) })
                  if (action === "restore") {
                    void Promise.all([deletedContent.refresh(), refresh()])
                  } else {
                    void deletedContent.refresh()
                  }
                  const verb = action === "restore" ? "恢复" : "永久删除"
                  if (successCount === targets.length) {
                    toast.success(`已${verb} ${successCount} 项内容`)
                  } else if (action === "restore" && results.length > successCount) {
                    toast.warning(`已${verb} ${successCount}/${targets.length} 项，部分内容已变化`)
                  } else {
                    toast.warning(`${verb}了 ${successCount}/${targets.length} 项，部分操作失败`)
                  }
                } finally {
                  setBusyBatchAction(null)
                }
              }}
            >
              {isBatchBusy ? "处理中..." : batchAction === "restore" ? "全部恢复" : "全部永久删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export { ContentBrowserPage }
