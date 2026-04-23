import { Fragment } from "react"
import { FolderPlus } from "lucide-react"
import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { getEditorIconSrc, EDITOR_ICON_CLIP_STYLE } from "@/lib/editor-icons"
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
  const { promise } = useAppNotifications()

  const loadDirectories = useCallback(() => {
    requireSynapseBridge()
      .editor.getGlobalDirectories()
      .then(setDirectories)
      .catch((error) => {
        logger.error("Failed to load editor global directories.", error)
      })
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

  return { directories, handleOpen, handleCreate }
}

function EditorDirectoriesContent() {
  const { directories, handleOpen, handleCreate } = useEditorDirectories()

  if (directories.length === 0) {
    return null
  }

  return (
    <>
      {directories.map((dir, index) => (
        <Fragment key={dir.editorId}>
          {index > 0 ? <Separator /> : null}
          <div className="flex flex-col gap-3 px-4 py-3">
            <div className="flex items-center gap-2 font-medium">
              {(() => {
                const iconSrc = getEditorIconSrc(dir.editorId)
                return iconSrc ? (
                  <img src={iconSrc} alt={dir.label} className="size-5 shrink-0" style={EDITOR_ICON_CLIP_STYLE} />
                ) : null
              })()}
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
