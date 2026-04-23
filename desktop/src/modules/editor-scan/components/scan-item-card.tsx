import { useState } from "react"
import { ChevronRight, Diamond, Circle, FolderOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type { EditorScanItemSource } from "@/types/editor-scan"

type ScanItemCardProps = {
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  metadata?: Record<string, string>
  fullText?: string
}

function ScanItemCard({
  name,
  path: itemPath,
  source,
  preview,
  metadata,
  fullText,
}: ScanItemCardProps) {
  const [expanded, setExpanded] = useState(false)

  const handleOpenInFinder = () => {
    const bridge = getSynapseBridge()
    bridge?.shell.showItemInFolder(itemPath)
  }

  const metaEntries = metadata
    ? Object.entries(metadata).filter(([, v]) => v)
    : []

  return (
    <div className="border-b border-border last:border-b-0">
      <button
        type="button"
        className="flex w-full min-w-0 items-start gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <ChevronRight
          className={cn(
            "mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-90",
          )}
        />
        {source === "synapse" ? (
          <Diamond className="mt-0.5 size-3.5 shrink-0 text-primary" />
        ) : (
          <Circle className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{name}</span>
            <Badge variant={source === "synapse" ? "default" : "secondary"} className="shrink-0 text-[10px] px-1.5 py-0">
              {source === "synapse" ? "Synapse" : "外部"}
            </Badge>
          </div>
          {!expanded && preview ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{preview.split("\n")[0]}</p>
          ) : null}
          {!expanded && metaEntries.length > 0 ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
            </p>
          ) : null}
        </div>
      </button>

      {expanded ? (
        <div className="px-3 pb-3 pl-12">
          {metaEntries.length > 0 ? (
            <div className="mb-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {metaEntries.map(([k, v]) => (
                <span key={k}>{k}: {v}</span>
              ))}
            </div>
          ) : null}
          <ScrollArea className="max-h-80">
            <pre className="whitespace-pre-wrap break-all text-xs text-foreground/80">
              {fullText || preview || "（无内容）"}
            </pre>
          </ScrollArea>
          <button
            type="button"
            className="mt-2 flex max-w-full items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={(e) => {
              e.stopPropagation()
              handleOpenInFinder()
            }}
          >
            <FolderOpen className="size-3 shrink-0" />
            <span className="truncate">{itemPath}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}

export { ScanItemCard }
