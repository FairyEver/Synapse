import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  openContentDetailWindow,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { useCurrentRepoProfile, useRepoProfileMap } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import {
  useActiveRepository,
  useContentList,
  usePendingPushes,
  useRepositoryManager,
  useRepositoryOperation,
} from "@/app-shell/use-repository-manager"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Separator } from "@/components/ui/separator"
import { formatDateTime } from "@/lib/date-time"
import { getCategoryLabel } from "@/lib/content-categories"
import { resolveDisplayName } from "@/lib/display-name"
import { cn } from "@/lib/utils"
import {
  ContentDetailMenubar,
  type ContentInstallTargetRequest,
} from "@/modules/content/components/content-detail-menubar"
import { ContentDetailPanel } from "@/modules/content/components/content-detail-panel"
import {
  ContentItemIcon,
  invalidateIconImageCache,
} from "@/modules/content/components/content-item-icon"
import { ContentItemMeta } from "@/modules/content/components/content-item-meta"
import {
  useContentDetailState,
  type SynapseLoadedContentVersion,
} from "@/modules/content/hooks/use-content-detail-state"
import { useContentFavorites } from "@/modules/content/hooks/use-content-favorites"
import { useEditorInstallStatus } from "@/modules/content/hooks/use-editor-install-status"
import type { ConflictState } from "@/modules/content/types/conflict"
import type {
  SynapseContentDetail,
  SynapseContentMeta,
  SynapseContentType,
  SynapseUpdateContentPayload,
} from "@/types/content"
import type { SynapseEditorInstallStatusEntry } from "@/types/editor-install-status"

type ContentDetailDialogLabels = {
  singular: string
  deleteConfirmTitle: string
  deleteConfirmDescription: string
  deleteLoading: string
  deleteError: string
  conflictTitle: string
  conflictDescription: (name: string, time: string) => string
  emptyDescription: string
  emptyTitle: string
  errorTitle: string
  loadingTitle: string
}

type ContentDetailDialogProps<
  TPayload,
  TContentType extends SynapseContentType,
> = {
  contentType: TContentType
  item: SynapseContentMeta<TContentType> | null
  labels: ContentDetailDialogLabels
  logCategory: string
  onContentChanged?: () => void
  onOpenChange: (open: boolean) => void
  open: boolean
  refreshSignal?: number
  renderCreateDialog: (props: {
    editingId: string | null
    existingNames: string[]
    initialValue: TPayload
    mode: "edit"
    open: boolean
    onOpenChange: (open: boolean) => void
    onSubmit: (payload: TPayload) => void
    submitDisabled: boolean
    submitDisabledReason: string | null
  }) => ReactNode
  renderVersionView: (props: {
    mode: "rendered" | "source"
    version: SynapseLoadedContentVersion<TContentType>
  }) => ReactNode
  buildInitialValue: (detail: SynapseContentDetail<TContentType>) => TPayload
  serializePayload?: (payload: TPayload) => Promise<TPayload> | TPayload
}

function ContentDetailDialog<TPayload, TContentType extends SynapseContentType>({
  contentType,
  item,
  labels,
  logCategory,
  onContentChanged,
  onOpenChange,
  open,
  refreshSignal = 0,
  renderCreateDialog,
  renderVersionView,
  buildInitialValue,
  serializePayload,
}: ContentDetailDialogProps<TPayload, TContentType>) {
  const logger = useMemo(() => createRendererLogger(logCategory), [logCategory])
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { config } = useAppConfig()
  const repoProfileMap = useRepoProfileMap()
  const activeRepository = useActiveRepository()
  const { error, promise } = useAppNotifications()
  const manager = useRepositoryManager()
  const { items: contentItems } = useContentList(contentType)
  const existingNames = useMemo(
    () => contentItems
      .filter((ci) => ci.source !== "builtin" && ci.name && ci.id !== item?.id)
      .map((ci) => ci.name!),
    [contentItems, item?.id],
  )
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [conflictState, setConflictState] = useState<ConflictState<TPayload> | null>(null)
  const [contentReady, setContentReady] = useState(false)
  const [installStatusRefreshSignal, setInstallStatusRefreshSignal] = useState(0)
  const [installTargetRequest, setInstallTargetRequest] = useState<ContentInstallTargetRequest | null>(null)

  useEffect(() => {
    if (!open) {
      setContentReady(false)
      return
    }
    const timer = setTimeout(() => setContentReady(true), 250)
    return () => clearTimeout(timer)
  }, [open])
  const {
    detail,
    displayedVersion,
    historyEntries,
    isLoading,
    previewError,
    selectedHistoryDirname,
    setSelectedHistoryDirname: setSelectedHistoryDirnameRaw,
    setViewMode: setViewModeRaw,
    viewMode,
  } = useContentDetailState<TContentType>({
    invalidTypeMessage: `读取到的内容不是 ${labels.singular}。`,
    item,
    loadDetailErrorMessage: `读取 ${labels.singular} 详情失败。`,
    loadHistoryErrorMessage: `读取 ${labels.singular} 历史失败。`,
    logCategory,
    open,
    refreshSignal,
  })
  const editorInstallStatus = useEditorInstallStatus({
    content: displayedVersion?.content ?? detail?.content ?? null,
    detail,
    item,
    open,
    projects: config.global.projects,
    refreshSignal: installStatusRefreshSignal,
  })
  const viewModeRef = useRef(viewMode)
  viewModeRef.current = viewMode
  const selectedHistoryDirnameRef = useRef(selectedHistoryDirname)
  selectedHistoryDirnameRef.current = selectedHistoryDirname
  const { isFavorite, toggleFavorite } = useContentFavorites()
  const isItemFavorite = item ? isFavorite(contentType, item.id) : false
  const activeRepositoryOperation = useRepositoryOperation(activeRepository?.uuid ?? "")
  const pendingPushState = usePendingPushes(activeRepository?.uuid ?? "")
  const isSyncing = (pendingPushState?.count ?? 0) > 0
  const isRepositoryInitializing =
    activeRepositoryOperation?.isRunning
    && activeRepositoryOperation.operation === "initialize"
  const submitDisabledReason =
    currentRepoProfileState?.status === "needs-onboarding"
      ? "请先完成当前目录的身份设置"
      : isRepositoryInitializing
        ? "当前目录正在初始化，请稍后。"
        : isSyncing
          ? "正在同步变更，请稍后。"
          : null

  const handleViewModeChange = useCallback((nextViewMode: "rendered" | "source") => {
    const prevViewMode = viewModeRef.current
    if (prevViewMode !== nextViewMode) {
      logger.info("Content view mode changed.", {
        contentId: item?.id ?? null,
        contentType,
        from: prevViewMode,
        to: nextViewMode,
      })
    }
    setViewModeRaw(nextViewMode)
  }, [contentType, item?.id, logger, setViewModeRaw])

  const handleHistorySelectionChange = useCallback((nextHistoryDirname: string | null) => {
    const prevHistoryDirname = selectedHistoryDirnameRef.current
    if (prevHistoryDirname !== nextHistoryDirname) {
      logger.info("Content history version changed.", {
        contentId: item?.id ?? null,
        contentType,
        from: prevHistoryDirname ?? "current",
        to: nextHistoryDirname ?? "current",
      })
    }
    setSelectedHistoryDirnameRaw(nextHistoryDirname)
  }, [contentType, item?.id, logger, setSelectedHistoryDirnameRaw])

  const handleInstallStatusRefresh = useCallback(() => {
    setInstallStatusRefreshSignal((value) => value + 1)
  }, [])

  const handleOpenInstallTarget = useCallback((entry: SynapseEditorInstallStatusEntry) => {
    const project = entry.projectId
      ? config.global.projects.find((candidate) => candidate.id === entry.projectId)
      : null
    const projectPath = entry.scope === "project" ? project?.path : undefined

    logger.info("Install requested from status panel.", {
      contentId: item?.id ?? null,
      contentType,
      editorId: entry.editorId,
      projectId: entry.projectId ?? null,
      scope: entry.scope,
    })
    setInstallTargetRequest({
      editorId: entry.editorId,
      projectId: entry.projectId,
      projectPath,
      scope: entry.scope,
    })
  }, [config.global.projects, contentType, item?.id, logger])

  useEffect(() => {
    if (!open) {
      setViewModeRaw("rendered")
      setSelectedHistoryDirnameRaw(null)
      setIsEditOpen(false)
      setIsDeleteConfirmOpen(false)
      setConflictState(null)
    }
  }, [open, setSelectedHistoryDirnameRaw, setViewModeRaw])

  if (!item) {
    return null
  }

  const resolvedItem = detail ?? item
  const deleteTarget = detail ?? item
  const isReadonly = resolvedItem.source === "builtin" || resolvedItem.isReadonly === true
  const categoryLabel = getCategoryLabel(item.type, resolvedItem.category)
  const authorLabel = resolveDisplayName(
    resolvedItem.createdBy,
    repoProfileMap,
    resolvedItem.createdByDisplayName,
  )

  const [isSaving, setIsSaving] = useState(false)

  const handleSave = async (payload: TPayload, force = false) => {
    if (!detail) {
      return
    }

    logger.info(`${labels.singular} save initiated from detail dialog.`, {
      contentId: detail.id,
      contentType,
      force,
    })

    setIsSaving(true)

    const serializedPayload = serializePayload
      ? await serializePayload(payload)
      : payload

    void promise(
      async () => {
        const updatePayload: SynapseUpdateContentPayload<typeof item.type> = {
          ...serializedPayload as SynapseUpdateContentPayload<typeof item.type>,
          id: detail.id,
          baseHistoryDirname: detail.latestHistoryDirname,
          force,
        }
        const result = await manager.updateContent(contentType, updatePayload)

        if (result.status !== "saved") {
          return result
        }

        invalidateIconImageCache(contentType, detail.id)
        onContentChanged?.()

        if (result.pendingPushCount > 0 && activeRepository) {
          await manager.waitForBackgroundPush(activeRepository.uuid)
        }

        return result
      },
      {
        loading: "正在保存...",
        success: (result) => {
          if (result.status === "conflict") {
            logger.warn("Content save conflict detected.", {
              contentId: detail.id,
              contentType,
              latestHistoryDirname: result.latestHistoryDirname ?? null,
            })
            setConflictState({
              latestHistoryDirname: result.latestHistoryDirname ?? "",
              latestModifiedAt: result.latestModifiedAt ?? "",
              latestModifiedByDisplayName: result.latestModifiedByDisplayName ?? "",
              mode: "save",
              payload,
            })
            return null
          }

          setIsEditOpen(false)
          onOpenChange(false)
          return result.pendingPushCount > 0 ? "已保存并同步。" : "保存成功。"
        },
        error: (err) => err instanceof Error ? err.message : "保存失败。",
      },
    ).catch((err) => {
      logger.error(`${labels.singular} save failed from detail dialog.`, {
        contentId: detail.id,
        error: err,
      })
    }).finally(() => {
      setIsSaving(false)
    })
  }

  const handleDelete = async (force = false) => {
    logger.info(`${labels.singular} delete initiated from detail dialog.`, {
      contentId: deleteTarget.id,
      contentType,
      force,
    })
    await promise(
      () => manager.deleteContent({
        id: deleteTarget.id,
        type: deleteTarget.type,
        baseHistoryDirname: deleteTarget.latestHistoryDirname,
        force,
      }),
      {
        loading: labels.deleteLoading,
        success: (result) => {
          if (result.status === "conflict") {
            logger.warn("Content delete conflict detected.", {
              contentId: deleteTarget.id,
              contentType,
              latestHistoryDirname: result.latestHistoryDirname ?? null,
            })
            setConflictState({
              latestHistoryDirname: result.latestHistoryDirname ?? "",
              latestModifiedAt: result.latestModifiedAt ?? "",
              latestModifiedByDisplayName: result.latestModifiedByDisplayName ?? "",
              mode: "delete",
              payload: {
                id: deleteTarget.id,
                type: deleteTarget.type,
                baseHistoryDirname: deleteTarget.latestHistoryDirname,
              },
            })
            return null
          }

          setIsDeleteConfirmOpen(false)
          onContentChanged?.()
          onOpenChange(false)
          return result.message
        },
        error: (err) => err instanceof Error ? err.message : labels.deleteError,
      },
    )
  }

  const handleConflictContinue = async () => {
    if (!conflictState) {
      return
    }

    const nextConflictState = conflictState
    setConflictState(null)

    if (nextConflictState.mode === "delete") {
      await handleDelete(true)
      return
    }

    try {
      await handleSave(nextConflictState.payload, true)
    } catch {
      // Error handled by notification system
    }
  }

  const handleOpenInNewWindow = async () => {
    try {
      logger.info("Open content detail in new window requested.", {
        contentId: item.id,
        contentType,
        viewMode,
        historyDirname: selectedHistoryDirname ?? displayedVersion?.historyDirname ?? null,
      })
      await openContentDetailWindow({
        contentType: item.type,
        id: item.id,
        title: resolvedItem.title,
        viewMode,
        historyDirname: selectedHistoryDirname ?? displayedVersion?.historyDirname,
      })
    } catch (openWindowError) {
      logger.error(`Failed to open ${labels.singular} detail window.`, {
        contentId: item.id,
        error: openWindowError,
      })
      error(openWindowError instanceof Error ? openWindowError.message : "打开新窗口失败。")
    }
  }

  return (
    <>
      <AlertDialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.deleteConfirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{labels.deleteConfirmDescription}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRepositoryInitializing || isSyncing}
              onClick={() => void handleDelete()}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={conflictState !== null} onOpenChange={(openState) => {
        if (!openState) {
          setConflictState(null)
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{labels.conflictTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {conflictState
                ? labels.conflictDescription(
                    conflictState.latestModifiedByDisplayName || "未命名用户",
                    formatDateTime(conflictState.latestModifiedAt),
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (conflictState) {
                  handleHistorySelectionChange(conflictState.latestHistoryDirname)
                }
              }}
            >
              查看对方修改了什么
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isRepositoryInitializing || isSyncing}
              onClick={() => void handleConflictContinue()}
            >
              继续保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange} data-track="content-detail-dialog">
        <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-[600px]">
          <DialogHeader className="px-5 pt-5">
            <DialogTitle className="sr-only">{resolvedItem.title}</DialogTitle>
            <DialogDescription className="sr-only">{resolvedItem.description}</DialogDescription>

            <div className="flex min-w-0 items-start gap-3 pr-8">
              <ContentItemIcon
                contentId={item.id}
                contentType={item.type}
                icon={resolvedItem.icon}
                iconType={resolvedItem.iconType}
                iconImage={resolvedItem.iconImage}
                title={resolvedItem.title}
                tone={resolvedItem.iconBg}
              />

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <ContentItemMeta
                  author={authorLabel}
                  category={categoryLabel}
                  description={resolvedItem.description}
                  descriptionWrap
                  title={resolvedItem.title}
                />

                <div className="flex flex-wrap items-center gap-2">
                  <ContentDetailMenubar
                    canDelete={!isReadonly}
                    canEdit={Boolean(detail) && !isReadonly && !isRepositoryInitializing && !isSyncing}
                    canOpenInNewWindow={Boolean(displayedVersion)}
                    installStatus={detail?.type === "rule" || detail?.type === "skill" ? {
                      entries: editorInstallStatus.entries,
                      error: editorInstallStatus.error,
                      isLoading: editorInstallStatus.isLoading,
                      onOpenInstallTarget: handleOpenInstallTarget,
                      onRefresh: editorInstallStatus.refresh,
                    } : null}
                    installTargetRequest={installTargetRequest}
                    isFavorite={isItemFavorite}
                    isRepositoryInitializing={Boolean(isRepositoryInitializing)}
                    isSyncing={isSyncing}
                    item={resolvedItem}
                    onDelete={() => {
                      logger.info("Delete confirm dialog opened.", { contentId: item.id, contentType })
                      setIsDeleteConfirmOpen(true)
                    }}
                    onEdit={() => {
                      logger.info("Edit dialog opened.", { contentId: item.id, contentType })
                      setIsEditOpen(true)
                    }}
                    onInstalled={handleInstallStatusRefresh}
                    onInstallTargetRequestConsumed={() => setInstallTargetRequest(null)}
                    onOpenInNewWindow={() => {
                      void handleOpenInNewWindow()
                    }}
                    onToggleFavorite={() => {
                      logger.info("Favorite toggle requested from detail dialog.", {
                        contentId: item.id,
                        contentType,
                        isFavorite: !isItemFavorite,
                      })
                      return toggleFavorite(contentType, item.id)
                    }}
                  />
                </div>
              </div>
            </div>
          </DialogHeader>

          <Separator className="mt-5" />

          <div className={cn(
            "flex min-h-0 flex-1 flex-col px-5 py-4 transition-opacity duration-200",
            contentReady ? "opacity-100" : "opacity-0",
          )}>
            {contentReady ? (
              <ContentDetailPanel
                detail={detail}
                displayedVersion={displayedVersion}
                emptyDescription={labels.emptyDescription}
                emptyTitle={labels.emptyTitle}
                errorTitle={labels.errorTitle}
                history={historyEntries}
                isLoading={isLoading}
                loadingTitle={labels.loadingTitle}
                onSelectedHistoryDirnameChange={handleHistorySelectionChange}
                onViewModeChange={handleViewModeChange}
                previewError={previewError}
                renderVersion={renderVersionView}
                selectedHistoryDirname={selectedHistoryDirname}
                viewMode={viewMode}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {detail && !isReadonly ? renderCreateDialog({
        editingId: item?.id ?? null,
        existingNames,
        initialValue: buildInitialValue(detail),
        mode: "edit",
        open: isEditOpen,
        onOpenChange: setIsEditOpen,
        onSubmit: (payload) => void handleSave(payload),
        submitDisabled: submitDisabledReason !== null,
        submitDisabledReason: submitDisabledReason,
      }) : null}
    </>
  )
}

export { ContentDetailDialog }

export type { ContentDetailDialogLabels, ContentDetailDialogProps }
