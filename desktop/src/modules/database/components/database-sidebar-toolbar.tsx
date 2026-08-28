import type { Ref } from "react"
import { FileInput, FolderPlus, AlignLeft, Type, Text } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type DisplayMode = "title+desc" | "title" | "desc"

const DISPLAY_MODE_CYCLE: DisplayMode[] = ["title+desc", "title", "desc"]
const DISPLAY_MODE_LABELS: Record<DisplayMode, string> = {
  "title+desc": "显示标题和介绍",
  "title": "仅显示标题",
  "desc": "仅显示介绍",
}
const DISPLAY_MODE_ICONS: Record<DisplayMode, typeof AlignLeft> = {
  "title+desc": AlignLeft,
  "title": Type,
  "desc": Text,
}

type DatabaseSidebarToolbarProps = {
  displayMode: DisplayMode
  onDisplayModeChange: (mode: DisplayMode) => void
  onImportTable: () => void
  onCreateFolder: () => void
  createFolderButtonRef?: Ref<HTMLButtonElement>
}

function DatabaseSidebarToolbar({
  displayMode,
  onDisplayModeChange,
  onImportTable,
  onCreateFolder,
  createFolderButtonRef,
}: DatabaseSidebarToolbarProps) {
  const DisplayModeIcon = DISPLAY_MODE_ICONS[displayMode]

  function handleDisplayModeToggle() {
    const currentIndex = DISPLAY_MODE_CYCLE.indexOf(displayMode)
    const nextIndex = (currentIndex + 1) % DISPLAY_MODE_CYCLE.length
    onDisplayModeChange(DISPLAY_MODE_CYCLE[nextIndex])
  }

  return (
    <TooltipProvider>
    <div className="flex items-center gap-0.5 px-1">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onImportTable}
            data-track="database-import-table-open"
          >
            <FileInput className="size-3.5" />
            <span className="sr-only">导入表</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>导入表</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            ref={createFolderButtonRef}
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={onCreateFolder}
            data-track="database-create-folder"
          >
            <FolderPlus className="size-3.5" />
            <span className="sr-only">新建文件夹</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>新建文件夹</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={handleDisplayModeToggle}
            data-track="database-display-mode-toggle"
          >
            <DisplayModeIcon className="size-3.5" />
            <span className="sr-only">{DISPLAY_MODE_LABELS[displayMode]}</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{DISPLAY_MODE_LABELS[displayMode]}</TooltipContent>
      </Tooltip>
    </div>
    </TooltipProvider>
  )
}

export { DatabaseSidebarToolbar, DISPLAY_MODE_CYCLE, DISPLAY_MODE_LABELS }
export type { DisplayMode }
