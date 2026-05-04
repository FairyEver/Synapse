import { Fragment } from "react"
import { FolderPlus, LoaderCircle } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { EditorIcon } from "@/components/editor-icon"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseEditorGlobalDirectory } from "@/types/editor"

const logger = createRendererLogger("settings.editors")

type DirectoryRowProps = {
  label: string
  dirPath: string | null
  exists: boolean
  editorLabel: string
  onOpen: (dirPath: string) => void
  onCreate: (dirPath: string) => void
}

function DirectoryRow({ label, dirPath, exists, editorLabel, onOpen, onCreate }: DirectoryRowProps) {
  if (!dirPath) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{label}：</span>
        <span className="truncate italic">
          {editorLabel} 暂不支持{label}目录
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="shrink-0">{label}：</span>
      {exists ? (
        <button
          type="button"
          className="min-w-0 truncate text-left text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          title={dirPath}
          onClick={() => onOpen(dirPath)}
        >
          {dirPath}
        </button>
      ) : (
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-muted-foreground/60" title={dirPath}>
            {dirPath}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 shrink-0 gap-1 px-2 text-xs"
            onClick={() => onCreate(dirPath)}
          >
            <FolderPlus className="size-3" />
            创建并打开
          </Button>
        </span>
      )}
    </div>
  )
}

function useEditorDirectories() {
  const [directories, setDirectories] = useState<SynapseEditorGlobalDirectory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const { promise } = useAppNotifications()

  const loadDirectories = useCallback(() => {
    setIsLoading(true)
    setError(null)
    requireSynapseBridge()
      .editor.getGlobalDirectories()
      .then(setDirectories)
      .catch((err) => {
        logger.error("Failed to load editor global directories.", err)
        setError("加载编辑器目录失败")
      })
      .finally(() => setIsLoading(false))
  }, [])

  useEffect(() => {
    loadDirectories()
  }, [loadDirectories])

  const handleOpen = useCallback((dirPath: string) => {
    logger.info("Opening editor directory.", { path: dirPath })
    window.synapse?.shell.showItemInFolder(dirPath)
  }, [])

  const handleCreate = useCallback(
    async (dirPath: string) => {
      logger.info("Creating editor directory.", { path: dirPath })
      await promise(
        async () => {
          await requireSynapseBridge().editor.createDirectory(dirPath)
          loadDirectories()
        },
        {
          loading: "正在创建目录...",
          success: () => "目录已创建。",
          error: (err) => (err instanceof Error ? err.message : "创建目录失败。"),
        },
      )
    },
    [loadDirectories, promise],
  )

  return { directories, isLoading, error, handleOpen, handleCreate, reload: loadDirectories }
}

function EditorDirectoriesContent() {
  const { directories, isLoading, error, handleOpen, handleCreate, reload } = useEditorDirectories()

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        正在加载编辑器目录
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
        <p>{error}</p>
        <Button variant="outline" size="sm" onClick={reload}>重试</Button>
      </div>
    )
  }

  if (directories.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-muted-foreground">
        未检测到编辑器目录
      </div>
    )
  }

  return (
    <>
      {directories.map((dir, index) => (
        <Fragment key={dir.editorId}>
          {index > 0 ? <Separator /> : null}
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-2 font-medium">
              <EditorIcon editorId={dir.editorId} />
              {dir.label}
            </div>
            <div className="flex flex-col gap-1.5">
              <DirectoryRow
                label="全局规则"
                dirPath={dir.rulesPath}
                exists={dir.rulesExists}
                editorLabel={dir.label}
                onOpen={handleOpen}
                onCreate={handleCreate}
              />
              <DirectoryRow
                label="全局技能"
                dirPath={dir.skillsPath}
                exists={dir.skillsExists}
                editorLabel={dir.label}
                onOpen={handleOpen}
                onCreate={handleCreate}
              />
            </div>
          </div>
        </Fragment>
      ))}
    </>
  )
}

export { EditorDirectoriesContent }
