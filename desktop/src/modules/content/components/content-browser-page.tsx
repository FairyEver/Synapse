import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type MouseEvent } from "react"
import Fuse from "fuse.js"
import { toast } from "sonner"
import { useActiveRepositorySwitch } from "@/app-shell/active-repository-switch"
import { openContentDetailWindow, openContentEditWindow, purgeContent, restoreContent } from "@/app-shell/content"
import type { ContentOpenRequest } from "@/app-shell/content-navigation"
import { useCurrentRepoProfile, useIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { requestOpenSettingsStorage } from "@/app-shell/navigation"
import { useAppNotifications } from "@/app-shell/notifications"
import { RepositoryToolbarActions } from "@/app-shell/components/repository-toolbar-actions"
import { useRepositoryToolbarState } from "@/app-shell/use-repository-toolbar-state"
import {
  useActiveRepository,
  useRepositoryActions,
  useRepositoryState,
} from "@/app-shell/use-repository-manager"
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
  SYNAPSE_DELETED_CATEGORY_ID,
  SYNAPSE_FAVORITES_CATEGORY_ID,
  SYNAPSE_RECENTLY_VIEWED_CATEGORY_ID,
} from "@/lib/content-categories"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import { ContentBulkActions } from "@/modules/content/components/content-bulk-actions"
import {
  contentSearchOptions,
  ContentStateView,
  countVisibleContentIds,
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
  canManageContentDeletion,
  countSavedContentMutations,
  isContentMutationSaved,
  summarizeContentMutationConflictTitles,
} from "@/modules/content/lib/content-mutation"
import type { SynapseContentSortOrder } from "@/types/config"
import type { SynapseContentMeta, SynapseContentMutationResult, SynapseContentType } from "@/types/content"

type ContentBrowserPageProps = {
  contentType: SynapseContentType
  hasBlockingModalOpen?: boolean
  onCreateClick?: () => void
  onInstallDialogOpenChange?: (open: boolean) => void
  pendingContentOpenRequest?: ContentOpenRequest | null
  onPendingContentOpenRequestConsumed?: (requestId: string) => void
}

function ContentBrowserPage({
  contentType,
  hasBlockingModalOpen = false,
  onCreateClick,
  onInstallDialogOpenChange,
  pendingContentOpenRequest,
  onPendingContentOpenRequestConsumed,
}: ContentBrowserPageProps) {
  const definition = getContentTypeDefinition(contentType)
  const logger = useMemo(() => createRendererLogger(`content.browser.${contentType}`), [contentType])
  const activeRepository = useActiveRepository()
  const {
    isSwitchingRepository,
    openRepositorySwitchDialog,
  } = useActiveRepositorySwitch()
  const { promise } = useAppNotifications()
  const { syncRepository } = useRepositoryActions()
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
  const toolbarState = useRepositoryToolbarState({
    hasBlockingModalOpen,
  })

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
      if (request.kind === "edit-overwrite") {
        void openContentEditWindow({
          contentType,
          id: item.id,
          origin: "external",
          prefill: request.prefill,
          quickPublishSessionId: request.quickPublishSessionId,
          requestId: request.requestId,
          sourceLabel: request.sourceLabel,
          title: `编辑 ${item.title}`,
        }).catch((error) => {
          logger.error("Failed to open content edit window from external request.", {
            contentId: item.id,
            contentType,
            error,
          })
          toast.error(error instanceof Error ? error.message : "打开编辑窗口失败。")
        })
      } else {
        void openContentDetailWindow({
          contentType,
          id: item.id,
          title: item.title,
          viewMode: "rendered",
        }).catch((error) => {
          logger.error("Failed to open content detail window from external request.", {
            contentId: item.id,
            contentType,
            error,
          })
          toast.error(error instanceof Error ? error.message : "打开详情窗口失败。")
        })
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
        return deletedContent.items.filter((item) => (
          contentType === "skill"
            ? item.createdBy === currentUserId
            : item.modifiedBy === currentUserId
        ))
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

  const manageableDeletedItems = useMemo(
    () => filteredItems.filter((item) => canManageContentDeletion(item, currentUserId)),
    [currentUserId, filteredItems],
  )

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
    return countVisibleContentIds(recentlyViewedIds, items)
  }, [items, recentlyViewedIds])

  const favoriteCount = useMemo(() => {
    return countVisibleContentIds(favoriteIds, items)
  }, [items, favoriteIds])

  const stateItems = isDeletedView ? deletedContent.items : items
  const stateError = isDeletedView ? deletedContent.error : error
  const stateIsLoading = isDeletedView ? deletedContent.isLoading : isLoading
  const stateRetry = isDeletedView ? deletedContent.refresh : refresh

  const state = useMemo(
    () => getContentState({
      activeCategoryId, categoryItems: categories, error: stateError, filteredItems,
      isLoading: stateIsLoading, items: stateItems, itemsInActiveCategory,
      normalizedSearchQuery: deferredSearchQuery, onRetry: stateRetry,
      repositoryStatus, contentType,
    }),
    [activeCategoryId, categories, stateError, filteredItems, stateIsLoading, stateItems, itemsInActiveCategory, deferredSearchQuery, stateRetry, repositoryStatus, contentType],
  )

  // --- PLACEHOLDER_HANDLERS ---

  const handleOpenItemInWindow = useCallback(async (item: SynapseContentMeta) => {
    logger.info("Content detail window opened from browser page.", {
      contentId: item.id,
      contentType: item.type,
    })
    void addRecentlyViewed(contentType, item.id)

    try {
      await openContentDetailWindow({
        contentType: item.type,
        id: item.id,
        title: item.title,
        viewMode: "rendered",
      })
    } catch (openWindowError) {
      logger.error("Failed to open content detail window from browser page.", {
        contentId: item.id,
        contentType: item.type,
        error: openWindowError,
      })
      toast.error(openWindowError instanceof Error ? openWindowError.message : "打开新窗口失败。")
    }
  }, [addRecentlyViewed, contentType, logger])

  const handleManualRepositorySync = useCallback((source: "refresh" | "sync-status") => {
    if (!activeRepository) return

    logger.info("Manual repository sync requested from content browser.", {
      contentType,
      repositoryUuid: activeRepository.uuid,
      source,
    })
    void promise(
      () => syncRepository(activeRepository.uuid),
      {
        loading: "正在同步仓库...",
        success: (result) => result.message ?? "仓库同步完成。",
        error: (syncError) => syncError instanceof Error ? syncError.message : "同步仓库失败。",
      },
    ).catch((syncError) => {
      logger.error("Manual repository sync failed from content browser.", syncError)
    })
  }, [activeRepository, contentType, logger, promise, syncRepository])

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
    if (!canManageContentDeletion(item, currentUserId)) return
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

  const purgeItem = async (item: SynapseContentMeta) => {
    if (!canManageContentDeletion(item, currentUserId)) return
    if (purgeBusy) return
    setPurgeBusy(true)
    const startedAt = performance.now()
    logger.info("Content purge initiated.", { contentId: item.id, contentType })
    try {
      const result = await purgeContent({
        id: item.id,
        type: contentType,
        baseHistoryDirname: item.latestHistoryDirname,
      })
      if (!isContentMutationSaved(result)) {
        logger.warn("Content purge conflict detected.", { contentId: item.id, contentType, latestHistoryDirname: result.latestHistoryDirname })
        toast.warning("内容已变化，请刷新后重试。")
        setPurgeTarget(null)
        void Promise.all([deletedContent.refresh(), refresh()])
        return
      }
      logger.info("Content purged.", { contentId: item.id, contentType, elapsedMs: Math.round(performance.now() - startedAt) })
      toast.success(`已永久删除「${item.title}」`)
      setPurgeTarget(null)
      void deletedContent.refresh()
    } catch (err) {
      logger.error("Content purge failed.", { contentId: item.id, contentType, elapsedMs: Math.round(performance.now() - startedAt), error: err })
      toast.error("永久删除失败，请稍后重试。")
    } finally {
      setPurgeBusy(false)
    }
  }

  const handlePurgeConfirm = async () => {
    if (!purgeTarget) return
    await purgeItem(purgeTarget)
  }

  const handlePurgeStart = (item: SynapseContentMeta, event: MouseEvent<HTMLElement>) => {
    if (shouldBypassDeleteConfirm(event)) {
      void purgeItem(item)
      return
    }
    logger.info("Content purge confirm dialog opened.", { contentId: item.id, contentType })
    setPurgeTarget(item)
  }

  const handleBatchConfirm = async () => {
    if (busyBatchAction) return
    const action = batchAction
    const targets = [...manageableDeletedItems]
    setBatchAction(null)
    if (!action || targets.length === 0) return
    const startedAt = performance.now()
    logger.info("Batch action initiated.", { action, contentType, count: targets.length })
    setBusyBatchAction(action)
    const results: SynapseContentMutationResult[] = []
    const conflictItems: SynapseContentMeta[] = []
    let successCount = 0
    try {
      for (const item of targets) {
        try {
          if (action === "restore") {
            const result = await restoreContent({ id: item.id, type: contentType, baseHistoryDirname: item.latestHistoryDirname })
            results.push(result)
            if (result.status === "conflict") conflictItems.push(item)
          } else {
            const result = await purgeContent({
              id: item.id,
              type: contentType,
              baseHistoryDirname: item.latestHistoryDirname,
            })
            results.push(result)
            if (result.status === "conflict") conflictItems.push(item)
          }
        } catch (err) {
          logger.error("Batch action item failed.", { action, contentId: item.id, contentType, error: err })
        }
      }
      successCount = countSavedContentMutations(results)
      const conflictCount = conflictItems.length
      logger.info("Batch action completed.", { action, contentType, successCount, total: targets.length, elapsedMs: Math.round(performance.now() - startedAt) })
      void Promise.all([deletedContent.refresh(), refresh()])
      const verb = action === "restore" ? "恢复" : "永久删除"
      if (successCount === targets.length) toast.success(`已${verb} ${successCount} 项内容`)
      else if (conflictCount > 0) toast.warning(`已${verb} ${successCount}/${targets.length} 项，以下内容已变化：${summarizeContentMutationConflictTitles(conflictItems)}`)
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
            favoriteCount={favoriteCount}
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
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
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
                <RepositoryToolbarActions
                  activeRepository={activeRepository}
                  activityLabel={toolbarState.activityLabel}
                  pendingPushCount={toolbarState.pendingPushCount}
                  refreshBusy={toolbarState.refreshBusy}
                  refreshDisabled={toolbarState.refreshDisabled}
                  refreshTitle={toolbarState.refreshTitle}
                  repositorySwitchDisabled={toolbarState.repositorySwitchDisabled}
                  repositorySwitchTitle={toolbarState.repositorySwitchTitle}
                  showRefresh={toolbarState.showRefresh}
                  showRepositorySwitch={toolbarState.showRepositorySwitch}
                  syncSnapshot={toolbarState.syncSnapshot}
                  syncStatus={toolbarState.syncStatus}
                  onOpenRepositorySettings={requestOpenSettingsStorage}
                  onSyncStatusRetry={() => handleManualRepositorySync("sync-status")}
                  onRefresh={() => handleManualRepositorySync("refresh")}
                  onRepositorySwitch={() => {
                    if (toolbarState.repositorySwitchDisabled || isSwitchingRepository) return
                    openRepositorySwitchDialog()
                  }}
                />
              </div>
            </div>

            {isDeletedView && (
              <ContentBulkActions
                batchAction={batchAction}
                busyBatchAction={busyBatchAction}
                deletedFilter={deletedFilter}
                filteredItemCount={manageableDeletedItems.length}
                mineLabel={contentType === "skill" ? "我创建的" : "我删除的"}
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
                canManageDeletedItem={(item) => canManageContentDeletion(item, currentUserId)}
                contentType={contentType}
                isDeletedView={isDeletedView}
                items={filteredItems}
                busyItemId={busyItemId}
                onInstallDialogOpenChange={onInstallDialogOpenChange}
                onOpenItem={(item) => {
                  void handleOpenItemInWindow(item)
                }}
                onRestoreItem={handleRestoreItem}
                onPurgeItem={handlePurgeStart}
              />
            )}
          </div>
        </section>
      </SidebarContentLayout>

    </>
  )
}

export { ContentBrowserPage }
