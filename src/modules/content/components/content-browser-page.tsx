import { type ReactNode, useEffect, useMemo, useState } from "react"
import Fuse, { type IFuseOptions } from "fuse.js"
import {
  Folders,
  LoaderCircle,
  PackageOpen,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useRepositoryManager } from "@/app-shell/repository"
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
import { Badge } from "@/components/ui/badge"
import { getContentIconOption } from "@/lib/content-appearance"
import {
  getCategoryLabel,
  resolveCategoryViewId,
  SYNAPSE_ALL_CATEGORY_ID,
} from "@/lib/content-categories"
import { cn } from "@/lib/utils"
import { useContentCatalog } from "@/modules/content/hooks/use-content-catalog"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type ContentBrowserDetailDialogProps = {
  item: SynapseContentMeta | null
  onContentChanged: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal: number
}

type ContentBrowserPageProps = {
  contentType: SynapseContentType
  onCreateClick?: () => void
  onDetailDialogOpenChange?: (open: boolean) => void
  onInstallDialogOpenChange?: (open: boolean) => void
  refreshSignal?: number
  renderDetailDialog: (props: ContentBrowserDetailDialogProps) => ReactNode
  title: string
}

type ContentState = {
  description: string
  icon: LucideIcon
  title: string
}

function getSingularLabel(contentType: SynapseContentType): string {
  return contentType === "rule" ? "Rule" : "Skill"
}

function getRepositoryDescription(
  repositoryName: string,
  isGitRepository: boolean | null,
  isReady: boolean | null,
): string {
  if (isReady === null) {
    return `当前目录：${repositoryName}。正在检查目录状态。`
  }

  if (!isReady) {
    return `当前目录：${repositoryName}。未找到本地目录，请重新选择。`
  }

  if (!isGitRepository) {
    return `当前目录：${repositoryName}。当前目录不是 Git 仓库。`
  }

  return `当前目录：${repositoryName}`
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
  error: string | null
  filteredItems: SynapseContentMeta[]
  isLoading: boolean
  items: SynapseContentMeta[]
  itemsInActiveCategory: SynapseContentMeta[]
  normalizedSearchQuery: string
  repositoryStatus: "checking" | "missing" | "ready"
  title: string
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
    title,
  } = params

  if (repositoryStatus === "checking") {
    return {
      title: `正在加载 ${title}`,
      description: "正在读取当前目录里的内容。",
      icon: LoaderCircle,
    }
  }

  if (repositoryStatus === "missing") {
    return {
      title: "本地目录不存在",
      description: "请回到 Settings 重新选择本地目录。",
      icon: TriangleAlert,
    }
  }

  if (error) {
    return {
      title: "读取失败",
      description: error,
      icon: TriangleAlert,
    }
  }

  if (isLoading && items.length === 0) {
    return {
      title: `正在加载 ${title}`,
      description: "正在读取当前目录里的内容。",
      icon: LoaderCircle,
    }
  }

  if (items.length === 0) {
    return {
      title: `还没有 ${title}`,
      description: "当前目录下还没有可显示的内容。",
      icon: PackageOpen,
    }
  }

  if (activeCategoryId !== SYNAPSE_ALL_CATEGORY_ID && itemsInActiveCategory.length === 0) {
    const categoryLabel = categoryItems.find((item) => item.id === activeCategoryId)?.label ?? "当前分类"

    return {
      title: `${categoryLabel} 里还没有内容`,
      description: "换一个分类看看。",
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
    <Empty className="min-h-[320px] rounded-lg border border-border bg-background">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon className={cn(title.startsWith("正在加载") ? "animate-spin" : undefined)} />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

function ContentListCard({
  contentType,
  item,
  onInstallDialogOpenChange,
  onOpen,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)
  const iconOption = getContentIconOption(item.icon)
  const authorLabel = item.createdByDisplayName || "未命名用户"
  return (
    <div className="flex items-start gap-3 rounded-xl bg-background px-3 py-3">
      <button
        type="button"
        className="flex min-w-0 flex-1 cursor-pointer items-start gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        onClick={onOpen}
      >
        <ContentIconBadge
          size="md"
          tone={item.iconBg}
          title={item.title}
          className="size-10"
        >
          {iconOption ? (
            <iconOption.icon className="size-6" />
          ) : (
            <span className="block max-w-full truncate px-1 leading-none">{item.icon}</span>
          )}
        </ContentIconBadge>

        <div className="min-w-0 flex-1 pt-0.5">
          <div className="min-w-0 flex flex-col gap-1">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            <p className="truncate text-sm text-muted-foreground">{item.description}</p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="max-w-full truncate">
              @{authorLabel}
            </Badge>
            <Badge variant="secondary">{categoryLabel}</Badge>
          </div>
        </div>
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
  onDetailDialogOpenChange,
  onInstallDialogOpenChange,
  refreshSignal = 0,
  renderDetailDialog,
  title,
}: ContentBrowserPageProps) {
  const logger = useMemo(() => createRendererLogger(`content.browser.${contentType}`), [contentType])
  const { activeRepository } = useAppConfig()
  const { states } = useRepositoryManager()
  const [contentRefreshSignal, setContentRefreshSignal] = useState(0)
  const catalogRefreshSignal = refreshSignal + contentRefreshSignal
  const { categories, error, isLoading, items, totalCount } = useContentCatalog(
    contentType,
    catalogRefreshSignal,
  )
  const [searchQuery, setSearchQuery] = useState("")
  const [activeCategoryId, setActiveCategoryId] = useState(SYNAPSE_ALL_CATEGORY_ID)
  const [selectedItem, setSelectedItem] = useState<SynapseContentMeta | null>(null)

  const activeRepositoryState = activeRepository ? (states[activeRepository.uuid] ?? null) : null
  const repositoryStatus =
    activeRepositoryState === null
      ? "checking"
      : activeRepositoryState.status === "ready"
        ? "ready"
        : "missing"
  const canBrowseContent = repositoryStatus === "ready"
  const canCreateContent =
    canBrowseContent && Boolean(activeRepositoryState?.isGitRepository)
  const normalizedSearchQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery])

  useEffect(() => {
    if (!categories.some((item) => item.id === activeCategoryId)) {
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
    }
  }, [activeCategoryId, categories])

  useEffect(() => {
    if (selectedItem && !items.some((item) => item.id === selectedItem.id)) {
      setSelectedItem(null)
    }
  }, [items, selectedItem])

  useEffect(() => {
    if (!selectedItem) {
      return
    }

    const nextSelectedItem = items.find((item) => item.id === selectedItem.id) ?? null

    if (nextSelectedItem && nextSelectedItem !== selectedItem) {
      setSelectedItem(nextSelectedItem)
    }
  }, [items, selectedItem])

  useEffect(() => {
    onDetailDialogOpenChange?.(selectedItem !== null)
  }, [onDetailDialogOpenChange, selectedItem])

  useEffect(() => {
    return () => {
      onDetailDialogOpenChange?.(false)
    }
  }, [onDetailDialogOpenChange])

  const itemsInActiveCategory = useMemo(
    () => items.filter((item) => (
      activeCategoryId === SYNAPSE_ALL_CATEGORY_ID
      || resolveCategoryViewId(contentType, item.category) === activeCategoryId
    )),
    [activeCategoryId, contentType, items],
  )
  const contentSearch = useMemo(
    () => new Fuse(itemsInActiveCategory, contentSearchOptions),
    [itemsInActiveCategory],
  )

  const filteredItems = useMemo(
    () => (
      normalizedSearchQuery
        ? contentSearch.search(normalizedSearchQuery).map((result) => result.item)
        : itemsInActiveCategory
    ),
    [contentSearch, itemsInActiveCategory, normalizedSearchQuery],
  )

  const summaryLabel = useMemo(() => {
    if (activeCategoryId === SYNAPSE_ALL_CATEGORY_ID && !normalizedSearchQuery) {
      return `共 ${totalCount} 项`
    }

    return `显示 ${filteredItems.length} / ${totalCount} 项`
  }, [activeCategoryId, filteredItems.length, normalizedSearchQuery, totalCount])

  const state = useMemo(
    () => getContentState({
      activeCategoryId,
      categoryItems: categories,
      error,
      filteredItems,
      isLoading,
      items,
      itemsInActiveCategory,
      normalizedSearchQuery,
      repositoryStatus,
      title,
    }),
    [
      activeCategoryId,
      categories,
      error,
      filteredItems,
      isLoading,
      items,
      itemsInActiveCategory,
      normalizedSearchQuery,
      repositoryStatus,
      title,
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
        : !activeRepositoryState?.isGitRepository
          ? "当前目录不是 Git 仓库，不能新建"
          : `新建 ${getSingularLabel(contentType)}`

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
                searchPlaceholder={`搜索 ${title}`}
                searchDisabled={!canBrowseContent}
                onAddClick={() => {
                  logger.info("Create entry requested from browser page.", {
                    contentType,
                    repositoryUuid: activeRepository.uuid,
                  })

                  if (onCreateClick) {
                    onCreateClick()
                    return
                  }

                  logger.warn("Create entry requested without a registered handler.", {
                    contentType,
                    repositoryUuid: activeRepository.uuid,
                  })
                }}
                addDisabled={!canCreateContent}
                addTitle={createButtonTitle}
              />
            </div>
            <ModuleSidebarList>
              {categories.map((category) => (
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-base font-medium text-foreground">{title}</h2>
                <p className="text-sm text-muted-foreground">
                  {getRepositoryDescription(
                    activeRepository.name,
                    activeRepositoryState?.isGitRepository ?? null,
                    repositoryStatus === "checking" ? null : repositoryStatus === "ready",
                  )}
                </p>
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
                    item={item}
                    onInstallDialogOpenChange={onInstallDialogOpenChange}
                    onOpen={() => {
                      logger.info("Content detail opened from browser page.", {
                        contentId: item.id,
                        contentType: item.type,
                      })
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
        refreshSignal: contentRefreshSignal,
        onContentChanged: () => {
          setContentRefreshSignal((currentSignal) => currentSignal + 1)
        },
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
