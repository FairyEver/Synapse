import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, FileCode2, LoaderCircle } from "lucide-react"
import { readAttachmentFile } from "@/app-shell/content"
import { useAppNotifications } from "@/app-shell/notifications"
import { useContentList, useRepositoryManager } from "@/app-shell/use-repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { MarkdownViewer } from "@/components/markdown-viewer"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { ContentDetailPanel } from "@/modules/content/components/content-detail-panel"
import { invalidateIconImageCache } from "@/modules/content/components/content-item-icon"
import {
  ContentDetailWindowMain,
  ContentDetailWindowShell,
  ContentDetailWindowSummary,
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileSidebar,
} from "@/modules/content/components/content-detail-window-layout"
import { useContentDetailState } from "@/modules/content/hooks/use-content-detail-state"
import { buildBaseContentInitialValue } from "@/modules/content/lib/content-payload"
import { PromptCreateDialog } from "@/modules/prompts/components/prompt-create-dialog"
import { PromptVersionView } from "@/modules/prompts/components/prompt-version-view"
import { RuleCreateDialog } from "@/modules/rules/components/rule-create-dialog"
import { RuleVersionView } from "@/modules/rules/components/rule-version-view"
import { SkillCreateDialog } from "@/modules/skills/components/skill-create-dialog"
import { SkillVersionView } from "@/modules/skills/components/skill-version-view"
import type { CreateSkillPayload } from "@/modules/skills/types"
import { serializeCreateSkillFiles } from "@/modules/skills/utils"
import type {
  SynapseContentDetail,
  SynapseContentFile,
  SynapseContentViewMode,
  SynapseContentWindowRequest,
  SynapseCreatePromptPayload,
  SynapseCreateRulePayload,
  SynapseUpdateContentPayload,
} from "@/types/content"

type ContentDetailWindowPageProps = {
  request: SynapseContentWindowRequest
}

type SkillAttachmentPreviewState = {
  errorMessage?: string
  file: SynapseContentFile | null
  path: string
  status: "idle" | "loading" | "ready" | "error"
}

type ContentWindowEditState<TPayload> = {
  existingNames: string[]
  isEditOpen: boolean
  isSaving: boolean
  refreshSignal: number
  setIsEditOpen: (open: boolean) => void
  save: (
    detail: SynapseContentDetail,
    payload: TPayload,
    serializePayload?: (payload: TPayload) => Promise<TPayload> | TPayload,
  ) => Promise<void>
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

function useContentWindowEditState<TPayload>(
  contentType: SynapseContentWindowRequest["contentType"],
  contentId: string,
  logger: ReturnType<typeof createRendererLogger>,
): ContentWindowEditState<TPayload> {
  const manager = useRepositoryManager()
  const { items } = useContentList(contentType)
  const { promise } = useAppNotifications()
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)
  const existingNames = useMemo(
    () => items
      .filter((item) => item.source !== "builtin" && item.name && item.id !== contentId)
      .map((item) => item.name!),
    [contentId, items],
  )

  const save = useCallback(async (
    detail: SynapseContentDetail,
    payload: TPayload,
    serializePayload?: (payload: TPayload) => Promise<TPayload> | TPayload,
  ) => {
    setIsSaving(true)

    let serializedPayload: TPayload
    try {
      serializedPayload = serializePayload ? await serializePayload(payload) : payload
    } catch (error) {
      setIsSaving(false)
      logger.error("Content detail window edit payload serialization failed.", {
        contentId: detail.id,
        contentType,
        error,
      })
      return
    }

    await promise(
      async () => {
        const updatePayload = {
          ...serializedPayload as SynapseUpdateContentPayload<typeof contentType>,
          id: detail.id,
          baseHistoryDirname: detail.latestHistoryDirname,
        }
        const result = await manager.updateContent(contentType, updatePayload)

        if (result.status === "saved") {
          invalidateIconImageCache(contentType, detail.id)
          setRefreshSignal((current) => current + 1)
        }

        return result
      },
      {
        loading: "正在保存...",
        success: (result) => {
          if (result.status === "conflict") {
            return "内容已更新，请刷新后再编辑。"
          }

          setIsEditOpen(false)
          return result.pendingPushCount > 0 ? "已保存，等待同步。" : "保存成功。"
        },
        error: (error) => error instanceof Error ? error.message : "保存失败。",
      },
    ).catch((error) => {
      logger.error("Content detail window edit save failed.", {
        contentId: detail.id,
        contentType,
        error,
      })
    }).finally(() => {
      setIsSaving(false)
    })
  }, [contentType, logger, manager, promise])

  return {
    existingNames,
    isEditOpen,
    isSaving,
    refreshSignal,
    save,
    setIsEditOpen,
  }
}

function canEditContentDetail(detail: SynapseContentDetail | null): boolean {
  return Boolean(detail && !detail.isReadonly && detail.source !== "builtin")
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
  request: SynapseContentWindowRequest
}) {
  const logger = useMemo(() => createRendererLogger("rules.detail.window"), [])
  const editState = useContentWindowEditState<SynapseCreateRulePayload>("rule", request.id, logger)
  const detailState = useContentDetailState<"rule">({
    initialHistoryDirname: request.historyDirname ?? null,
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是规则。",
    item: {
      id: request.id,
      type: "rule",
    },
    loadDetailErrorMessage: "读取规则详情失败。",
    loadHistoryErrorMessage: "读取规则历史失败。",
    logCategory: "rules.detail.window",
    open: true,
    refreshSignal: editState.refreshSignal,
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

  const handleHistorySelectionChange = useCallback((nextHistoryDirname: string) => {
    detailState.setSelectedHistoryDirname((prevHistoryDirname) => {
      if (prevHistoryDirname !== nextHistoryDirname) {
        logger.info("Content history version changed in detail window.", {
          contentId: request.id,
          contentType: "rule",
          from: prevHistoryDirname ?? "current",
          to: nextHistoryDirname,
        })
      }

      return nextHistoryDirname
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  return (
    <>
      <ContentDetailWindowShell
        summary={(
          <ContentDetailWindowSummary
            canEdit={canEditContentDetail(detailState.detail)}
            detail={detailState.detail}
            onEdit={() => editState.setIsEditOpen(true)}
          />
        )}
      >
        <ContentDetailWindowMain>
          <div className="flex h-full min-h-0 flex-col p-4">
            <ContentDetailPanel
              detail={detailState.detail}
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条规则"
              errorTitle="无法显示规则"
              history={detailState.historyEntries}
              isLoading={detailState.isLoading}
              loadingTitle="正在读取规则"
              onSelectedHistoryDirnameChange={handleHistorySelectionChange}
              onViewModeChange={handleViewModeChange}
              previewError={detailState.previewError}
              renderVersion={({ mode, version }) => (
                <RuleVersionView mode={mode} surface="plain" version={version} />
              )}
              selectedHistoryDirname={detailState.selectedHistoryDirname}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      {detailState.detail && canEditContentDetail(detailState.detail) ? (
        <RuleCreateDialog
          editingId={request.id}
          existingNames={editState.existingNames}
          initialValue={{
            ...buildBaseContentInitialValue(detailState.detail),
            name: detailState.detail.name ?? "",
          } as SynapseCreateRulePayload}
          mode="edit"
          open={editState.isEditOpen}
          onOpenChange={editState.setIsEditOpen}
          onSubmit={(payload) => editState.save(detailState.detail!, payload)}
          submitDisabled={editState.isSaving}
          submitDisabledReason={editState.isSaving ? "正在保存..." : null}
        />
      ) : null}
    </>
  )
}

function PromptDetailWindowPage({
  request,
}: {
  request: SynapseContentWindowRequest
}) {
  const logger = useMemo(() => createRendererLogger("prompts.detail.window"), [])
  const editState = useContentWindowEditState<SynapseCreatePromptPayload>("prompt", request.id, logger)
  const detailState = useContentDetailState<"prompt">({
    initialHistoryDirname: request.historyDirname ?? null,
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是提示词。",
    item: {
      id: request.id,
      type: "prompt",
    },
    loadDetailErrorMessage: "读取提示词详情失败。",
    loadHistoryErrorMessage: "读取提示词历史失败。",
    logCategory: "prompts.detail.window",
    open: true,
    refreshSignal: editState.refreshSignal,
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

  const handleHistorySelectionChange = useCallback((nextHistoryDirname: string) => {
    detailState.setSelectedHistoryDirname((prevHistoryDirname) => {
      if (prevHistoryDirname !== nextHistoryDirname) {
        logger.info("Content history version changed in detail window.", {
          contentId: request.id,
          contentType: "prompt",
          from: prevHistoryDirname ?? "current",
          to: nextHistoryDirname,
        })
      }

      return nextHistoryDirname
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

  return (
    <>
      <ContentDetailWindowShell
        summary={(
          <ContentDetailWindowSummary
            canEdit={canEditContentDetail(detailState.detail)}
            detail={detailState.detail}
            onEdit={() => editState.setIsEditOpen(true)}
          />
        )}
      >
        <ContentDetailWindowMain>
          <div className="flex h-full min-h-0 flex-col p-4">
            <ContentDetailPanel
              detail={detailState.detail}
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条提示词"
              errorTitle="无法显示提示词"
              history={detailState.historyEntries}
              isLoading={detailState.isLoading}
              loadingTitle="正在读取提示词"
              onSelectedHistoryDirnameChange={handleHistorySelectionChange}
              onViewModeChange={handleViewModeChange}
              previewError={detailState.previewError}
              renderVersion={({ mode, version }) => (
                <PromptVersionView mode={mode} surface="plain" version={version} />
              )}
              selectedHistoryDirname={detailState.selectedHistoryDirname}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      {detailState.detail && canEditContentDetail(detailState.detail) ? (
        <PromptCreateDialog
          editingId={request.id}
          existingNames={editState.existingNames}
          initialValue={buildBaseContentInitialValue(detailState.detail) as SynapseCreatePromptPayload}
          mode="edit"
          open={editState.isEditOpen}
          onOpenChange={editState.setIsEditOpen}
          onSubmit={(payload) => editState.save(detailState.detail!, payload)}
          submitDisabled={editState.isSaving}
          submitDisabledReason={editState.isSaving ? "正在保存..." : null}
        />
      ) : null}
    </>
  )
}

function SkillDetailWindowPage({
  request,
}: {
  request: SynapseContentWindowRequest
}) {
  const logger = useMemo(() => createRendererLogger("skills.detail.window"), [])
  const editState = useContentWindowEditState<CreateSkillPayload>("skill", request.id, logger)
  const [activeFilePath, setActiveFilePath] = useState(MAIN_SKILL_FILE_PATH)
  const [attachmentPreviewState, setAttachmentPreviewState] = useState<SkillAttachmentPreviewState>({
    file: null,
    path: MAIN_SKILL_FILE_PATH,
    status: "idle",
  })
  const detailState = useContentDetailState<"skill">({
    initialHistoryDirname: request.historyDirname ?? null,
    initialViewMode: request.viewMode,
    invalidTypeMessage: "读取到的内容不是 Skill。",
    item: {
      id: request.id,
      type: "skill",
    },
    loadDetailErrorMessage: "读取 Skill 详情失败。",
    loadHistoryErrorMessage: "读取 Skill 历史失败。",
    logCategory: "skills.detail.window",
    open: true,
    refreshSignal: editState.refreshSignal,
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

  const handleHistorySelectionChange = useCallback((nextHistoryDirname: string) => {
    detailState.setSelectedHistoryDirname((prevHistoryDirname) => {
      if (prevHistoryDirname !== nextHistoryDirname) {
        logger.info("Content history version changed in detail window.", {
          contentId: request.id,
          contentType: "skill",
          from: prevHistoryDirname ?? "current",
          to: nextHistoryDirname,
        })
      }

      return nextHistoryDirname
    })
  }, [detailState, logger, request.id])

  useEffect(() => {
    if (detailState.detail) {
      document.title = detailState.detail.title
    }
  }, [detailState.detail])

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
            canEdit={canEditContentDetail(detailState.detail)}
            detail={detailState.detail}
            onEdit={() => editState.setIsEditOpen(true)}
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
              detail={detailState.detail}
              displayedVersion={detailState.displayedVersion}
              emptyDescription="它可能已经被删除。"
              emptyTitle="找不到这条 Skill"
              errorTitle="无法显示 Skill"
              history={detailState.historyEntries}
              isLoading={detailState.isLoading}
              loadingTitle="正在读取 Skill"
              onSelectedHistoryDirnameChange={handleHistorySelectionChange}
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
              selectedHistoryDirname={detailState.selectedHistoryDirname}
              stateContainerClassName="min-h-full rounded-none border-0 bg-transparent p-0"
              viewMode={detailState.viewMode}
            />
          </div>
        </ContentDetailWindowMain>
      </ContentDetailWindowShell>

      {detailState.detail && canEditContentDetail(detailState.detail) ? (
        <SkillCreateDialog
          editingId={request.id}
          existingNames={editState.existingNames}
          initialValue={{
            title: detailState.detail.title,
            name: detailState.detail.name ?? "",
            usage: detailState.detail.usage ?? "",
            description: detailState.detail.description,
            category: detailState.detail.category,
            icon: detailState.detail.icon,
            iconBg: detailState.detail.iconBg,
            iconType: detailState.detail.iconType || "icon",
            iconImage: detailState.detail.iconImage || "",
            content: detailState.detail.content,
            files: detailState.detail.attachments.map((attachment) => ({
              originalName: attachment.originalName,
              sha256: attachment.sha256,
              size: attachment.size,
            })),
          }}
          mode="edit"
          open={editState.isEditOpen}
          onOpenChange={editState.setIsEditOpen}
          onSubmit={(payload) => {
            void editState.save(detailState.detail!, payload, async (nextPayload) => ({
              ...nextPayload,
              files: await serializeCreateSkillFiles(nextPayload.files),
            }) as CreateSkillPayload)
          }}
          submitDisabled={editState.isSaving}
          submitDisabledReason={editState.isSaving ? "正在保存..." : null}
        />
      ) : null}
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
