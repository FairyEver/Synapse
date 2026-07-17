import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react"
import { AlertTriangle, FileCode2, LoaderCircle } from "lucide-react"
import { openContentEditWindow, readAttachmentFile } from "@/app-shell/content"
import { useIdentity } from "@/app-shell/identity-context"
import { useAppNotifications } from "@/app-shell/notifications"
import { useRepositoryManager } from "@/app-shell/use-repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { MarkdownViewer } from "@/components/markdown-viewer"
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ContentDetailPanel } from "@/modules/content/components/content-detail-panel"
import {
  ContentDetailWindowMain,
  ContentDetailWindowShell,
  ContentDetailWindowSummary,
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileSidebar,
} from "@/modules/content/components/content-detail-window-layout"
import { useContentDetailState } from "@/modules/content/hooks/use-content-detail-state"
import { shouldBypassDeleteConfirm } from "@/lib/delete-confirm-bypass"
import {
  canManageContentDeletion,
  canUpdateContent,
} from "@/modules/content/lib/content-mutation"
import { PromptVersionView } from "@/modules/prompts/components/prompt-version-view"
import { RuleVersionView } from "@/modules/rules/components/rule-version-view"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type {
  SynapseContentDetail,
  SynapseContentFile,
  SynapseContentViewMode,
  SynapseContentWindowRequest,
} from "@/types/content"

type ContentDetailWindowPageProps = {
  request: Extract<SynapseContentWindowRequest, { kind: "detail" }>
}

type SkillAttachmentPreviewState = {
  errorMessage?: string
  file: SynapseContentFile | null
  path: string
  status: "idle" | "loading" | "ready" | "error"
}

type ContentWindowDeleteState = {
  deleteContent: (detail: SynapseContentDetail) => Promise<void>
  isDeleteConfirmOpen: boolean
  isDeleting: boolean
  setIsDeleteConfirmOpen: (open: boolean) => void
}

const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: "bash",
  cjs: "javascript",
  css: "css",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  mjs: "javascript",
  py: "python",
  sh: "shell",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "shell",
}

function useContentWindowDeleteState(
  contentType: SynapseContentWindowRequest["contentType"],
  logger: ReturnType<typeof createRendererLogger>,
): ContentWindowDeleteState {
  const manager = useRepositoryManager()
  const { promise } = useAppNotifications()
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  const deleteContent = useCallback(async (detail: SynapseContentDetail) => {
    setIsDeleting(true)

    await promise(
      async () => manager.deleteContent({
        id: detail.id,
        type: detail.type,
        baseHistoryDirname: detail.latestHistoryDirname,
      }),
      {
        loading: "正在删除...",
        success: (result) => {
          setIsDeleteConfirmOpen(false)

          if (result.status === "conflict") {
            logger.warn("Content detail window delete conflict detected.", {
              contentId: detail.id,
              contentType,
              latestHistoryDirname: result.latestHistoryDirname,
            })
            return {
              message: "内容已更新，请刷新后再删除。",
              tone: "warning",
            }
          }

          window.close()
          return result.pendingPushCount > 0 ? "已删除，等待同步。" : "删除成功。"
        },
        error: (error) => error instanceof Error ? error.message : "删除失败。",
      },
    ).catch((error) => {
      logger.error("Content detail window delete failed.", {
        contentId: detail.id,
        contentType,
        error,
      })
    }).finally(() => {
      setIsDeleting(false)
    })
  }, [contentType, logger, manager, promise])

  return {
    deleteContent,
    isDeleteConfirmOpen,
    isDeleting,
    setIsDeleteConfirmOpen,
  }
}

function canEditContentDetail(
  detail: SynapseContentDetail | null,
  currentUserId: string | null,
): boolean {
  return Boolean(detail && !detail.isReadonly && canUpdateContent(detail, currentUserId))
}

function useCurrentRepositoryUserId(): string | null {
  const { localIdentityState } = useIdentity()
  return localIdentityState?.status === "ready"
    ? localIdentityState.identity.userId
    : null
}

function requestContentDelete(
  event: MouseEvent<HTMLElement>,
  detail: SynapseContentDetail | null,
  state: ContentWindowDeleteState,
) {
  if (detail && shouldBypassDeleteConfirm(event)) {
    void state.deleteContent(detail)
    return
  }
  state.setIsDeleteConfirmOpen(true)
}

async function openEditFromDetailWindow(
  detail: SynapseContentDetail,
  logger: ReturnType<typeof createRendererLogger>,
  notifyWarning: (message: string) => void,
): Promise<void> {
  try {
    await openContentEditWindow({
      contentType: detail.type,
      id: detail.id,
      origin: "detail",
      title: `编辑 ${detail.title}`,
    })
    window.close()
  } catch (error) {
    logger.error("Failed to open content edit window.", {
      contentId: detail.id,
      contentType: detail.type,
      error,
    })
    notifyWarning(error instanceof Error ? error.message : "打开编辑窗口失败。")
  }
}

function ContentWindowDeleteDialog({
  description,
  detail,
  state,
  title,
}: {
  description: string
  detail: SynapseContentDetail | null
  state: ContentWindowDeleteState
  title: string
}) {
  return (
    <AlertDialog
      open={state.isDeleteConfirmOpen}
      onOpenChange={state.setIsDeleteConfirmOpen}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={state.isDeleting || !detail}
            onClick={() => {
              if (detail) {
                void state.deleteContent(detail)
              }
            }}
          >
            删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function getFileExtension(filePath: string): string {
  const fileName = filePath.split("/").at(-1) ?? filePath
  const dotIndex = fileName.lastIndexOf(".")

  return dotIndex === -1 ? "" : fileName.slice(dotIndex + 1).toLowerCase()
}

function isMarkdownFile(filePath: string): boolean {
  return ["markdown", "md", "mdx"].includes(getFileExtension(filePath))
}

function createCodeFence(content: string, language: string): string {
  const longestBacktickRun = Array.from(content.matchAll(/`+/g))
    .reduce((maxLength, match) => Math.max(maxLength, match[0].length), 0)
  const fence = "`".repeat(Math.max(3, longestBacktickRun + 1))
  const languageSuffix = language ? language : ""

  return `${fence}${languageSuffix}\n${content}\n${fence}`
}

function getCodeLanguage(filePath: string): string {
  const extension = getFileExtension(filePath)

  return CODE_LANGUAGE_BY_EXTENSION[extension] ?? ""
}

function resolveSkillAttachmentPreview(
  filePath: string,
  file: Extract<SynapseContentFile, { kind: "text" }>,
  mode: SynapseContentViewMode,
): {
  content: string
  mode: SynapseContentViewMode
} {
  if (isMarkdownFile(filePath) || mode === "source") {
    return {
      content: file.content,
      mode,
    }
  }

  return {
    content: createCodeFence(file.content, getCodeLanguage(filePath)),
    mode: "rendered",
  }
}

function SkillAttachmentPreview({
  mode,
  state,
}: {
  mode: SynapseContentViewMode
  state: SkillAttachmentPreviewState
}) {
  if (state.status === "loading") {
    return (
      <Empty className="min-h-80 rounded-none border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>正在读取文件</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (state.status === "error") {
    return (
      <Empty className="min-h-80 rounded-none border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertTriangle />
          </EmptyMedia>
          <EmptyTitle>无法预览文件</EmptyTitle>
          {state.errorMessage ? (
            <EmptyDescription>{state.errorMessage}</EmptyDescription>
          ) : null}
        </EmptyHeader>
      </Empty>
    )
  }

  if (!state.file) {
    return (
      <Empty className="min-h-80 rounded-none border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2 />
          </EmptyMedia>
          <EmptyTitle>无法预览文件</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (state.file.kind === "binary") {
    return (
      <Empty className="min-h-80 rounded-none border-0 bg-transparent">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileCode2 />
          </EmptyMedia>
          <EmptyTitle>此文件不能文本预览</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  const preview = resolveSkillAttachmentPreview(state.path, state.file, mode)

  return (
    <MarkdownViewer
      content={preview.content}
      mode={preview.mode}
      showTabs={false}
      surface="plain"
    />
  )
}

function RuleDetailWindowPage({
  request,
}: {
  request: Extract<SynapseContentWindowRequest, { kind: "detail" }>
}) {
  const logger = useMemo(() => createRendererLogger("rules.detail.window"), [])
  const currentUserId = useCurrentRepositoryUserId()
  const { warning: notifyWarning } = useAppNotifications()
  const deleteState = useContentWindowDeleteState("rule", logger)
  const detailState = useContentDetailState<"rule">({
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是规则。",
    item: {
      id: request.id,
      type: "rule",
    },
    loadDetailErrorMessage: "读取规则详情失败。",
    logCategory: "rules.detail.window",
    open: true,
  })

  const handleViewModeChange = useCallback((nextViewMode: "rendered" | "source") => {
    detailState.setViewMode((prevViewMode) => {
      if (prevViewMode !== nextViewMode) {
        logger.info("Content view mode changed in detail window.", {
          contentId: request.id,
          contentType: "rule",
          from: prevViewMode,
          to: nextViewMode,
        })
      }

      return nextViewMode
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  const handleEdit = useCallback(() => {
    if (detailState.detail && canEditContentDetail(detailState.detail, currentUserId)) {
      void openEditFromDetailWindow(detailState.detail, logger, notifyWarning)
    }
  }, [currentUserId, detailState.detail, logger, notifyWarning])

  return (
    <>
      <ContentDetailWindowShell
        summary={(
          <ContentDetailWindowSummary
            canDelete={Boolean(
              detailState.detail
              && canEditContentDetail(detailState.detail, currentUserId)
              && canManageContentDeletion(detailState.detail, currentUserId),
            )}
            canEdit={canEditContentDetail(detailState.detail, currentUserId)}
            detail={detailState.detail}
            onDelete={(event) => requestContentDelete(event, detailState.detail, deleteState)}
            onEdit={handleEdit}
          />
        )}
      >
        <ContentDetailWindowMain>
          <div className="flex h-full min-h-0 flex-col p-4">
            <ContentDetailPanel
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条规则"
              errorTitle="无法显示规则"
              isLoading={detailState.isLoading}
              loadingTitle="正在读取规则"
              onViewModeChange={handleViewModeChange}
              previewError={detailState.previewError}
              renderVersion={({ mode, version }) => (
                <RuleVersionView mode={mode} surface="plain" version={version} />
              )}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      <ContentWindowDeleteDialog
        description="删除后可在最近删除中恢复。"
        detail={detailState.detail}
        state={deleteState}
        title="删除规则"
      />

    </>
  )
}

function PromptDetailWindowPage({
  request,
}: {
  request: Extract<SynapseContentWindowRequest, { kind: "detail" }>
}) {
  const logger = useMemo(() => createRendererLogger("prompts.detail.window"), [])
  const currentUserId = useCurrentRepositoryUserId()
  const { warning: notifyWarning } = useAppNotifications()
  const deleteState = useContentWindowDeleteState("prompt", logger)
  const detailState = useContentDetailState<"prompt">({
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是提示词。",
    item: {
      id: request.id,
      type: "prompt",
    },
    loadDetailErrorMessage: "读取提示词详情失败。",
    logCategory: "prompts.detail.window",
    open: true,
  })

  const handleViewModeChange = useCallback((nextViewMode: "rendered" | "source") => {
    detailState.setViewMode((prevViewMode) => {
      if (prevViewMode !== nextViewMode) {
        logger.info("Content view mode changed in detail window.", {
          contentId: request.id,
          contentType: "prompt",
          from: prevViewMode,
          to: nextViewMode,
        })
      }

      return nextViewMode
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  const handleEdit = useCallback(() => {
    if (detailState.detail && canEditContentDetail(detailState.detail, currentUserId)) {
      void openEditFromDetailWindow(detailState.detail, logger, notifyWarning)
    }
  }, [currentUserId, detailState.detail, logger, notifyWarning])

  return (
    <>
      <ContentDetailWindowShell
        summary={(
          <ContentDetailWindowSummary
            canDelete={Boolean(
              detailState.detail
              && canEditContentDetail(detailState.detail, currentUserId)
              && canManageContentDeletion(detailState.detail, currentUserId),
            )}
            canEdit={canEditContentDetail(detailState.detail, currentUserId)}
            detail={detailState.detail}
            onDelete={(event) => requestContentDelete(event, detailState.detail, deleteState)}
            onEdit={handleEdit}
          />
        )}
      >
        <ContentDetailWindowMain>
          <div className="flex h-full min-h-0 flex-col p-4">
            <ContentDetailPanel
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条提示词"
              errorTitle="无法显示提示词"
              isLoading={detailState.isLoading}
              loadingTitle="正在读取提示词"
              onViewModeChange={handleViewModeChange}
              previewError={detailState.previewError}
              renderVersion={({ mode, version }) => (
                <PromptVersionView mode={mode} surface="plain" version={version} />
              )}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      <ContentWindowDeleteDialog
        description="删除后可在最近删除中恢复。"
        detail={detailState.detail}
        state={deleteState}
        title="删除提示词"
      />

    </>
  )
}

function SkillDetailWindowPage({
  request,
}: {
  request: Extract<SynapseContentWindowRequest, { kind: "detail" }>
}) {
  const logger = useMemo(() => createRendererLogger("skills.detail.window"), [])
  const currentUserId = useCurrentRepositoryUserId()
  const { warning: notifyWarning } = useAppNotifications()
  const deleteState = useContentWindowDeleteState("skill", logger)
  const [activeFilePath, setActiveFilePath] = useState(MAIN_SKILL_FILE_PATH)
  const [attachmentPreviewState, setAttachmentPreviewState] = useState<SkillAttachmentPreviewState>({
    file: null,
    path: MAIN_SKILL_FILE_PATH,
    status: "idle",
  })
  const detailState = useContentDetailState<"skill">({
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是 Skill。",
    item: {
      id: request.id,
      type: "skill",
    },
    loadDetailErrorMessage: "读取 Skill 详情失败。",
    logCategory: "skills.detail.window",
    open: true,
  })

  const handleViewModeChange = useCallback((nextViewMode: "rendered" | "source") => {
    detailState.setViewMode((prevViewMode) => {
      if (prevViewMode !== nextViewMode) {
        logger.info("Content view mode changed in detail window.", {
          contentId: request.id,
          contentType: "skill",
          from: prevViewMode,
          to: nextViewMode,
        })
      }

      return nextViewMode
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  const handleEdit = useCallback(() => {
    if (detailState.detail && canEditContentDetail(detailState.detail, currentUserId)) {
      void openEditFromDetailWindow(detailState.detail, logger, notifyWarning)
    }
  }, [currentUserId, detailState.detail, logger, notifyWarning])

  const skillAttachments = detailState.displayedVersion?.attachments ?? detailState.detail?.attachments ?? []
  const selectedAttachment = useMemo(() => {
    const normalizedActivePath = normalizeSkillTreePath(activeFilePath)

    return skillAttachments.find((attachment) => (
      normalizeSkillTreePath(attachment.originalName) === normalizedActivePath
    )) ?? null
  }, [activeFilePath, skillAttachments])

  useEffect(() => {
    if (
      activeFilePath === MAIN_SKILL_FILE_PATH
      || !detailState.displayedVersion
      || selectedAttachment
    ) {
      return
    }

    setActiveFilePath(MAIN_SKILL_FILE_PATH)
  }, [activeFilePath, detailState.displayedVersion, selectedAttachment])

  useEffect(() => {
    const displayedVersion = detailState.displayedVersion

    if (activeFilePath === MAIN_SKILL_FILE_PATH || !displayedVersion) {
      setAttachmentPreviewState({
        file: null,
        path: activeFilePath,
        status: "idle",
      })
      return
    }

    if (!selectedAttachment) {
      setAttachmentPreviewState({
        file: null,
        path: activeFilePath,
        status: "ready",
      })
      return
    }

    let cancelled = false

    setAttachmentPreviewState({
      file: null,
      path: activeFilePath,
      status: "loading",
    })

    void (async () => {
      try {
        const file = await readAttachmentFile({
          contentType: "skill",
          historyDirname: displayedVersion.historyDirname,
          id: request.id,
          originalName: selectedAttachment.originalName,
        })

        if (cancelled) {
          return
        }

        setAttachmentPreviewState({
          file,
          path: activeFilePath,
          status: "ready",
        })
      } catch (error) {
        logger.warn("Failed to load Skill attachment preview.", {
          contentId: request.id,
          error,
          filePath: activeFilePath,
          historyDirname: displayedVersion.historyDirname,
        })

        if (cancelled) {
          return
        }

        setAttachmentPreviewState({
          errorMessage: error instanceof Error ? error.message : undefined,
          file: null,
          path: activeFilePath,
          status: "error",
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [activeFilePath, detailState.displayedVersion, logger, request.id, selectedAttachment])

  return (
    <>
      <ContentDetailWindowShell
        summary={(
          <ContentDetailWindowSummary
            canDelete={Boolean(
              detailState.detail
              && canEditContentDetail(detailState.detail, currentUserId)
              && canManageContentDeletion(detailState.detail, currentUserId),
            )}
            canEdit={canEditContentDetail(detailState.detail, currentUserId)}
            detail={detailState.detail}
            onDelete={(event) => requestContentDelete(event, detailState.detail, deleteState)}
            onEdit={handleEdit}
          />
        )}
      >
        <ContentDetailWindowMain
          fileSidebar={(
            <SkillFileSidebar
              activePath={activeFilePath}
              attachments={skillAttachments}
              onSelectPath={setActiveFilePath}
            />
          )}
        >
          <div className="flex h-full min-h-0 flex-col p-4">
            <ContentDetailPanel
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条 Skill"
              errorTitle="无法显示 Skill"
              isLoading={detailState.isLoading}
              loadingTitle="正在读取 Skill"
              onViewModeChange={handleViewModeChange}
              previewError={detailState.previewError}
              renderVersion={({ mode, version }) => {
                if (activeFilePath === MAIN_SKILL_FILE_PATH) {
                  return <SkillVersionView mode={mode} surface="plain" version={version} />
                }

                return (
                  <SkillAttachmentPreview
                    mode={mode}
                    state={attachmentPreviewState.path === activeFilePath
                      ? attachmentPreviewState
                      : {
                          file: null,
                          path: activeFilePath,
                          status: "loading",
                        }}
                  />
                )
              }}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      <ContentWindowDeleteDialog
        description="删除后可在最近删除中恢复。"
        detail={detailState.detail}
        state={deleteState}
        title="删除 Skill"
      />

    </>
  )
}

function ContentDetailWindowPage({ request }: ContentDetailWindowPageProps) {
  if (request.contentType === "rule") {
    return <RuleDetailWindowPage request={request} />
  }

  if (request.contentType === "prompt") {
    return <PromptDetailWindowPage request={request} />
  }

  return <SkillDetailWindowPage request={request} />
}

export { ContentDetailWindowPage }
