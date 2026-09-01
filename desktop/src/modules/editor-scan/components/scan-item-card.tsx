import type { KeyboardEvent, MouseEvent } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { EditorScanItemSource } from "@/types/editor-scan"

type ScanItemCardProps = {
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  metadata?: Record<string, string>
  onClick?: () => void
  selectable?: boolean
  selected?: boolean
  onSelectionChange?: (selected: boolean) => void
}

function ScanItemCard({
  name,
  path: itemPath,
  source,
  preview,
  metadata,
  onClick,
  selectable = false,
  selected = false,
  onSelectionChange,
}: ScanItemCardProps) {
  const handleOpenInFinder = (e: MouseEvent) => {
    e.stopPropagation()
    const bridge = getSynapseBridge()
    if (!bridge) {
      toast.error("无法在访达中打开文件。")
      return
    }

    void bridge.shell.showItemInFolder(itemPath).catch(() => {
      toast.error("无法在访达中打开文件。")
    })
  }

  const handleSelectionClick = (event: MouseEvent) => {
    event.stopPropagation()
  }

  const handleCardActionKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return
    event.preventDefault()
    onClick?.()
  }

  const metaEntries = metadata
    ? Object.entries(metadata).filter(([, v]) => v)
    : []

  const firstLine = preview?.split("\n")[0] ?? ""

  return (
    <div
      data-scan-item-card
      className="group rounded-lg bg-card px-3.5 py-3"
    >
      <div className="flex items-start gap-2">
        {selectable ? (
          <Checkbox
            aria-label={`选择 ${name}`}
            checked={selected}
            className="mt-0.5"
            onClick={handleSelectionClick}
            onCheckedChange={(value) => onSelectionChange?.(value === true)}
          />
        ) : null}
        <div className="min-w-0 flex-1">
          <div
            data-scan-item-card-action
            data-track="editor-scan.item.open"
            data-track-native="true"
            role="button"
            tabIndex={0}
            className="cursor-pointer"
            onClick={onClick}
            onKeyDown={handleCardActionKeyDown}
          >
            <div className="flex items-center gap-2">
              <span className="truncate text-sm font-medium">{name}</span>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant={source === "synapse" ? "default" : "secondary"}
                      className="shrink-0 px-1.5 py-0 text-xs"
                    >
                      {source === "synapse" ? "Synapse" : "外部"}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    {source === "synapse"
                      ? "由 Synapse 安装"
                      : "用户自行管理"}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
            {firstLine ? (
              <p className="mt-1 truncate text-xs text-muted-foreground">
                {firstLine}
              </p>
            ) : null}
            {metaEntries.length > 0 ? (
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
              </p>
            ) : null}
          </div>
          <button
            data-track="editor-scan.item.reveal"
            data-track-native="true"
            type="button"
            className="mt-1.5 block max-w-full truncate text-left text-xs text-muted-foreground/50 transition-colors hover:text-foreground"
            onClick={handleOpenInFinder}
          >
            {itemPath}
          </button>
        </div>
      </div>
    </div>
  )
}

export { ScanItemCard }
