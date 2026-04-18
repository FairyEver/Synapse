import { useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  Copy,
  Download,
  LoaderCircle,
} from "lucide-react"
import {
  downloadRule,
  downloadSkill,
  getEditorAdapters,
  readRuleContent,
  readSkillContent,
} from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ContentInstallDialog } from "@/modules/content/components/content-install-dialog"
import type { SynapseContentMeta } from "@/types/content"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

type ContentActionSplitButtonProps = {
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
}

function canCopyContent(item: SynapseContentMeta): boolean {
  return true
}

function supportsContentType(
  adapter: SynapseEditorAdapterSummary,
  item: SynapseContentMeta,
): boolean {
  return item.type === "rule" ? adapter.supportsRule : adapter.supportsSkill
}

function ContentActionSplitButton({
  item,
  onInstallDialogOpenChange,
}: ContentActionSplitButtonProps) {
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
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [selectedEditor, setSelectedEditor] = useState<SynapseEditorAdapterSummary | null>(null)
  const canCopy = canCopyContent(item)
  const isBusy = isCopying || isDownloading
  const filteredAdapters = (adapters ?? []).filter((adapter) => supportsContentType(adapter, item))
  const contentLabel = item.type === "rule" ? "Rule" : "Skill"

  useEffect(() => {
    onInstallDialogOpenChange?.(isInstallDialogOpen)
  }, [isInstallDialogOpen, onInstallDialogOpenChange])

  useEffect(() => {
    if (!isMenuOpen || adapters || adaptersError || isLoadingAdapters) {
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
  }, [adapters, adaptersError, isLoadingAdapters, isMenuOpen])

  const handleDownload = async () => {
    if (isBusy) {
      return
    }

    setIsDownloading(true)

    try {
      await promise(
        async () => {
          const result =
            item.type === "rule"
              ? await downloadRule(item.id)
              : await downloadSkill(item.id)

          logger.info("Content download requested.", {
            canceled: result.canceled,
            contentId: item.id,
            contentType: item.type,
            filePath: result.filePath,
          })

          return result
        },
        {
          loading: `正在下载 ${contentLabel}...`,
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
  }

  const handleCopy = async () => {
    if (!canCopy || isBusy) {
      return
    }

    setIsCopying(true)

    try {
      await promise(
        async () => {
          const file =
            item.type === "rule"
              ? await readRuleContent(item.id)
              : await readSkillContent(item.id)

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
  }

  return (
    <>
      <ButtonGroup>
        <Button
          variant="outline"
          size="sm"
          disabled={isBusy}
          onClick={() => {
            void handleDownload()
          }}
        >
          {isDownloading ? (
            <LoaderCircle className="animate-spin" data-icon="inline-start" />
          ) : (
            <Download data-icon="inline-start" />
          )}
          下载
        </Button>

        <DropdownMenu
          open={isMenuOpen}
          onOpenChange={(open) => {
            setIsMenuOpen(open)

            if (open && adaptersError && !adapters) {
              setAdaptersError(null)
            }
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={isBusy}
              title="更多操作"
            >
              <ChevronDown />
              <span className="sr-only">更多操作</span>
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>安装</DropdownMenuLabel>
            <DropdownMenuGroup>
              {isLoadingAdapters ? (
                <DropdownMenuItem disabled>
                  <LoaderCircle className="animate-spin" />
                  正在读取编辑器
                </DropdownMenuItem>
              ) : adaptersError ? (
                <DropdownMenuItem disabled>{adaptersError}</DropdownMenuItem>
              ) : filteredAdapters.length > 0 ? (
                filteredAdapters.map((adapter) => (
                  <DropdownMenuItem
                    key={adapter.id}
                    onSelect={() => {
                      setSelectedEditor(adapter)
                      setIsInstallDialogOpen(true)
                    }}
                  >
                    安装到 {adapter.label}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>当前没有可用的安装目标</DropdownMenuItem>
              )}
            </DropdownMenuGroup>

            {canCopy ? (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={isBusy}
                  onSelect={() => {
                    void handleCopy()
                  }}
                >
                  {isCopying ? <LoaderCircle className="animate-spin" /> : <Copy />}
                  复制正文
                </DropdownMenuItem>
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </ButtonGroup>

      <ContentInstallDialog
        editor={selectedEditor}
        item={item}
        open={isInstallDialogOpen}
        projects={config.global.projects}
        onOpenChange={(open) => {
          setIsInstallDialogOpen(open)

          if (!open) {
            setSelectedEditor(null)
          }
        }}
      />
    </>
  )
}

export { ContentActionSplitButton }
