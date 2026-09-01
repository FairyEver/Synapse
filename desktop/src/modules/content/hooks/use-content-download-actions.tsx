import type { ReactNode } from "react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  downloadContent,
  getIconPromptTemplate,
  readContent,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { getContentTypeDefinition } from "@/config/content-types"
import type { EditorWriteTargetInitialSelection } from "@/modules/content/components/editor-write-target-selector"
import { useEditorAdaptersForContentType } from "@/modules/content/hooks/use-editor-adapters-for-content-type"
import { RuleInstallerModal } from "@/modules/installers/rule/rule-installer-modal"
import { SkillInstallerModal } from "@/modules/installers/skill/skill-installer-modal"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorId } from "@/types/editor"
import type { SynapseInstallerSource } from "@/types/installers"

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
  const [isCopyingIconPrompt, setIsCopyingIconPrompt] = useState(false)
  const onInstallDialogOpenChangeRef = useRef(onInstallDialogOpenChange)

  onInstallDialogOpenChangeRef.current = onInstallDialogOpenChange
  const canCopy = definition.capabilities.canCopyContent
  const canDownload = definition.capabilities.canDownload
  const canInstall = definition.capabilities.canInstallToEditor
  const isBusy = isCopying || isDownloading || isCopyingIconPrompt
  const {
    filteredAdapters,
    load: loadInstallTargets,
  } = useEditorAdaptersForContentType({
    contentType: item.type,
    enabled: canInstall,
    loggerName: `content.action.${item.type}`,
  })

  const installerSource = useMemo<SynapseInstallerSource | null>(() => {
    if (item.type === "skill") {
      return {
        kind: "skill",
        origin: "repository",
        repositoryContentId: item.id,
        sourceIdentity: item.id,
        name: item.name ?? item.id,
        title: item.title,
        description: item.description,
      }
    }
    if (item.type === "rule") {
      return {
        kind: "rule",
        origin: "repository",
        repositoryContentId: item.id,
        sourceIdentity: item.id,
        name: item.name ?? item.id,
        title: item.title,
        description: item.description,
      }
    }
    return null
  }, [item])

  const openInstallDialog = useCallback(() => {
    void loadInstallTargets()
    setIsInstallDialogOpen((prevOpen) => {
      if (prevOpen !== true) {
        logger.info("Content install dialog visibility changed.", {
          open: true,
          contentId: item.id,
          contentType: item.type,
        })
      }

      return true
    })
  }, [item.id, item.type, loadInstallTargets, logger])

  const handleInstallDialogOpenChange = useCallback((nextOpen: boolean) => {
    setIsInstallDialogOpen((prevOpen) => {
      if (prevOpen !== nextOpen) {
        logger.info("Content install dialog visibility changed.", {
          open: nextOpen,
          contentId: item.id,
          contentType: item.type,
        })
      }

      return nextOpen
    })
  }, [item.id, item.type, logger])

  const openInstallDialogForEditorId = useCallback(async ({
    editorId,
    initialSelection,
  }: {
    editorId: SynapseEditorId
    initialSelection: EditorWriteTargetInitialSelection
  }): Promise<boolean> => {
    const adaptersToSearch = await loadInstallTargets(true)
    const adapter = adaptersToSearch.find((candidate) => candidate.id === editorId)

    if (!adapter) {
      logger.warn("Requested editor install target is unavailable.", {
        contentId: item.id,
        contentType: item.type,
        editorId,
      })
      return false
    }

    void initialSelection
    openInstallDialog()
    return true
  }, [item.id, item.type, loadInstallTargets, logger, openInstallDialog])

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
            window.synapse?.shell.showItemInFolder(result.filePath).catch(() => {})
          }

          return result
        },
        {
          trackingName: "content.download",
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
          trackingName: "content.body.copy",
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
          trackingName: "content.icon-prompt.copy",
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
          items: [{
            key: "install",
            label: "安装",
            disabled: isBusy,
            onSelect: openInstallDialog,
          }],
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
    [canCopy, canInstall, handleCopy, handleCopyIconPrompt, isBusy, openInstallDialog],
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

  const installAction = useMemo<ContentActionMenuItem | null>(
    () => canInstall
      ? {
          key: "install",
          label: "安装",
          disabled: isBusy,
          onSelect: openInstallDialog,
        }
      : null,
    [canInstall, isBusy, openInstallDialog],
  )

  const hasAttachments = definition.capabilities.hasAttachments
  const installDialog = canInstall && installerSource?.kind === "skill" ? (
    <SkillInstallerModal
      editors={filteredAdapters}
      open={isInstallDialogOpen}
      projects={config.global.projects}
      source={installerSource}
      onInstalled={onInstalled}
      onOpenChange={handleInstallDialogOpenChange}
    />
  ) : canInstall && installerSource?.kind === "rule" ? (
    <RuleInstallerModal
      editors={filteredAdapters}
      open={isInstallDialogOpen}
      projects={config.global.projects}
      source={installerSource}
      onInstalled={onInstalled}
      onOpenChange={handleInstallDialogOpenChange}
    />
  ) : null

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
    installAction,
    installDialog,
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
