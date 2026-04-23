import { Diamond, Circle, FolderOpen } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { EditorScanItemSource } from "@/types/editor-scan"

type ScanItemCardProps = {
  name: string
  path: string
  source: EditorScanItemSource
  preview: string
  metadata?: Record<string, string>
}

function ScanItemCard({
  name,
  path: itemPath,
  source,
  preview,
  metadata,
}: ScanItemCardProps) {
  const handleOpenInFinder = () => {
    const bridge = getSynapseBridge()
    bridge?.shell.showItemInFolder(itemPath)
  }

  const metaEntries = metadata
    ? Object.entries(metadata).filter(([, v]) => v)
    : []

  const firstLine = preview?.split("\n")[0] ?? ""

  return (
    <div className="group rounded-lg bg-muted/40 px-3.5 py-3 transition-colors hover:bg-muted/70">
      <div className="flex items-center gap-2">
        {source === "synapse" ? (
          <Diamond className="size-3.5 shrink-0 text-primary" />
        ) : (
          <Circle className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate text-sm font-medium">{name}</span>
        <Badge
          variant={source === "synapse" ? "default" : "secondary"}
          className="shrink-0 text-[10px] px-1.5 py-0"
        >
          {source === "synapse" ? "Synapse" : "外部"}
        </Badge>
      </div>
      {firstLine ? (
        <p className="mt-1 truncate pl-5.5 text-xs text-muted-foreground">
          {firstLine}
        </p>
      ) : null}
      {metaEntries.length > 0 ? (
        <p className="mt-0.5 truncate pl-5.5 text-xs text-muted-foreground">
          {metaEntries.map(([k, v]) => `${k}: ${v}`).join(" · ")}
        </p>
      ) : null}
      <button
        type="button"
        className="mt-1.5 flex max-w-full items-center gap-1 pl-5.5 text-xs text-muted-foreground/50 hover:text-foreground transition-colors"
        onClick={handleOpenInFinder}
      >
        <FolderOpen className="size-3 shrink-0" />
        <span className="truncate">{itemPath}</span>
      </button>
    </div>
  )
}

export { ScanItemCard }
