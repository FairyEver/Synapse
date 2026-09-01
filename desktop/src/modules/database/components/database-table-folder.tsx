import { useState, type MouseEvent } from "react"
import { Folder, FolderOpen, X } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { cn } from "@/lib/utils"
import type { DatabaseFolder } from "@/types/database"

type DatabaseTableFolderProps = {
  folder: DatabaseFolder
  children: React.ReactNode
  onRename: (id: number) => void
  onDelete: (id: number, event: MouseEvent<HTMLElement>) => void
  onDrop: (tableName: string, folderId: number) => void
}

function DatabaseTableFolder({
  folder,
  children,
  onRename,
  onDelete,
  onDrop,
}: DatabaseTableFolderProps) {
  const [open, setOpen] = useState(true)
  const [dragOver, setDragOver] = useState(false)

  function handleDragOver(event: React.DragEvent) {
    if (!event.dataTransfer.types.includes("application/x-synapse-table")) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
    setDragOver(true)
  }

  function handleDragLeave() {
    setDragOver(false)
  }

  function handleDrop(event: React.DragEvent) {
    setDragOver(false)
    const tableName = event.dataTransfer.getData("application/x-synapse-table")
    if (tableName) {
      onDrop(tableName, folder.id)
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-track="database.folder.drop"
          data-track-native="true"
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <Collapsible open={open} onOpenChange={setOpen}>
            <div
              className={cn(
                "group/folder flex h-8 w-full items-center justify-between rounded-lg px-3 transition-colors",
                dragOver && "bg-accent",
              )}
            >
              <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm font-medium text-foreground/80 outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/50">
                {open ? (
                  <FolderOpen className="size-4 shrink-0" />
                ) : (
                  <Folder className="size-4 shrink-0" />
                )}
                <span className="truncate">{folder.name}</span>
              </CollapsibleTrigger>
              <button
                data-track="database.folder.delete"
                data-track-native="true"
                type="button"
                className="rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover/folder:opacity-100"
                onClick={(event) => onDelete(folder.id, event)}
                title="删除文件夹"
              >
                <X className="size-3" />
                <span className="sr-only">删除文件夹</span>
              </button>
            </div>
            <CollapsibleContent>
              <div className="flex flex-col pl-3">
                {children}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={() => onRename(folder.id)}>
          重命名
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          onClick={(event) => onDelete(folder.id, event)}
        >
          删除文件夹
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export { DatabaseTableFolder }
