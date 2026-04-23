import { Fragment, useMemo, useState } from "react"
import {
  ChevronDown,
  Copy,
  Download,
  LoaderCircle,
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
import { useContentDownloadActions } from "@/modules/content/hooks/use-content-download-actions"
import type { SynapseContentMeta } from "@/types/content"

type ContentActionSplitButtonProps = {
  item: SynapseContentMeta
  onInstallDialogOpenChange?: (open: boolean) => void
}

function ContentActionSplitButton({
  item,
  onInstallDialogOpenChange,
}: ContentActionSplitButtonProps) {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const {
    auxiliaryMenuSections,
    canCopy,
    canDownload,
    downloadAction,
    handleCopy,
    installDialog,
    isBusy,
    isCopying,
    isDownloading,
    loadInstallTargets,
  } = useContentDownloadActions({
    item,
    onInstallDialogOpenChange,
  })

  const definition = getContentTypeDefinition(item.type)
  const primaryAction = definition.listPrimaryAction ?? "download"

  const dropdownSections = useMemo(() => {
    if (primaryAction === "copy") {
      return downloadAction ? [{ key: "download", items: [downloadAction] }] : []
    }
    return auxiliaryMenuSections
  }, [primaryAction, downloadAction, auxiliaryMenuSections])

  const hasDropdown = dropdownSections.length > 0

  return (
    <>
      <ButtonGroup>
        {primaryAction === "copy" && canCopy ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={() => {
              void handleCopy()
            }}
          >
            {isCopying ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : (
              <Copy data-icon="inline-start" />
            )}
            复制
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

        {hasDropdown ? (
          <DropdownMenu
            data-track="content-actions-menu"
            open={isMenuOpen}
            onOpenChange={(open) => {
              setIsMenuOpen(open)

              if (open) {
                loadInstallTargets()
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

            <DropdownMenuContent align="end" className="w-max">
              {dropdownSections.map((section, index) => (
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
                  {index < dropdownSections.length - 1 ? <DropdownMenuSeparator /> : null}
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </ButtonGroup>

      {installDialog}
    </>
  )
}

export { ContentActionSplitButton }
