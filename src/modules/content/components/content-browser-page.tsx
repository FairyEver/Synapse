import { type ReactNode, useDeferredValue, useEffect, useMemo, useState } from "react"
import Fuse, { type IFuseOptions } from "fuse.js"
import {
  Folders,
  LoaderCircle,
  PackageOpen,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { useCurrentRepoProfile, useRepoProfileMap } from "@/app-shell/identity-context"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getContentTypeDefinition } from "@/config/content-types"
import {
  getCategoryLabel,
  resolveCategoryViewId,
  SYNAPSE_ALL_CATEGORY_ID,
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
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

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
      data-window-no-drag="true"
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
  renderDetailDialog,
}: ContentBrowserPageProps) {
  const definition = getContentTypeDefinition(contentType)
  const logger = useMemo(() => createRendererLogger(`content.browser.${contentType}`), [contentType])
  const activeRepository = useActiveRepository()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const activeRepositoryState = useRepositoryState(activeRepository?.uuid ?? "")
  const { categories, error, isLoading, items, totalCount } = useContentCatalog(contentType)
  const { favoriteIds } = useContentFavorites(contentType)
  const { recentlyViewedIds, addRecentlyViewed } = useContentRecentlyViewed(contentType)
  const pendingPushState = usePendingPushes(activeRepository?.uuid ?? "")
  const isSyncing = (pendingPushState?.count ?? 0) > 0
  const pendingTargetIds = useMemo(
    () => new Set(pendingPushState?.items.map((entry) => entry.targetId) ?? []),
    [pendingPushState?.items],
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategoryId, setActiveCategoryId] = useState(SYNAPSE_ALL_CATEGORY_ID)
  const [selectedItem, setSelectedItem] = useState<SynapseContentMeta | null>(null)

  const repositoryStatus = activeRepositoryState?.status ?? "checking"
  const canBrowseContent = repositoryStatus === "ready"
  const canCreateContent =
    canBrowseContent
    && currentRepoProfileState?.status !== "needs-onboarding"
    && !isSyncing
  const normalizedSearchQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery])
  const deferredSearchQuery = useDeferredValue(normalizedSearchQuery)

  useEffect(() => {
    onCreateDialogOpenChange?.(false)
  }, [onCreateDialogOpenChange])

  useEffect(() => {
    // 如果当前是"我的收藏"但没有收藏了，重置到"全部"
    if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID && favoriteIds.length === 0) {
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
      return
    }

    // "我的收藏"是特殊分类，不在 categories 数组中，不需要检查
    if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID) {
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

  const itemsInActiveCategory = useMemo(
    () => {
      if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID) {
        return items.filter((item) => favoriteIds.includes(item.id))
      }

      if (activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID) {
        const itemMap = new Map(items.map((item) => [item.id, item]))
        return recentlyViewedIds
          .map((id) => itemMap.get(id))
          .filter((item): item is SynapseContentMeta => item !== undefined)
      }

      return items.filter((item) => (
        activeCategoryId === SYNAPSE_ALL_CATEGORY_ID
        || resolveCategoryViewId(contentType, item.category) === activeCategoryId
      ))
    },
    [activeCategoryId, contentType, items, favoriteIds, recentlyViewedIds],
  )
  const contentSearch = useMemo(
    () => new Fuse(itemsInActiveCategory, contentSearchOptions),
    [itemsInActiveCategory],
  )

  const filteredItems = useMemo(
    () => (
      deferredSearchQuery
        ? contentSearch.search(deferredSearchQuery).map((result) => result.item)
        : itemsInActiveCategory
    ),
    [contentSearch, itemsInActiveCategory, deferredSearchQuery],
  )

  const summaryLabel = useMemo(() => {
    if (activeCategoryId === SYNAPSE_ALL_CATEGORY_ID && !deferredSearchQuery) {
      return `共 ${totalCount} 项`
    }

    return `显示 ${filteredItems.length} / ${totalCount} 项`
  }, [activeCategoryId, filteredItems.length, deferredSearchQuery, totalCount])

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
            <div className="pb-2">
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
            </div>
            <ModuleSidebarList>
              {/* 全部分类 */}
              {categories[0] && (
                <ModuleSidebarItem
                  key={categories[0].id}
                  active={categories[0].id === activeCategoryId}
                  disabled={!canBrowseContent}
                  onClick={() => setActiveCategoryId(categories[0].id)}
                  className="h-10 px-4"
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
                className="h-10 px-4"
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
                className="h-10 px-4"
                trailing={
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {recentlyViewedCount}
                  </span>
                }
              >
                最近浏览
              </ModuleSidebarItem>

              {/* 其余分类 */}
              {categories.slice(1).map((category) => (
                <ModuleSidebarItem
                  key={category.id}
                  active={category.id === activeCategoryId}
                  disabled={!canBrowseContent}
                  onClick={() => setActiveCategoryId(category.id)}
                  className="h-10 px-4"
                  trailing={
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {category.count}
                    </span>
                  }
                >
                  {category.label}
                </ModuleSidebarItem>
              ))}
            </ModuleSidebarList>
          </ModuleSidebar>
        }
      >
        <section className="h-full min-h-0">
          <div className="flex min-h-full flex-col gap-4 pb-6">
            <div
              data-window-no-drag="true"
              className="flex flex-wrap items-start justify-between gap-3"
            >
              <div className="min-w-0">
                <h2 className="text-base font-medium text-foreground">{definition.pluralLabel}</h2>
              </div>

              <p className="shrink-0 text-sm text-muted-foreground">{summaryLabel}</p>
            </div>

            {state ? (
              <ContentStateView {...state} />
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
    </>
  )
}

export { ContentBrowserPage }
