import { Fragment, useMemo, useState } from "react"
import {
  ChevronDown,
  Download,
  LoaderCircle,
  PackagePlus,
} from "lucide-react"
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
import { getContentTypeDefinition } from "@/config/content-types"
import { useAppConfig } from "@/app-shell/config"
import { useContentDownloadActions } from "@/modules/content/hooks/use-content-download-actions"
import type { ContentActionMenuSection } from "@/modules/content/hooks/use-content-download-actions"
import { PromptRunDialog } from "@/modules/prompts/components/prompt-run-dialog"
import type { SynapseContentMeta } from "@/types/content"

type ContentActionSplitButtonProps = {
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
}

function ContentActionSplitButton({
  item,
  onInstallDialogOpenChange,
}: ContentActionSplitButtonProps) {
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const {
    auxiliaryMenuSections,
    canCopy,
    canDownload,
    canInstall,
    downloadAction,
    handleCopy,
    installAction,
    installDialog,
    isBusy,
    isDownloading,
  } = useContentDownloadActions({
    item,
    onInstallDialogOpenChange,
  })

  const [runDialogOpen, setRunDialogOpen] = useState(false)
  const { config } = useAppConfig()
  const hasProjects = config.global.projects.length > 0

  const definition = getContentTypeDefinition(item.type)
  const canRunAsAgent = definition.capabilities.canRunAsAgent
  const primaryAction = definition.listPrimaryAction ?? "download"

  const actionMenuSections = useMemo<ContentActionMenuSection[]>(() => {
    if (primaryAction === "copy") {
      const sections = downloadAction ? [{ key: "download", items: [downloadAction] }] : []
      // Add copy-related sections (copy-content, copy-icon-prompt) for Prompt
      const copySections = auxiliaryMenuSections.filter((section) => section.key === "copy")
      return [...sections, ...copySections]
    }
    if (canInstall) {
      const nonInstallSections = auxiliaryMenuSections.filter((section) => section.key !== "install")
      return downloadAction
        ? [{ key: "download", items: [downloadAction] }, ...nonInstallSections]
        : nonInstallSections
    }
    return auxiliaryMenuSections
  }, [primaryAction, canInstall, downloadAction, auxiliaryMenuSections])

  const hasActionDropdown = actionMenuSections.length > 0

  return (
    <>
      <ButtonGroup>
        {canRunAsAgent ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || !hasProjects}
            title={hasProjects ? undefined : "请先在设置中添加项目"}
            onClick={() => setRunDialogOpen(true)}
          >
            运行
          </Button>
        ) : null}
        {primaryAction === "copy" && canCopy ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              void handleCopy()
            }}
          >
            复制
          </Button>
        ) : canInstall ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy || installAction?.disabled}
            onClick={() => {
              installAction?.onSelect?.()
            }}
          >
            <PackagePlus data-icon="inline-start" />
            安装
          </Button>
        ) : canDownload ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              downloadAction?.onSelect?.()
            }}
          >
            {isDownloading ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Download data-icon="inline-start" />
            )}
            下载
          </Button>
        ) : null}

        {hasActionDropdown ? (
          <DropdownMenu
            data-track="content-actions-menu"
            open={isActionMenuOpen}
            onOpenChange={(open) => {
              setIsActionMenuOpen(open)
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

            <DropdownMenuContent align="end" className="w-max">
              {actionMenuSections.map((section, index) => (
                <Fragment key={section.key}>
                  {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
                  <DropdownMenuGroup>
                    {section.items.map((action) => (
                      <DropdownMenuItem
                        key={action.key}
                        disabled={action.disabled}
                        onSelect={action.onSelect}
                      >
                        {action.icon}
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  {index < actionMenuSections.length - 1 ? <DropdownMenuSeparator /> : null}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ButtonGroup>

      {installDialog}
      {canRunAsAgent ? (
        <PromptRunDialog
          open={runDialogOpen}
          onOpenChange={setRunDialogOpen}
          item={item.type === "prompt" ? (item as SynapseContentMeta<"prompt">) : null}
        />
      ) : null}
    </>
  )
}

export { ContentActionSplitButton }
