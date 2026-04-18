import { useEffect, useMemo, useState } from "react"
import {
  Folders,
  LoaderCircle,
  MoreHorizontal,
  PackageOpen,
  Plus,
  SearchX,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useRepositoryManager } from "@/app-shell/repository"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import {
  getCategoryLabel,
  resolveCategoryViewId,
  SYNAPSE_ALL_CATEGORY_ID,
} from "@/lib/content-categories"
import { cn } from "@/lib/utils"
import { useContentCatalog } from "@/modules/content/hooks/use-content-catalog"
import { ContentDetailDialog } from "@/modules/content/components/content-detail-dialog"
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type ContentBrowserPageProps = {
  contentType: SynapseContentType
  onDetailDialogOpenChange?: (open: boolean) => void
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
  return value.trim().toLocaleLowerCase()
}

function matchesSearch(item: SynapseContentMeta, normalizedQuery: string): boolean {
  if (!normalizedQuery) {
    return true
  }

  const haystack = `${item.title} ${item.description}`.toLocaleLowerCase()

  return haystack.includes(normalizedQuery)
}

function formatCreatedAt(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date)
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
    <Empty className="min-h-[320px] rounded-lg border border-border bg-muted/20">
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
  onMoreActionsClick,
  onOpen,
}: {
  contentType: SynapseContentType
  item: SynapseContentMeta
  onMoreActionsClick: () => void
  onOpen: () => void
}) {
  const categoryLabel = getCategoryLabel(contentType, item.category)

  return (
    <Card
      size="sm"
      className="cursor-pointer border border-border/70 transition-colors hover:bg-muted/20"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
    >
      <CardContent className="flex items-center gap-4">
        <div
          className="flex size-12 shrink-0 items-center justify-center rounded-lg text-lg font-medium text-white ring-1 ring-black/5"
          style={{ backgroundColor: item.iconBg }}
          title={item.title}
        >
          <span className="block max-w-full truncate px-1 leading-none">{item.icon}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
            <p className="line-clamp-2 text-sm text-muted-foreground">{item.description}</p>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>{categoryLabel}</span>
            <span>{item.author}</span>
            <span>{formatCreatedAt(item.createdAt)}</span>
          </div>
        </div>

        <div className="shrink-0 self-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={(event) => {
              event.stopPropagation()
              onMoreActionsClick()
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
            }}
            title="更多操作"
          >
            <MoreHorizontal />
            <span className="sr-only">更多操作</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function ContentBrowserPage({
  contentType,
  onDetailDialogOpenChange,
  title,
}: ContentBrowserPageProps) {
  const logger = useMemo(() => createRendererLogger(`content.browser.${contentType}`), [contentType])
  const { activeRepository } = useAppConfig()
  const { states } = useRepositoryManager()
  const { categories, error, isLoading, items, totalCount } = useContentCatalog(contentType)
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

  const filteredItems = useMemo(
    () => itemsInActiveCategory.filter((item) => matchesSearch(item, normalizedSearchQuery)),
    [itemsInActiveCategory, normalizedSearchQuery],
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
      <div className="h-full overflow-hidden p-6">
        <div className="mx-auto grid h-full max-w-6xl gap-6 md:grid-cols-[280px_minmax(0,1fr)]">
          <aside className="min-h-0 rounded-lg border border-border/70 bg-background p-3">
            <div className="flex h-full min-h-0 flex-col gap-3">
              <div className="flex items-center gap-2">
                <Input
                  value={searchQuery}
                  disabled={!canBrowseContent}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={`搜索 ${title}`}
                />
                <Button
                  variant="outline"
                  size="icon"
                  disabled={!canCreateContent}
                  onClick={() => {
                    logger.info("Create entry requested from browser page.", {
                      contentType,
                      repositoryUuid: activeRepository.uuid,
                    })
                    window.alert(`现在还不能在这里新建 ${getSingularLabel(contentType)}。`)
                  }}
                  title={createButtonTitle}
                >
                  <Plus />
                  <span className="sr-only">{createButtonTitle}</span>
                </Button>
              </div>

              <Separator />

              <div className="min-h-0 flex-1 overflow-y-auto">
                <div className="flex flex-col gap-1">
                  {categories.map((category) => (
                    <Button
                      key={category.id}
                      variant={category.id === activeCategoryId ? "secondary" : "ghost"}
                      className="w-full justify-between"
                      disabled={!canBrowseContent}
                      onClick={() => setActiveCategoryId(category.id)}
                    >
                      <span className="truncate">{category.label}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {category.count}
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </aside>

          <section className="min-h-0 overflow-y-auto">
            <div className="flex min-h-full flex-col gap-4">
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
                <div className="grid gap-3 xl:grid-cols-2">
                  {filteredItems.map((item) => (
                    <ContentListCard
                      key={item.id}
                      contentType={contentType}
                      item={item}
                      onMoreActionsClick={() => {
                        logger.info("Content card action requested.", {
                          contentId: item.id,
                          contentType: item.type,
                        })
                      }}
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
        </div>
      </div>

      <ContentDetailDialog
        item={selectedItem}
        open={selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedItem(null)
          }
        }}
      />
    </>
  )
}

export { ContentBrowserPage }
