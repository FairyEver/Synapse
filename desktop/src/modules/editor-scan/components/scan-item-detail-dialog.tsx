import { useCallback, useEffect, useState } from "react"
import { AlertCircle, File, FolderOpen, LoaderCircle, MoreHorizontal } from "lucide-react"
import { getEditorAdapters, readDetail } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import {
  createContentOpenRequestId,
  requestOpenContentCreate,
  requestOpenContentDetail,
  requestOpenContentEditOverwrite,
} from "@/app-shell/content-navigation"
import { closeDialogThenNavigate } from "@/app-shell/dialog-navigate"
import { useCurrentRepoProfile } from "@/app-shell/identity-context"
import { formatSkillAttachmentSize } from "@/modules/skills/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
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
  DialogFrame,
  DialogFrameBody,
  DialogFrameFooter,
  DialogFrameHeader,
} from "@/components/ui/dialog"
import { Menubar } from "@/components/ui/menubar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { EditorWriteTargetInitialSelection } from "@/modules/content/components/editor-write-target-selector"
import { SharedInstallerFlow } from "@/modules/installers/shared/shared-installer-flow"
import type { SynapseEditorAdapterSummary } from "@/types/editor"
import type {
  EditorScanQuickPublishDraft,
  EditorScanSkillFileEntry,
  ScanItemForDetail,
} from "@/types/editor-scan"
import type { SynapseInstallerSource } from "@/types/installers"
import { useScanItemContent, useSkillFiles } from "../hooks/use-scan-item-content"
import {
  buildRuleQuickPublishPayload,
  buildSkillQuickPublishPayload,
  formatQuickPublishSourceLabel,
} from "../lib/quick-publish"
import {
  buildUploadSkillToSkillRepositoryErrorMessage,
  buildUploadSkillToSkillRepositoryRequest,
  buildUploadSkillToSkillRepositorySuccessMessage,
  getUploadSkillToSkillRepositoryDisabledReason,
} from "../lib/skill-repository-upload"
import { EditorCopyDialog } from "./editor-copy-dialog"

const logger = createRendererLogger("editor-scan")

/** Extract the last path component for safe logging (never logs the full absolute path). */
function logSafeItemPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/")
  return normalized.split("/").pop() ?? filePath
}

type AttachmentDiff = { added: number; changed: number; removed: number }

async function buildAttachmentDiff(
  draft: Extract<EditorScanQuickPublishDraft, { itemType: "skill" }>,
  existing: { originalName: string; sha256: string }[],
): Promise<AttachmentDiff> {
  const existingByName = new Map(existing.map((file) => [file.originalName, file.sha256]))
  const draftNames = new Set(draft.files.map((file) => file.originalName))
  let added = 0
  let changed = 0

  for (const file of draft.files) {
    const existingHash = existingByName.get(file.originalName)
    if (!existingHash) {
      added += 1
      continue
    }
    const digest = await globalThis.crypto.subtle.digest("SHA-256", Uint8Array.from(file.bytes))
    const hash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("")
    if (hash !== existingHash) changed += 1
  }

  return {
    added,
    changed,
    removed: existing.filter((file) => !draftNames.has(file.originalName)).length,
  }
}

type ScanItemDetailDialogProps = {
  item: ScanItemForDetail | null
  onChanged?: () => Promise<void> | void
  onRequestSkillUninstall?: (item: ScanItemForDetail) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function ScanItemDetailDialog({
  item,
  onChanged,
  onRequestSkillUninstall,
  open,
  onOpenChange,
}: ScanItemDetailDialogProps) {
  const { content: loadedContent, loading, error } = useScanItemContent(
    open && item?.content == null ? item?.path ?? null : null,
  )
  const {
    files: skillFiles,
    loading: skillFilesLoading,
    error: skillFilesError,
  } = useSkillFiles(
    open && item?.type === "skill" ? item.path : null,
  )
  const activeRepository = useActiveRepository()
  const { currentRepoProfileState } = useCurrentRepoProfile()
  const { success, error: notifyError, warning } = useAppNotifications()
  const { config } = useAppConfig()
  const [viewMode, setViewMode] = useState<"rendered" | "source">("rendered")
  const [contentReady, setContentReady] = useState(false)
  const [quickPublishError, setQuickPublishError] = useState<string | null>(null)
  const [isQuickPublishBusy, setIsQuickPublishBusy] = useState(false)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [isEditorCopyOpen, setIsEditorCopyOpen] = useState(false)
  const [trashError, setTrashError] = useState<string | null>(null)
  const [isTrashConfirmOpen, setIsTrashConfirmOpen] = useState(false)
  const [isTrashBusy, setIsTrashBusy] = useState(false)
  const [reinstallSource, setReinstallSource] = useState<SynapseInstallerSource | null>(null)
  const [reinstallEditor, setReinstallEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [reinstallSelection, setReinstallSelection] = useState<EditorWriteTargetInitialSelection | null>(null)
  const [isReinstallOpen, setIsReinstallOpen] = useState(false)
  const [isReinstallBusy, setIsReinstallBusy] = useState(false)
  const [isPublishChoiceOpen, setIsPublishChoiceOpen] = useState(false)
  const [quickPublishDraft, setQuickPublishDraft] = useState<EditorScanQuickPublishDraft | null>(null)
  const [overwriteDiff, setOverwriteDiff] = useState<AttachmentDiff | null>(null)
  const [overwriteUnavailableReason, setOverwriteUnavailableReason] = useState<string | null>(null)
  const [isOverwriteBusy, setIsOverwriteBusy] = useState(false)
  const [isSkillRepositoryUploadBusy, setIsSkillRepositoryUploadBusy] = useState(false)
  const [isSkillRepositoryUploadConfirmOpen, setIsSkillRepositoryUploadConfirmOpen] = useState(false)
  const [skillRepositoryPublishDraft, setSkillRepositoryPublishDraft] = useState<Extract<EditorScanQuickPublishDraft, { itemType: "skill" }> | null>(null)
  const [skillRepositoryManagementUrl, setSkillRepositoryManagementUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setViewMode("rendered")
      setContentReady(false)
      setQuickPublishError(null)
      setFallbackReason(null)
      setIsEditorCopyOpen(false)
      setTrashError(null)
      setIsTrashConfirmOpen(false)
      setIsTrashBusy(false)
      setIsReinstallBusy(false)
      setIsPublishChoiceOpen(false)
      setQuickPublishDraft(null)
      setOverwriteDiff(null)
      setOverwriteUnavailableReason(null)
      setIsOverwriteBusy(false)
      setIsSkillRepositoryUploadBusy(false)
      setIsSkillRepositoryUploadConfirmOpen(false)
      setSkillRepositoryPublishDraft(null)
      setSkillRepositoryManagementUrl(null)
      return
    }
    const timer = setTimeout(() => setContentReady(true), 200)
    return () => clearTimeout(timer)
  }, [open])

  const handleCopy = useCallback(async () => {
    const content = item?.content ?? loadedContent
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      success("已复制到剪贴板。")
      logger.info("Scan item content copied.", { pathBasename: item?.path ? logSafeItemPath(item.path) : undefined })
    } catch {
      notifyError("复制失败。")
    }
  }, [item?.content, loadedContent, item?.path, success, notifyError])

  const handleOpenInFinder = useCallback(() => {
    if (!item) return
    const bridge = getSynapseBridge()
    if (!bridge) {
      notifyError("无法在访达中打开文件。")
      return
    }

    void bridge.shell.showItemInFolder(item.path).catch(() => {
      notifyError("无法在访达中打开文件。")
    })
  }, [item, notifyError])

  const trashDisabledReason = item?.trash.mode === "unsupported"
    ? item.trash.disabledReason
    : null

  const handleTrashConfirm = useCallback(async () => {
    if (!item || item.type !== "rule" || trashDisabledReason) return
    setIsTrashBusy(true)
    setTrashError(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("当前窗口无法处理本机内容。")
      }

      await bridge.editorScan.trashItem({
        itemType: item.type,
        itemName: item.name,
        itemPath: item.path,
        editorId: item.editorId,
        scope: item.scope,
        source: item.source,
        trash: item.trash,
        synapseContentId: item.synapseContentId ?? null,
      })

      success("已移到废纸篓")
      logger.info("Scan item moved to trash.", {
        editorId: item.editorId,
        itemType: item.type,
        pathBasename: logSafeItemPath(item.path),
        scope: item.scope,
        trashMode: item.trash.mode,
      })
      setIsTrashConfirmOpen(false)
      onOpenChange(false)

      try {
        await onChanged?.()
      } catch (refreshError) {
        logger.warn("Scan list refresh failed after trash.", {
          pathBasename: logSafeItemPath(item.path),
          error: refreshError,
        })
        warning("已移到废纸篓，刷新失败")
      }
    } catch (error) {
      logger.error("Scan item trash failed.", { pathBasename: logSafeItemPath(item.path), error })
      setTrashError(error instanceof Error ? error.message : "移到废纸篓失败。")
    } finally {
      setIsTrashBusy(false)
    }
  }, [item, onChanged, onOpenChange, success, trashDisabledReason, warning])

  const disabledReason =
    !activeRepository
      ? "先选择本地目录"
      : currentRepoProfileState?.status === "needs-onboarding"
        ? "先完成当前目录的身份设置"
        : !item?.path
          ? "本地路径为空"
          : null

  const publishAsNew = useCallback(async () => {
    if (!item || disabledReason) return
    setIsQuickPublishBusy(true)
    setQuickPublishError(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("当前窗口无法读取本地内容。")
      }

      const draft = quickPublishDraft ?? await bridge.editorScan.prepareQuickPublishDraft({
        itemType: item.type,
        itemPath: item.path,
        itemName: item.name,
        ruleContent: item.type === "rule" ? item.content : undefined,
        metadata: item.metadata,
        purpose: "publish",
        synapseContentId: item.synapseContentId ?? undefined,
      })
      const sourceLabel = formatQuickPublishSourceLabel(item)

      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => {
          if (draft.itemType === "rule") {
            const result = buildRuleQuickPublishPayload(draft)
            requestOpenContentCreate({
              kind: "create",
              requestId: createContentOpenRequestId(),
              contentType: "rule",
              initialValue: result.payload,
              notices: result.notices,
              sourceLabel,
            })
          } else {
            const result = buildSkillQuickPublishPayload(draft)
            requestOpenContentCreate({
              kind: "create",
              requestId: createContentOpenRequestId(),
              contentType: "skill",
              initialValue: result.payload,
              notices: result.notices,
              quickPublishSessionId: draft.publishSessionId,
              sourceLabel,
            })
          }
        },
      )
    } catch (error) {
      logger.error("Quick publish draft preparation failed.", { pathBasename: logSafeItemPath(item.path), error })
      setQuickPublishError(error instanceof Error ? error.message : "读取本地内容失败。")
    } finally {
      setIsQuickPublishBusy(false)
    }
  }, [disabledReason, item, onOpenChange, quickPublishDraft])

  const preparePublishChoice = useCallback(async () => {
    if (!item || disabledReason) return
    setIsQuickPublishBusy(true)
    setQuickPublishError(null)
    setOverwriteDiff(null)
    setOverwriteUnavailableReason(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) throw new Error("当前窗口无法读取本地内容。")
      const draft = await bridge.editorScan.prepareQuickPublishDraft({
        itemType: item.type,
        itemPath: item.path,
        itemName: item.name,
        ruleContent: item.type === "rule" ? item.content : undefined,
        metadata: item.metadata,
        purpose: "publish",
        synapseContentId: item.synapseContentId ?? undefined,
      })
      setQuickPublishDraft(draft)

      if (item.synapseContentId) {
        try {
          const detail = await readDetail(item.type, item.synapseContentId)
          if (detail.deleted) {
            setOverwriteUnavailableReason("关联内容已删除，只能发布为新内容。")
          } else if (draft.itemType === "skill" && detail.type === "skill") {
            setOverwriteDiff(await buildAttachmentDiff(draft, detail.attachments))
          }
        } catch {
          setOverwriteUnavailableReason("关联内容不在当前仓库，只能发布为新内容。")
        }
      } else {
        setOverwriteUnavailableReason("当前本地内容未关联仓库，只能发布为新内容。")
      }
      setIsPublishChoiceOpen(true)
    } catch (error) {
      setQuickPublishError(error instanceof Error ? error.message : "发布前检查失败。")
    } finally {
      setIsQuickPublishBusy(false)
    }
  }, [disabledReason, item])

  const handlePrimaryAction = useCallback(async () => {
    if (!item || disabledReason) return

    if (!item.synapseContentId) {
      await preparePublishChoice()
      return
    }

    setIsQuickPublishBusy(true)
    setQuickPublishError(null)
    try {
      const detail = await readDetail(item.type, item.synapseContentId)
      if (detail.deleted) {
        setFallbackReason("仓库内容已删除。")
        return
      }

      const { type: contentType, synapseContentId } = item
      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => requestOpenContentDetail({
          kind: "detail",
          requestId: createContentOpenRequestId(),
          contentType,
          contentId: synapseContentId,
        }),
      )
    } catch (error) {
      logger.warn("Linked repository content is unavailable.", {
        contentId: item.synapseContentId,
        contentType: item.type,
        error,
      })
      setFallbackReason("仓库内容不可用。")
    } finally {
      setIsQuickPublishBusy(false)
    }
  }, [disabledReason, item, onOpenChange, preparePublishChoice])

  const handleReinstall = useCallback(async () => {
    if (!item?.synapseContentId || disabledReason) return
    setIsReinstallBusy(true)
    try {
      const [detail, adapters] = await Promise.all([
        readDetail(item.type, item.synapseContentId),
        getEditorAdapters(),
      ])

      if (detail.deleted) {
        setFallbackReason("仓库内容已删除。")
        return
      }

      const adapter = adapters.find((candidate) => candidate.id === item.editorId)
      if (!adapter) {
        notifyError("当前编辑器没有可用的安装适配器。")
        return
      }

      const nextSource: SynapseInstallerSource = detail.type === "skill"
        ? {
            kind: "skill",
            origin: "repository",
            repositoryContentId: detail.id,
            sourceIdentity: detail.id,
            name: detail.name ?? item.name,
            title: detail.title,
            description: detail.description,
          }
        : {
            kind: "rule",
            origin: "repository",
            repositoryContentId: detail.id,
            sourceIdentity: detail.id,
            name: detail.name ?? item.name,
            title: detail.title,
            description: detail.description,
          }
      setReinstallSource(nextSource)
      setReinstallEditor(adapter)
      setReinstallSelection({
        scope: item.scope,
        projectPath: item.scope === "project" ? item.projectPath : undefined,
      })
      setIsReinstallOpen(true)
    } catch (error) {
      logger.warn("Reinstall preparation failed.", {
        contentId: item.synapseContentId,
        contentType: item.type,
        editorId: item.editorId,
        error,
      })
      setFallbackReason("仓库内容不可用。")
    } finally {
      setIsReinstallBusy(false)
    }
  }, [disabledReason, item, notifyError])

  const handleReinstallOpenChange = useCallback((nextOpen: boolean) => {
    setIsReinstallOpen(nextOpen)
    if (!nextOpen) {
      setReinstallSource(null)
      setReinstallEditor(null)
      setReinstallSelection(null)
    }
  }, [])

  const handlePublishOverwrite = useCallback(async () => {
    if (!item || !item.synapseContentId || disabledReason) return
    setIsOverwriteBusy(true)
    setQuickPublishError(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("当前窗口无法读取本地内容。")
      }

      if (overwriteUnavailableReason) return
      const draft = quickPublishDraft
      if (!draft) throw new Error("发布快照已失效，请重新打开发布操作。")

      const sourceLabel = formatQuickPublishSourceLabel(item)
      const requestId = createContentOpenRequestId()

      setIsPublishChoiceOpen(false)
      closeDialogThenNavigate(
        () => onOpenChange(false),
        () => {
          if (draft.itemType === "rule") {
            const normalized = buildRuleQuickPublishPayload(draft)
            requestOpenContentEditOverwrite({
              kind: "edit-overwrite",
              requestId,
              contentType: "rule",
              contentId: item.synapseContentId!,
              prefill: { contentType: "rule", content: normalized.payload.content },
              sourceLabel,
            })
          } else {
            const normalized = buildSkillQuickPublishPayload(draft)
            requestOpenContentEditOverwrite({
              kind: "edit-overwrite",
              requestId,
              contentType: "skill",
              contentId: item.synapseContentId!,
              prefill: {
                contentType: "skill",
                content: normalized.payload.content,
                files: draft.files.map((file) => ({
                  originalName: file.originalName,
                  size: file.size,
                  bytes: file.bytes,
                })),
              },
              quickPublishSessionId: draft.publishSessionId,
              sourceLabel,
            })
          }
          logger.info("Publish-to-repo overwrite dispatched.", {
            contentId: item.synapseContentId,
            contentType: item.type,
            editorId: item.editorId,
            requestId,
            scope: item.scope,
          })
        },
      )
    } catch (error) {
      logger.warn("Publish-to-repo overwrite failed.", {
        contentId: item.synapseContentId,
        contentType: item.type,
        editorId: item.editorId,
        error,
      })
      setQuickPublishError(
        error instanceof Error ? error.message : "读取本地内容失败。",
      )
    } finally {
      setIsOverwriteBusy(false)
    }
  }, [disabledReason, item, onOpenChange, overwriteUnavailableReason, quickPublishDraft])

  const handlePublishAsNewFromChoice = useCallback(async () => {
    if (!item) return
    logger.info("Publish-to-repo publish-as-new chosen.", {
      contentId: item.synapseContentId,
      contentType: item.type,
      editorId: item.editorId,
      scope: item.scope,
    })
    setIsPublishChoiceOpen(false)
    await publishAsNew()
  }, [item, publishAsNew])

  const prepareSkillRepositoryUpload = useCallback(async () => {
    if (!item) return
    const disabled = getUploadSkillToSkillRepositoryDisabledReason(item)
    if (disabled) return
    setIsSkillRepositoryUploadBusy(true)
    setQuickPublishError(null)
    try {
      const bridge = getSynapseBridge()
      if (!bridge) throw new Error("当前窗口无法读取本地内容。")
      const draft = await bridge.editorScan.prepareQuickPublishDraft({
        itemType: "skill",
        itemPath: item.path,
        itemName: item.name,
        metadata: item.metadata,
        purpose: "publish",
        synapseContentId: item.synapseContentId ?? undefined,
      })
      if (draft.itemType !== "skill") throw new Error("读取 Skill 发布内容失败。")
      setSkillRepositoryPublishDraft(draft)
      setIsSkillRepositoryUploadConfirmOpen(true)
    } catch (error) {
      setQuickPublishError(buildUploadSkillToSkillRepositoryErrorMessage(error))
    } finally {
      setIsSkillRepositoryUploadBusy(false)
    }
  }, [item])

  const handleUploadSkillToSkillRepository = useCallback(async () => {
    if (!item) return
    const disabled = getUploadSkillToSkillRepositoryDisabledReason(item)
    if (disabled) return
    setIsSkillRepositoryUploadBusy(true)
    setQuickPublishError(null)

    try {
      const bridge = getSynapseBridge()
      if (!bridge) {
        throw new Error("当前窗口无法读取本地内容。")
      }

      const result = await bridge.editorScan.uploadSkillToSkillRepository(
        {
          ...buildUploadSkillToSkillRepositoryRequest(item),
          expectedSourceFingerprint: skillRepositoryPublishDraft?.sourceFingerprint,
        },
      )
      setIsSkillRepositoryUploadConfirmOpen(false)
      success(buildUploadSkillToSkillRepositorySuccessMessage())
      if (!result.identityWritten) {
        warning("云仓库已上传，但本地云仓库关联写入失败。")
      } else if (result.identityMigrationWarning) {
        warning("云仓库已上传，旧身份文件清理失败，不影响本次上传。")
      }
      logger.info("Skill Repository upload completed from scan detail.", {
        editorId: item.editorId,
        itemType: item.type,
        pathBasename: logSafeItemPath(item.path),
        scope: item.scope,
      })

      try {
        await bridge.shell.openExternal(result.managementUrl)
      } catch (openError) {
        logger.warn("Skill Repository management URL open failed.", {
          editorId: item.editorId,
          error: openError,
          itemType: item.type,
          pathBasename: logSafeItemPath(item.path),
          scope: item.scope,
        })
        setSkillRepositoryManagementUrl(result.managementUrl)
        notifyError("无法打开 Synapse。")
      }
    } catch (error) {
      logger.warn("Skill Repository upload from scan detail failed.", {
        editorId: item.editorId,
        error,
        itemType: item.type,
        pathBasename: logSafeItemPath(item.path),
        scope: item.scope,
      })
      setQuickPublishError(buildUploadSkillToSkillRepositoryErrorMessage(error))
    } finally {
      setIsSkillRepositoryUploadBusy(false)
    }
  }, [item, notifyError, skillRepositoryPublishDraft?.sourceFingerprint, success, warning])

  if (!item) return null

  const canReinstall = item.source === "synapse" && Boolean(item.synapseContentId)
  const canPublishToRepo = item.source === "synapse" && Boolean(item.synapseContentId)
  const uploadSkillToRepositoryDisabledReason = getUploadSkillToSkillRepositoryDisabledReason(item)

  const metaEntries = item.metadata
    ? Object.entries(item.metadata).filter(([, v]) => v)
    : []
  const content = item.content ?? loadedContent
  const primaryActionLabel = item.synapseContentId ? "查看仓库内容" : "导入到仓库"

  return (
    <>
      {item.type === "rule" ? (
        <AlertDialog
          open={isTrashConfirmOpen}
          onOpenChange={(nextOpen) => {
            if (!isTrashBusy) setIsTrashConfirmOpen(nextOpen)
          }}
          data-track="editor-scan-trash-confirm"
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
              <AlertDialogDescription>
                <span className="block">{item.name}</span>
                <span className="block break-all">{item.path}</span>
                <span className="block">可从系统废纸篓恢复。</span>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isTrashBusy}>取消</AlertDialogCancel>
              <AlertDialogAction
                data-track="editor-scan-trash-confirm-submit"
                disabled={isTrashBusy}
                onClick={(event) => {
                  event.preventDefault()
                  void handleTrashConfirm()
                }}
              >
                {isTrashBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
                移到废纸篓
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      <AlertDialog
        open={fallbackReason !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setFallbackReason(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>关联内容不可用</AlertDialogTitle>
            <AlertDialogDescription>
              {fallbackReason} 可以作为新内容导入。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setFallbackReason(null)
                void preparePublishChoice()
              }}
            >
              作为新内容导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isPublishChoiceOpen}
        onOpenChange={(nextOpen) => {
          if (!isOverwriteBusy && !isQuickPublishBusy) setIsPublishChoiceOpen(nextOpen)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>发布到仓库</AlertDialogTitle>
            <AlertDialogDescription>
              {quickPublishDraft?.itemType === "skill" ? (
                <span className="space-y-1">
                  <span className="block">
                    将发布 {quickPublishDraft.sourceImportSummary.fileCount} 个文件，共 {formatSkillAttachmentSize(quickPublishDraft.sourceImportSummary.totalBytes)}。
                  </span>
                  <span className="block">
                    `.env`、`.synapse.json`、`.synapse.repository.json`、其他隐藏项和符号链接不会发布。
                  </span>
                  {overwriteDiff ? (
                    <span className="block">
                      覆盖附件：新增 {overwriteDiff.added}，变化 {overwriteDiff.changed}，删除 {overwriteDiff.removed}。标题、分类和图标默认保留，历史版本可回退。
                    </span>
                  ) : null}
                  {overwriteUnavailableReason ? <span className="block">{overwriteUnavailableReason}</span> : null}
                </span>
              ) : (
                <>覆盖会替换该 Rule 的现有正文，仓库会保留历史版本，可回退。</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isOverwriteBusy || isQuickPublishBusy}>取消</AlertDialogCancel>
            <Button
              type="button"
              variant="outline"
              disabled={isOverwriteBusy || isQuickPublishBusy}
              onClick={(event) => {
                event.preventDefault()
                void handlePublishAsNewFromChoice()
              }}
            >
              发布为新内容
            </Button>
            <AlertDialogAction
              disabled={isOverwriteBusy || isQuickPublishBusy || overwriteUnavailableReason !== null}
              onClick={(event) => {
                event.preventDefault()
                void handlePublishOverwrite()
              }}
            >
              {isOverwriteBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
              覆盖现有内容
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isSkillRepositoryUploadConfirmOpen}
        onOpenChange={(nextOpen) => {
          if (!isSkillRepositoryUploadBusy) setIsSkillRepositoryUploadConfirmOpen(nextOpen)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>上传到 Skill Repository</AlertDialogTitle>
            <AlertDialogDescription>
              {skillRepositoryPublishDraft ? (
                <span className="space-y-1">
                  <span className="block">
                    将上传 {skillRepositoryPublishDraft.sourceImportSummary.fileCount} 个文件，共 {formatSkillAttachmentSize(skillRepositoryPublishDraft.sourceImportSummary.totalBytes)}。
                  </span>
                  <span className="block">
                    .env、两类身份文件、其他隐藏项和符号链接不会上传。
                  </span>
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSkillRepositoryUploadBusy}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSkillRepositoryUploadBusy}
              onClick={(event) => {
                event.preventDefault()
                void handleUploadSkillToSkillRepository()
              }}
            >
              {isSkillRepositoryUploadBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
              确认上传
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={skillRepositoryManagementUrl !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setSkillRepositoryManagementUrl(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Skill 仓库已保存</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block break-all">{skillRepositoryManagementUrl}</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>关闭</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                if (skillRepositoryManagementUrl) {
                  void navigator.clipboard.writeText(skillRepositoryManagementUrl).then(() => {
                    success("已复制到剪贴板。")
                    setSkillRepositoryManagementUrl(null)
                  }).catch(() => {
                    notifyError("复制失败。")
                  })
                }
              }}
            >
              复制链接
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="h-[calc(100vh-2rem)] max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-[600px]" showCloseButton={false}>
          <DialogFrame>
            <DialogFrameHeader
              bordered
              title={(
                <>
                  <span className="truncate text-sm font-medium">{item.name}</span>
                  <Badge
                    variant={item.source === "synapse" ? "default" : "secondary"}
                    className="shrink-0 text-xs px-1.5 py-0"
                  >
                    {item.source === "synapse" ? "Synapse" : "外部"}
                  </Badge>
                  <Badge variant="outline" className="shrink-0 text-xs px-1.5 py-0">
                    {item.type === "skill" ? "Skill" : "Rule"}
                  </Badge>
                </>
              )}
              titleClassName="flex min-w-0 items-center gap-2"
              description={[
                metaEntries.length > 0 ? metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ") : null,
              ].filter(Boolean).join(" · ")}
            >
              <div className="flex items-center gap-2">
                <Menubar className="w-fit">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-sm px-1.5"
                    disabled={!content}
                    onClick={() => void handleCopy()}
                  >
                    复制内容
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-sm px-1.5"
                    onClick={handleOpenInFinder}
                  >
                    在 Finder 中显示
                  </Button>
                </Menubar>
              </div>
              {quickPublishError ? (
                <Alert variant="destructive">
                  <AlertDescription>{quickPublishError}</AlertDescription>
                </Alert>
              ) : null}
              {trashError ? (
                <Alert variant="destructive">
                  <AlertDescription>{trashError}</AlertDescription>
                </Alert>
              ) : null}
            </DialogFrameHeader>

            <DialogFrameBody className={cn(
              "flex flex-col px-5 py-4 transition-opacity duration-200",
              contentReady ? "opacity-100" : "opacity-0",
            )}>
              {contentReady ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="flex items-center">
                    <Tabs
                      value={viewMode}
                      onValueChange={(v) => setViewMode(v === "source" ? "source" : "rendered")}
                      className="ml-auto shrink-0 gap-0"
                    >
                      <TabsList>
                        <TabsTrigger value="rendered">预览</TabsTrigger>
                        <TabsTrigger value="source">源码</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </div>

                  <ScrollArea className="mt-4 min-h-0 flex-1">
                    <ScanItemContentArea
                      content={content}
                      error={error}
                      loading={loading}
                      viewMode={viewMode}
                      skillFiles={skillFiles}
                      skillFilesLoading={skillFilesLoading}
                      skillFilesError={skillFilesError}
                    />
                  </ScrollArea>
                </div>
              ) : null}
            </DialogFrameBody>

            <DialogFrameFooter className="flex-row items-center justify-between py-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
              onClick={handleOpenInFinder}
            >
              <FolderOpen className="size-3 shrink-0" />
              <span className="truncate">{item.path}</span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" size="sm">
                  {isQuickPublishBusy ? (
                    <LoaderCircle className="animate-spin" data-icon="inline-start" />
                  ) : (
                    <MoreHorizontal data-icon="inline-start" />
                  )}
                  操作
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={isQuickPublishBusy || disabledReason !== null}
                    onSelect={() => void handlePrimaryAction()}
                  >
                    {primaryActionLabel}
                  </DropdownMenuItem>
                  {canReinstall ? (
                    <DropdownMenuItem
                      disabled={isReinstallBusy || disabledReason !== null}
                      onSelect={() => void handleReinstall()}
                    >
                      重新安装
                    </DropdownMenuItem>
                  ) : null}
                  {canPublishToRepo ? (
                    <DropdownMenuItem
                      disabled={isOverwriteBusy || isQuickPublishBusy || disabledReason !== null}
                      onSelect={() => {
                        logger.info("Publish-to-repo choice opened.", {
                          contentId: item.synapseContentId,
                          contentType: item.type,
                          editorId: item.editorId,
                          scope: item.scope,
                        })
                        void preparePublishChoice()
                      }}
                    >
                      发布到仓库
                    </DropdownMenuItem>
                  ) : null}
                  {item.type === "skill" ? (
                    <DropdownMenuItem
                      disabled={isSkillRepositoryUploadBusy || uploadSkillToRepositoryDisabledReason !== null}
                      onSelect={() => void prepareSkillRepositoryUpload()}
                    >
                      {isSkillRepositoryUploadBusy ? <LoaderCircle className="animate-spin" data-icon="inline-start" /> : null}
                      上传到 Skill Repository
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={isTrashBusy || trashDisabledReason !== null}
                    onSelect={() => {
                      if (item.type === "skill") {
                        onRequestSkillUninstall?.(item)
                        return
                      }
                      setIsTrashConfirmOpen(true)
                    }}
                  >
                    移到废纸篓
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    disabled={!content}
                    onSelect={() => setIsEditorCopyOpen(true)}
                  >
                    复制到其它编辑器
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            </DialogFrameFooter>
          </DialogFrame>
        </DialogContent>
      </Dialog>

      <EditorCopyDialog
        content={content}
        item={item}
        onCopied={onChanged}
        open={isEditorCopyOpen}
        onOpenChange={setIsEditorCopyOpen}
      />

      {reinstallSource && reinstallEditor ? (
        <Dialog open={isReinstallOpen} onOpenChange={handleReinstallOpenChange}>
          <DialogContent className="p-0 sm:max-w-lg" showCloseButton={false}>
            <DialogFrame>
              <DialogFrameHeader title="重新安装" />
              <DialogFrameBody className="px-5 pb-5">
                <SharedInstallerFlow
                  editors={[reinstallEditor]}
                  initialEditor={reinstallEditor}
                  initialSelection={reinstallSelection}
                  mode="modal"
                  onCancel={() => handleReinstallOpenChange(false)}
                  onInstalled={async () => {
                    await onChanged?.()
                    handleReinstallOpenChange(false)
                  }}
                  projects={config.global.projects}
                  source={reinstallSource}
                />
              </DialogFrameBody>
            </DialogFrame>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}

type ScanItemContentAreaProps = {
  content: string | null
  error: string | null
  loading: boolean
  viewMode: "rendered" | "source"
  skillFiles: EditorScanSkillFileEntry[]
  skillFilesLoading: boolean
  skillFilesError: string | null
}

function ScanItemContentArea({
  content,
  error,
  loading,
  viewMode,
  skillFiles,
  skillFilesLoading,
  skillFilesError,
}: ScanItemContentAreaProps) {
  if (loading) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>正在加载内容</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (error) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <AlertCircle />
          </EmptyMedia>
          <EmptyTitle>读取失败</EmptyTitle>
          <EmptyDescription>{error}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (!content) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyTitle>暂无内容</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <>
      <MarkdownViewer content={content} mode={viewMode} showTabs={false} surface="plain" />
      {skillFilesLoading ? (
        <p className="mt-4 text-xs text-muted-foreground">正在加载关联文件</p>
      ) : null}
      {skillFilesError ? (
        <p className="mt-4 text-xs text-destructive">{skillFilesError}</p>
      ) : null}
      {skillFiles.length > 0 ? (
        <SkillFilesSection files={skillFiles} />
      ) : null}
    </>
  )
}

function SkillFilesSection({ files }: { files: EditorScanSkillFileEntry[] }) {
  return (
    <div className="mt-4 border-t pt-4">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        关联文件
      </p>
      <div className="flex flex-col gap-1">
        {files.map((f) => (
          <div
            key={f.name}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs text-muted-foreground"
          >
            <File className="size-3.5 shrink-0" />
            <span className="min-w-0 truncate">{f.name}</span>
            <span className="ml-auto shrink-0 tabular-nums">{formatSkillAttachmentSize(f.size)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export { ScanItemDetailDialog }
