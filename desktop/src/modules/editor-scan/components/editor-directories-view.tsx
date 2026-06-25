import { FolderPlus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { getEditorLabel } from "@/lib/editor-registry"
import type { SynapseEditorId } from "@/types/editor"
import { useEditorDirectories } from "../hooks/use-editor-directories"

type EditorDirectoriesViewProps = {
  readonly selectedEditorId: SynapseEditorId
}

type DirectoryRowProps = {
  readonly label: string
  readonly dirPath: string | null
  readonly exists: boolean
  readonly onOpen: (dirPath: string) => void
  readonly onCreate: (dirPath: string) => void
}

function EditorDirectoriesView({ selectedEditorId }: EditorDirectoriesViewProps) {
  const { directories, isLoading, error, handleOpen, handleCreate, reload } = useEditorDirectories()

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2 p-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={reload}>重试</Button>
      </div>
    )
  }

  const directory = directories.find((entry) => entry.editorId === selectedEditorId)

  if (!directory) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        未检测到编辑器目录
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col p-2">
      <div className="flex shrink-0 items-center gap-2 px-1 py-2">
        <h2 className="text-lg font-semibold">{directory.label || getEditorLabel(selectedEditorId)}</h2>
      </div>
      <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
        <DirectoryRow
          label="全局规则"
          dirPath={directory.rulesPath}
          exists={directory.rulesExists}
          onOpen={handleOpen}
          onCreate={handleCreate}
        />
        <DirectoryRow
          label="全局技能"
          dirPath={directory.skillsPath}
          exists={directory.skillsExists}
          onOpen={handleOpen}
          onCreate={handleCreate}
        />
      </div>
    </div>
  )
}

function DirectoryRow({ label, dirPath, exists, onOpen, onCreate }: DirectoryRowProps) {
  if (!dirPath) {
    return (
      <div className="grid min-h-10 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">不支持</span>
        <span aria-hidden="true" />
      </div>
    )
  }

  return (
    <div className="grid min-h-10 grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0">
      <span className="font-medium">{label}</span>
      <span className="min-w-0 truncate text-muted-foreground" title={dirPath}>
        {dirPath}
      </span>
      {exists ? (
        <Button variant="outline" size="sm" onClick={() => onOpen(dirPath)}>
          打开
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={() => onCreate(dirPath)}>
          <FolderPlus data-icon="inline-start" />
          创建并打开
        </Button>
      )}
    </div>
  )
}

export { EditorDirectoriesView }
