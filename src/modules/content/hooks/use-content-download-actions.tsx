import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  downloadContent,
  getEditorAdapters,
  readContent,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getContentTypeDefinition } from "@/config/content-types"
import { ContentInstallDialog } from "@/modules/content/components/content-install-dialog"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

type ContentActionMenuItem = {
  key: string
  label: string
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
  onInstallDialogOpenChange?: (open: boolean) => void
}

function useContentDownloadActions({
  item,
  onInstallDialogOpenChange,
}: UseContentDownloadActionsProps) {
  const definition = getContentTypeDefinition(item.type)
  const { config } = useAppConfig()
  const { promise } = useAppNotifications()
  const logger = useMemo(
    () => createRendererLogger(`content.action.${item.type}`),
    [item.type],
  )
  const [adapters, setAdapters] = useState<SynapseEditorAdapterSummary[] | null>(null)
  const [adaptersError, setAdaptersError] = useState<string | null>(null)
  const [isCopying, setIsCopying] = useState(false)
  const [isDownloading, setIsDownloading] = useState(false)
  const [isInstallDialogOpen, setIsInstallDialogOpen] = useState(false)
  const [isLoadingAdapters, setIsLoadingAdapters] = useState(false)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const onInstallDialogOpenChangeRef = useRef(onInstallDialogOpenChange)

  onInstallDialogOpenChangeRef.current = onInstallDialogOpenChange
  const canCopy = definition.capabilities.canCopyContent
  const canDownload = definition.capabilities.canDownload
  const canInstall = definition.capabilities.canInstallToEditor
  const isBusy = isCopying || isDownloading
  const filteredAdapters = (adapters ?? []).filter((adapter) => (
    adapter.supportedContentTypes.includes(item.type)
  ))

  useEffect(() => {
    onInstallDialogOpenChangeRef.current?.(isInstallDialogOpen)
  }, [isInstallDialogOpen])

  const loadInstallTargets = useCallback(() => {
    if (!canInstall || isLoadingAdapters) {
      return
    }

    setIsLoadingAdapters(true)
    setAdaptersError(null)

    void getEditorAdapters()
      .then((nextAdapters) => {
        setAdapters(nextAdapters)
      })
      .catch((error) => {
        setAdaptersError(error instanceof Error ? error.message : "读取编辑器列表失败。")
      })
      .finally(() => {
        setIsLoadingAdapters(false)
      })
  }, [canInstall, isLoadingAdapters])

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

  const auxiliaryMenuSections = useMemo<ContentActionMenuSection[]>(
    () => {
      const sections: ContentActionMenuSection[] = []

      if (canInstall) {
        sections.push({
          key: "install",
          label: "安装",
          items: isLoadingAdapters
            ? [{ key: "loading-editors", label: "正在读取编辑器", disabled: true }]
            : adaptersError
              ? [{ key: "editors-error", label: adaptersError, disabled: true }]
              : filteredAdapters.length > 0
                ? filteredAdapters.map((adapter) => ({
                    key: `install-${adapter.id}`,
                    label: `安装到 ${adapter.label}`,
                    onSelect: () => {
                      setSelectedEditor(adapter)
                      setIsInstallDialogOpen(true)
                    },
                  }))
                : [{ key: "no-install-target", label: "当前没有可用的安装目标", disabled: true }],
        })
      }

      if (canCopy) {
        sections.push({
          key: "copy",
          items: [{
            key: "copy-content",
            label: "复制正文",
            disabled: isBusy,
            onSelect: () => {
              void handleCopy()
            },
          }],
        })
      }

      return sections
    },
    [adaptersError, canCopy, canInstall, filteredAdapters, handleCopy, isBusy, isLoadingAdapters],
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

  return {
    allMenuSections,
    auxiliaryMenuSections,
    canCopy,
    canDownload,
    downloadAction,
    handleCopy,
    installDialog: canInstall ? (
      <ContentInstallDialog
        editor={selectedEditor}
        item={item}
        open={isInstallDialogOpen}
        onOpenChange={setIsInstallDialogOpen}
        projects={config.global.projects}
      />
    ) : null,
    isBusy,
    isCopying,
    isDownloading,
    loadInstallTargets,
  }
}

export { useContentDownloadActions }

export type { ContentActionMenuItem, ContentActionMenuSection }
