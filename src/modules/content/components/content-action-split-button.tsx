import { Fragment, useState } from "react"
import {
  ChevronDown,
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
    canDownload,
    downloadAction,
    installDialog,
    isBusy,
    isDownloading,
    loadInstallTargets,
  } = useContentDownloadActions({
    item,
    onInstallDialogOpenChange,
  })
  const hasDropdown = auxiliaryMenuSections.length > 0

  return (
    <>
      <ButtonGroup>
        {canDownload ? (
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
              {auxiliaryMenuSections.map((section, index) => (
                <Fragment key={section.key}>
                  {section.label ? <DropdownMenuLabel>{section.label}</DropdownMenuLabel> : null}
                  <DropdownMenuGroup>
                    {section.items.map((action) => (
                      <DropdownMenuItem
                        key={action.key}
                        disabled={action.disabled}
                        onSelect={action.onSelect}
                      >
                        {action.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                  {index < auxiliaryMenuSections.length - 1 ? <DropdownMenuSeparator /> : null}
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
