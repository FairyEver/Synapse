import type { MouseEvent } from "react"
import { FolderOpen } from "lucide-react"
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
    bridge?.shell.showItemInFolder(itemPath).catch(() => {
      toast.error("无法在访达中打开文件。")
    })
  }

  const handleSelectionClick = (event: MouseEvent) => {
    event.stopPropagation()
  }

  const metaEntries = metadata
    ? Object.entries(metadata).filter(([, v]) => v)
    : []

  const firstLine = preview?.split("\n")[0] ?? ""

  return (
    <div
      data-scan-item-card
      className="group cursor-pointer rounded-lg bg-card px-3.5 py-3"
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        {selectable ? (
          <Checkbox
            aria-label={`选择 ${name}`}
            checked={selected}
            onClick={handleSelectionClick}
            onCheckedChange={(value) => onSelectionChange?.(value === true)}
          />
        ) : null}
        <span className="truncate text-sm font-medium">{name}</span>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant={source === "synapse" ? "default" : "secondary"}
                className="shrink-0 text-xs px-1.5 py-0"
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
      <button
        type="button"
        className="mt-1.5 flex max-w-full items-center gap-1 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
        onClick={handleOpenInFinder}
      >
        <FolderOpen className="size-3 shrink-0" />
        <span className="truncate">{itemPath}</span>
      </button>
    </div>
  )
}

export { ScanItemCard }
