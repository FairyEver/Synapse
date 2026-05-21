import { type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react"
import Fuse from "fuse.js"
import { toast } from "sonner"
import { purgeContent, restoreContent } from "@/app-shell/content"
import type {
  ContentOpenRequest,
  EditOverwriteRulePrefill,
  EditOverwriteSkillPrefill,
} from "@/app-shell/content-navigation"
import { useCurrentRepoProfile, useIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useActiveRepository, useRepositoryState } from "@/app-shell/use-repository-manager"
import { SidebarContentLayout } from "@/components/sidebar-content-layout"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { getContentTypeDefinition } from "@/config/content-types"
import {
  resolveCategoryViewId,
  SYNAPSE_ALL_CATEGORY_ID,
  SYNAPSE_BUILTIN_CATEGORY_ID,
  SYNAPSE_DELETED_CATEGORY_ID,
  SYNAPSE_FAVORITES_CATEGORY_ID,
  SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID,
} from "@/lib/content-categories"
import { ContentBulkActions } from "@/modules/content/components/content-bulk-actions"
import {
  contentSearchOptions,
  ContentStateView,
  getContentState,
  normalizeSearchQuery,
  SORT_OPTIONS,
  sortContentItems,
} from "@/modules/content/components/content-browser-utils"
import { ContentFilterSidebar } from "@/modules/content/components/content-filter-sidebar"
import { ContentGrid } from "@/modules/content/components/content-grid"
import { useContentCatalog } from "@/modules/content/hooks/use-content-catalog"
import { useContentFavorites } from "@/modules/content/hooks/use-content-favorites"
import { useContentRecentlyViewed } from "@/modules/content/hooks/use-content-recently-viewed"
import { useContentSortOrder } from "@/modules/content/hooks/use-content-sort-order"
import { useDeletedContent } from "@/modules/content/hooks/use-deleted-content"
import {
  countSavedContentMutations,
  isContentMutationSaved,
} from "@/modules/content/lib/content-mutation"
import type { SynapseContentSortOrder } from "@/types/config"
import type { SynapseContentMeta, SynapseContentMutationResult, SynapseContentType } from "@/types/content"

type ContentBrowserDetailDialogProps = {
  item: SynapseContentMeta | null
  onOpenChange: (open: boolean) => void
  open: boolean
  overwritePrefill: { requestId: string; prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill } | null
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
  const [overwritePrefill, setOverwritePrefill] = useState<
    { requestId: string; prefill: EditOverwriteRulePrefill | EditOverwriteSkillPrefill } | null
  >(null)
  const consumedOpenRequestIdRef = useRef<string | null>(null)
  const refreshedOpenRequestIdRef = useRef<string | null>(null)
  const [purgeTarget, setPurgeTarget] = useState<SynapseContentMeta | null>(null)
  const [purgeBusy, setPurgeBusy] = useState(false)
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
  const isDeletedView = activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID
  const { localIdentityState } = useIdentity()
  const currentUserId = localIdentityState?.status === "ready" ? localIdentityState.identity.userId : null

  const repositoryStatus = activeRepositoryState?.status ?? "checking"
  const canBrowseContent = repositoryStatus === "ready"
  const canCreateContent =
    canBrowseContent
    && currentRepoProfileState?.status !== "needs-onboarding"
  const normalizedQuery = useMemo(() => normalizeSearchQuery(searchQuery), [searchQuery])
  const deferredSearchQuery = useDeferredValue(normalizedQuery)
  const lastLoggedSearchQueryRef = useRef(deferredSearchQuery)

  // --- PLACEHOLDER_EFFECTS ---

  useEffect(() => {
    if (lastLoggedSearchQueryRef.current === deferredSearchQuery) return
    logger.info("Search query changed.", {
      contentType,
      from: lastLoggedSearchQueryRef.current,
      to: deferredSearchQuery,
    })
    lastLoggedSearchQueryRef.current = deferredSearchQuery
  }, [deferredSearchQuery, contentType, logger])

  useEffect(() => { onCreateDialogOpenChange?.(false) }, [onCreateDialogOpenChange])

  useEffect(() => {
    if (!isDeletedView) setDeletedFilter("mine")
  }, [isDeletedView])

  useEffect(() => {
    if (activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID) return
    if (activeCategoryId === SYNAPSE_DELETED_CATEGORY_ID) return
    if (activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID) {
      const hasVisibleItems = recentlyViewedIds.some((id) => items.some((item) => item.id === id))
      if (!hasVisibleItems) setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
      return
    }
    if (!categories.some((item) => item.id === activeCategoryId)) {
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
    }
  }, [activeCategoryId, categories, favoriteIds, recentlyViewedIds, items])

  useEffect(() => {
    if (!selectedItem) { onDetailDialogOpenChange?.(false); return }
    const itemExists = items.some((item) => item.id === selectedItem.id)
    if (!itemExists) { setSelectedItem(null); return }
    const nextSelectedItem = items.find((item) => item.id === selectedItem.id) ?? null
    if (nextSelectedItem && nextSelectedItem !== selectedItem) setSelectedItem(nextSelectedItem)
    onDetailDialogOpenChange?.(true)
  }, [items, onDetailDialogOpenChange, selectedItem])

  useEffect(() => {
    const request = pendingContentOpenRequest
    if (
      !request
      || request.contentType !== contentType
      || !(request.kind === "detail" || request.kind === "edit-overwrite")
      || consumedOpenRequestIdRef.current === request.requestId
      || isLoading
    ) {
      return
    }
    const item = items.find((c) => c.id === request.contentId) ?? null
    if (!item && refreshedOpenRequestIdRef.current !== request.requestId) {
      refreshedOpenRequestIdRef.current = request.requestId
      void refresh()
      return
    }
    consumedOpenRequestIdRef.current = request.requestId
    if (item) {
      logger.info("Content detail opened from external request.", {
        contentId: item.id,
        contentType: item.type,
        kind: request.kind,
      })
      setActiveCategoryId(SYNAPSE_ALL_CATEGORY_ID)
      void addRecentlyViewed(contentType, item.id)
      setSelectedItem(item)
      if (request.kind === "edit-overwrite") {
        setOverwritePrefill({ requestId: request.requestId, prefill: request.prefill })
      } else {
        setOverwritePrefill(null)
      }
    } else {
      logger.warn("Content detail external request target not found.", { contentId: request.contentId, contentType })
      toast.error("找不到内容，请刷新后重试。")
    }
    onPendingContentOpenRequestConsumed?.(request.requestId)
  }, [addRecentlyViewed, contentType, isLoading, items, logger, onPendingContentOpenRequestConsumed, pendingContentOpenRequest, refresh, setActiveCategoryId])

  // --- PLACEHOLDER_MEMOS ---

  const itemsInActiveCategory = useMemo(() => {
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
  }, [activeCategoryId, contentType, items, favoriteIds, recentlyViewedIds, deletedContent.items, deletedFilter, currentUserId])

  const contentSearch = useMemo(() => new Fuse(itemsInActiveCategory, contentSearchOptions), [itemsInActiveCategory])

  const filteredItems = useMemo(() => {
    if (deferredSearchQuery) {
      const searchResults = contentSearch.search(deferredSearchQuery).map((r) => r.item)
      return sortOrder ? sortContentItems(searchResults, sortOrder) : searchResults
    }
    return sortContentItems(itemsInActiveCategory, sortOrder)
  }, [activeCategoryId, contentSearch, itemsInActiveCategory, deferredSearchQuery, sortOrder])

  const summaryLabel = useMemo(() => {
    if (isDeletedView) return `共 ${filteredItems.length} 项`
    if (activeCategoryId === SYNAPSE_ALL_CATEGORY_ID
      || activeCategoryId === SYNAPSE_FAVORITES_CATEGORY_ID
      || activeCategoryId === SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID) {
      return deferredSearchQuery
        ? `显示 ${filteredItems.length} / ${itemsInActiveCategory.length} 项`
        : `共 ${filteredItems.length} 项`
    }
    return `显示 ${filteredItems.length} / ${totalCount} 项`
  }, [activeCategoryId, filteredItems.length, isDeletedView, deferredSearchQuery, totalCount, itemsInActiveCategory.length])

  const recentlyViewedCount = useMemo(() => {
    const itemIds = new Set(items.map((item) => item.id))
    return recentlyViewedIds.filter((id) => itemIds.has(id)).length
  }, [items, recentlyViewedIds])

  const state = useMemo(
    () => getContentState({
      activeCategoryId, categoryItems: categories, error, filteredItems,
      isLoading, items, itemsInActiveCategory,
      normalizedSearchQuery: deferredSearchQuery, onRetry: refresh,
      repositoryStatus, contentType,
    }),
    [activeCategoryId, categories, error, filteredItems, isLoading, items, itemsInActiveCategory, deferredSearchQuery, refresh, repositoryStatus, contentType],
  )

  // --- PLACEHOLDER_HANDLERS ---

  if (activeRepository === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">先选择本地目录</p>
      </div>
    )
  }

  const createButtonTitle =
    repositoryStatus === "checking" ? "正在检查目录状态..."
      : repositoryStatus === "missing" ? "当前目录不存在，不能新建"
        : currentRepoProfileState?.status === "needs-onboarding" ? "先完成当前目录的身份设置"
          : `新建 ${definition.singularLabel}`

  const handleRestoreItem = async (item: SynapseContentMeta) => {
    if (busyItemId) return
    setBusyItemId(item.id)
    const startedAt = performance.now()
    logger.info("Content restore initiated.", { contentId: item.id, contentType })
    try {
      const result = await restoreContent({ id: item.id, type: contentType, baseHistoryDirname: item.latestHistoryDirname })
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
  }

  const handlePurgeConfirm = async () => {
    if (!purgeTarget || purgeBusy) return
    setPurgeBusy(true)
    const startedAt = performance.now()
    logger.info("Content purge initiated.", { contentId: purgeTarget.id, contentType })
    try {
      await purgeContent({ id: purgeTarget.id, type: contentType })
      logger.info("Content purged.", { contentId: purgeTarget.id, contentType, elapsedMs: Math.round(performance.now() - startedAt) })
      toast.success(`已永久删除「${purgeTarget.title}」`)
      setPurgeTarget(null)
      void deletedContent.refresh()
    } catch (err) {
      logger.error("Content purge failed.", { contentId: purgeTarget.id, contentType, elapsedMs: Math.round(performance.now() - startedAt), error: err })
      toast.error("永久删除失败，请稍后重试。")
    } finally {
      setPurgeBusy(false)
    }
  }

  const handleBatchConfirm = async () => {
    if (busyBatchAction) return
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
            results.push(await restoreContent({ id: item.id, type: contentType, baseHistoryDirname: item.latestHistoryDirname }))
          } else {
            await purgeContent({ id: item.id, type: contentType })
            successCount++
          }
        } catch (err) {
          logger.error("Batch action item failed.", { action, contentId: item.id, contentType, error: err })
        }
      }
      if (action === "restore") successCount = countSavedContentMutations(results)
      logger.info("Batch action completed.", { action, contentType, successCount, total: targets.length, elapsedMs: Math.round(performance.now() - startedAt) })
      if (action === "restore") void Promise.all([deletedContent.refresh(), refresh()])
      else void deletedContent.refresh()
      const verb = action === "restore" ? "恢复" : "永久删除"
      if (successCount === targets.length) toast.success(`已${verb} ${successCount} 项内容`)
      else if (action === "restore" && results.length > successCount) toast.warning(`已${verb} ${successCount}/${targets.length} 项，部分内容已变化`)
      else toast.warning(`${verb}了 ${successCount}/${targets.length} 项，部分操作失败`)
    } finally {
      setBusyBatchAction(null)
    }
  }

  // --- PLACEHOLDER_RETURN ---

  return (
    <>
      <SidebarContentLayout
        contentClassName="bg-surface"
        sidebar={
          <ContentFilterSidebar
            activeCategoryId={activeCategoryId}
            addDisabled={!canCreateContent}
            addTitle={createButtonTitle}
            canBrowseContent={canBrowseContent}
            categories={categories}
            deletedCount={deletedContent.count}
            favoriteCount={favoriteIds.length}
            onActiveCategoryChange={setActiveCategoryId}
            onAddClick={() => {
              logger.info("Create entry requested from browser page.", { contentType, repositoryUuid: activeRepository.uuid })
              if (!onCreateClick) {
                logger.warn("Create entry requested without a registered handler.", { contentType, repositoryUuid: activeRepository.uuid })
                return
              }
              onCreateClick()
            }}
            onSearchChange={setSearchQuery}
            recentlyViewedCount={recentlyViewedCount}
            searchDisabled={!canBrowseContent}
            searchPlaceholder={`搜索 ${definition.pluralLabel}`}
            searchValue={searchQuery}
          />
        }
      >
        <section className="h-full min-h-0">
          <div className="flex min-h-full flex-col gap-2.5 px-2 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-base font-medium text-foreground">
                  {isDeletedView ? "最近删除" : definition.pluralLabel}
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
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
              <ContentBulkActions
                batchAction={batchAction}
                busyBatchAction={busyBatchAction}
                deletedFilter={deletedFilter}
                filteredItemCount={filteredItems.length}
                onBatchActionChange={(action) => {
                  if (action) logger.info("Batch action dialog opened.", { action, contentType })
                  setBatchAction(action)
                }}
                onBatchConfirm={handleBatchConfirm}
                onDeletedFilterChange={setDeletedFilter}
                purgeTarget={purgeTarget}
                purgeBusy={purgeBusy}
                onPurgeTargetChange={setPurgeTarget}
                onPurgeConfirm={handlePurgeConfirm}
              />
            )}

            {state ? (
              <ContentStateView {...state} />
            ) : (
              <ContentGrid
                contentType={contentType}
                isDeletedView={isDeletedView}
                items={filteredItems}
                busyItemId={busyItemId}
                onInstallDialogOpenChange={onInstallDialogOpenChange}
                onOpenItem={(item) => {
                  logger.info("Content detail opened from browser page.", { contentId: item.id, contentType: item.type })
                  void addRecentlyViewed(contentType, item.id)
                  setSelectedItem(item)
                }}
                onRestoreItem={handleRestoreItem}
                onPurgeItem={(item) => {
                  logger.info("Content purge confirm dialog opened.", { contentId: item.id, contentType })
                  setPurgeTarget(item)
                }}
              />
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
            setOverwritePrefill(null)
          }
        },
        overwritePrefill,
      })}
    </>
  )
}

export { ContentBrowserPage }
