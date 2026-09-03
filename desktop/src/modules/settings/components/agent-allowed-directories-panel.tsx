import { useCallback, useMemo, useState } from "react"
import { FolderPlus, Trash2 } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { requireBridgeDomain } from "@/lib/electron-bridge"

const logger = createRendererLogger("settings.agent-allowed-directories")

function AgentAllowedDirectoriesPanel() {
  const { config, updateConfig } = useAppConfig()
  const { promise, warning } = useAppNotifications()
  const [isSelecting, setIsSelecting] = useState(false)
  const directories = config.agent.allowedWriteDirectories
  const directorySet = useMemo(() => new Set(directories), [directories])

  const saveDirectories = useCallback(async (nextDirectories: string[]) => {
    await promise(
      () => updateConfig({ agent: { allowedWriteDirectories: nextDirectories } }),
      {
        trackingName: "settings.agent.allowed-write-directories.save",
        loading: "正在保存设置...",
        success: () => "设置已保存。",
        error: (error) => error instanceof Error ? error.message : "保存设置失败。",
      },
    )
  }, [promise, updateConfig])

  const addDirectory = useCallback(async () => {
    setIsSelecting(true)
    try {
      const selectedPath = await requireBridgeDomain("settings").repository.chooseDirectory()
      if (!selectedPath) return
      if (directorySet.has(selectedPath)) {
        warning("该路径已在列表中。")
        return
      }
      await saveDirectories([...directories, selectedPath])
    } catch (error) {
      logger.error("Failed to add an agent allowed directory.", error)
    } finally {
      setIsSelecting(false)
    }
  }, [directorySet, directories, saveDirectories, warning])

  const removeDirectory = useCallback(async (directory: string) => {
    try {
      await saveDirectories(directories.filter((item) => item !== directory))
    } catch (error) {
      logger.error("Failed to remove an agent allowed directory.", error)
    }
  }, [directories, saveDirectories])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base">路径白名单</CardTitle>
            <CardDescription>允许 AI 在这些文件夹中读写文件。</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => void addDirectory()}
            disabled={isSelecting}
          >
            <FolderPlus />
            添加路径
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {directories.length === 0 ? (
          <p className="text-sm text-muted-foreground">尚未添加路径。</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {directories.map((directory) => (
              <div key={directory} className="flex items-center gap-2 px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm" title={directory}>{directory}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="shrink-0"
                  aria-label={`删除路径 ${directory}`}
                  onClick={() => void removeDirectory(directory)}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export { AgentAllowedDirectoriesPanel }
