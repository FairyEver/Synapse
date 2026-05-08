import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Image } from "lucide-react"
import {
  downloadContent,
  getIconPromptTemplate,
  readContent,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { EditorIcon } from "@/components/editor-icon"
import { getContentTypeDefinition } from "@/config/content-types"
import { ContentInstallDialog } from "@/modules/content/components/content-install-dialog"
import type { EditorWriteTargetInitialSelection } from "@/modules/content/components/editor-write-target-selector"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary, SynapseEditorId } from "@/types/editor"

type ContentActionMenuItem = {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  onSelect?: () => void
}

type ContentActionMenuSection = {
  key: string
  label?: string
  items: ContentActionMenuItem[]
}

type UseContentDownloadActionsProps = {
  item: SynapseContentMeta
  onInstalled?: () => Promise<void> | void
  onInstallDialogOpenChange?: (open: boolean) => void
}

function useContentDownloadActions({
  item,
  onInstalled,
  onInstallDialogOpenChange,
}: UseContentDownloadActionsProps) {
  const definition = getContentTypeDefinition(item.type)
  const { config } = useAppConfig()
  const { promise } = useAppNotifications()
  const logger = useMemo(
    () => createRendererLogger(`content.action.${item.type}`),
    [item.type],
  )
  const [isCopying, setIsCopying] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false)
  const [initialInstallSelection, setInitialInstallSelection] =
    useState<EditorWriteTargetInitialSelection | null>(null)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const [isCopyingIconPrompt, setIsCopyingIconPrompt] = useState(false)
  const onInstallDialogOpenChangeRef = useRef(onInstallDialogOpenChange)

  onInstallDialogOpenChangeRef.current = onInstallDialogOpenChange
  const canCopy = definition.capabilities.canCopyContent
  const canDownload = definition.capabilities.canDownload
  const canInstall = definition.capabilities.canInstallToEditor
  const isBusy = isCopying || isDownloading
  const {
    error: adaptersError,
    filteredAdapters,
    isLoading: isLoadingAdapters,
    load: loadInstallTargets,
  } = useEditorAdaptersForContentType({
    contentType: item.type,
    enabled: canInstall,
    loggerName: `content.action.${item.type}`,
  })

  const openInstallDialog = useCallback((editor: SynapseEditorAdapterSummary) => {
    setInitialInstallSelection(null)
    setSelectedEditor(editor)
    setIsInstallDialogOpen((prevOpen) => {
      if (prevOpen !== true) {
        logger.info("Content install dialog visibility changed.", {
          open: true,
          contentId: item.id,
          contentType: item.type,
          editorId: editor.id,
        })
      }

      return true
    })
  }, [item.id, item.type, logger])

  const handleInstallDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setInitialInstallSelection(null)
    }

    setIsInstallDialogOpen((prevOpen) => {
      if (prevOpen !== nextOpen) {
        logger.info("Content install dialog visibility changed.", {
          open: nextOpen,
          contentId: item.id,
          contentType: item.type,
          editorId: selectedEditor?.id ?? null,
        })
      }

      return nextOpen
    })
  }, [item.id, item.type, logger, selectedEditor])

  const openInstallDialogForEditorId = useCallback(async ({
    editorId,
    initialSelection,
  }: {
    editorId: SynapseEditorId
    initialSelection: EditorWriteTargetInitialSelection
  }): Promise<boolean> => {
    const adaptersToSearch = filteredAdapters.length > 0
      ? filteredAdapters
      : await loadInstallTargets()
    const adapter = adaptersToSearch.find((candidate) => candidate.id === editorId)

    if (!adapter) {
      logger.warn("Requested editor install target is unavailable.", {
        contentId: item.id,
        contentType: item.type,
        editorId,
      })
      return false
    }

    setInitialInstallSelection(initialSelection)
    setSelectedEditor(adapter)
    setIsInstallDialogOpen(true)
    return true
  }, [filteredAdapters, item.id, item.type, loadInstallTargets, logger])

  useEffect(() => {
    onInstallDialogOpenChangeRef.current?.(isInstallDialogOpen)
  }, [isInstallDialogOpen])

  const handleDownload = useCallback(async () => {
    if (isBusy || !canDownload) {
      return
    }

    setIsDownloading(true)

    try {
      await promise(
        async () => {
          const result = await downloadContent(item.type, item.id)

          logger.info("Content download requested.", {
            canceled: result.canceled,
            contentId: item.id,
            contentType: item.type,
            filePath: result.filePath,
          })

          if (!result.canceled && result.filePath) {
            window.synapse?.shell.showItemInFolder(result.filePath)
          }

          return result
        },
        {
          loading: `正在下载 ${definition.singularLabel}...`,
          success: (result) => {
            if (result.canceled) {
              return {
                message: "已取消下载。",
                tone: "info",
              }
            }

            if (result.filePath) {
              return `已保存到 ${result.filePath}`
            }

            return null
          },
          error: (error) => error instanceof Error ? error.message : "下载失败。",
        },
      )
    } catch (error) {
      logger.error("Content download failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })
    } finally {
      setIsDownloading(false)
    }
  }, [canDownload, definition.singularLabel, isBusy, item.id, item.type, logger, promise])

  const handleCopy = useCallback(async () => {
    if (!canCopy || isBusy) {
      return
    }

    setIsCopying(true)

    try {
      await promise(
        async () => {
          const file = await readContent(item.type, item.id)

          if (!navigator.clipboard?.writeText) {
            throw new Error("当前环境不支持复制到剪贴板。")
          }

          await navigator.clipboard.writeText(file.content)

          logger.info("Content copied to clipboard.", {
            contentId: item.id,
            contentType: item.type,
          })
        },
        {
          loading: "正在复制正文...",
          success: "正文已复制。",
          error: (error) => error instanceof Error ? error.message : "复制失败。",
        },
      )
    } catch (error) {
      logger.error("Copy to clipboard failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })
    } finally {
      setIsCopying(false)
    }
  }, [canCopy, isBusy, item.id, item.type, logger, promise])

  const handleCopyIconPrompt = useCallback(async () => {
    if (isBusy || !canCopy) {
      return
    }

    setIsCopyingIconPrompt(true)

    try {
      await promise(
        async () => {
          const prompt = await getIconPromptTemplate(item.type, item.id)

          if (!prompt) {
            throw new Error("无法生成图标提示词。")
          }

          if (!navigator.clipboard?.writeText) {
            throw new Error("当前环境不支持复制到剪贴板。")
          }

          await navigator.clipboard.writeText(prompt)

          logger.info("Icon prompt copied to clipboard.", {
            contentId: item.id,
            contentType: item.type,
          })
        },
        {
          loading: "正在复制图标提示词...",
          success: "图标提示词已复制。",
          error: (error) => error instanceof Error ? error.message : "复制失败。",
        },
      )
    } catch (error) {
      logger.error("Copy icon prompt to clipboard failed.", {
        contentId: item.id,
        contentType: item.type,
        error,
      })
    } finally {
      setIsCopyingIconPrompt(false)
    }
  }, [canCopy, isBusy, item.id, item.type, logger, promise])

  const auxiliaryMenuSections = useMemo<ContentActionMenuSection[]>(
    () => {
      const sections: ContentActionMenuSection[] = []

      if (canInstall) {
        sections.push({
          key: "install",
          items: isLoadingAdapters
            ? [{ key: "loading-editors", label: "正在读取编辑器", disabled: true }]
            : adaptersError
              ? [{ key: "editors-error", label: adaptersError, disabled: true }]
              : filteredAdapters.length > 0
                ? filteredAdapters.map((adapter) => ({
                    key: `install-${adapter.id}`,
                    label: adapter.label,
                    icon: <EditorIcon editorId={adapter.id} />,
                    onSelect: () => {
                      openInstallDialog(adapter)
                    },
                  }))
                : [{ key: "no-install-target", label: "当前没有可用的安装目标", disabled: true }],
        })
      }

      if (canCopy) {
        sections.push({
          key: "copy",
          items: [
            {
              key: "copy-content",
              label: "复制正文",
              disabled: isBusy,
              onSelect: () => {
                void handleCopy()
              },
            },
            {
              key: "copy-icon-prompt",
              label: "复制图标提示词",
              icon: <Image className="mr-2 h-4 w-4" />,
              disabled: isBusy,
              onSelect: () => {
                void handleCopyIconPrompt()
              },
            },
          ],
        })
      }

      return sections
    },
    [adaptersError, canCopy, canInstall, filteredAdapters, handleCopy, handleCopyIconPrompt, isBusy, isLoadingAdapters, openInstallDialog],
  )

  const downloadAction = useMemo<ContentActionMenuItem | null>(
    () => canDownload
      ? {
          key: "download-local",
          label: "下载到本地",
          disabled: isBusy,
          onSelect: () => {
            void handleDownload()
          },
        }
      : null,
    [canDownload, handleDownload, isBusy],
  )

  const allMenuSections = useMemo<ContentActionMenuSection[]>(
    () => downloadAction
      ? [{ key: "download", items: [downloadAction] }, ...auxiliaryMenuSections]
      : auxiliaryMenuSections,
    [auxiliaryMenuSections, downloadAction],
  )

  const installMenuItems = useMemo<ContentActionMenuItem[]>(
    () => {
      if (!canInstall) return []
      if (isLoadingAdapters) return [{ key: "loading-editors", label: "正在读取编辑器", disabled: true }]
      if (adaptersError) return [{ key: "editors-error", label: adaptersError, disabled: true }]
      if (filteredAdapters.length === 0) return [{ key: "no-install-target", label: "当前没有可用的安装目标", disabled: true }]
      return filteredAdapters.map((adapter) => ({
        key: `install-${adapter.id}`,
        label: adapter.label,
        icon: <EditorIcon editorId={adapter.id} />,
        onSelect: () => {
          openInstallDialog(adapter)
        },
      }))
    },
    [adaptersError, canInstall, filteredAdapters, isLoadingAdapters, openInstallDialog],
  )

  const hasAttachments = definition.capabilities.hasAttachments

  return {
    allMenuSections,
    auxiliaryMenuSections,
    canCopy,
    canDownload,
    canInstall,
    downloadAction,
    handleCopy,
    handleCopyIconPrompt,
    handleDownload,
    hasAttachments,
    installDialog: canInstall ? (
      <ContentInstallDialog
        editor={selectedEditor}
        initialSelection={initialInstallSelection}
        item={item}
        onInstalled={onInstalled}
        open={isInstallDialogOpen}
        onOpenChange={handleInstallDialogOpenChange}
        projects={config.global.projects}
      />
    ) : null,
    installMenuItems,
    isBusy,
    isCopying,
    isCopyingIconPrompt,
    isDownloading,
    loadInstallTargets,
    openInstallDialogForEditorId,
  }
}

export { useContentDownloadActions }

export type { ContentActionMenuItem, ContentActionMenuSection }
