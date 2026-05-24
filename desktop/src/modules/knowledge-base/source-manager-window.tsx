import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  MoveRight,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type {
  SynapseKnowledgeBaseOpenSourceManagerPayload,
  SynapseKnowledgeBaseRawEntry,
} from "@/types/knowledge-base"

const logger = createRendererLogger("knowledge-base.source-manager")

function readWindowPayload(): SynapseKnowledgeBaseOpenSourceManagerPayload | null {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get("projectId")
  const projectName = params.get("projectName")
  if (!projectId || !projectName) {
    return null
  }
  return { projectId, projectName }
}

function formatBytes(size: number | null): string {
  if (size === null) return "-"
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

function formatModifiedAt(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function matchesSearch(entry: SynapseKnowledgeBaseRawEntry, keyword: string): boolean {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return true
  return `${entry.name}\n${entry.relativePath}`.toLowerCase().includes(normalized)
}

function parentPath(directoryPath: string): string {
  const parts = directoryPath.split("/").filter(Boolean)
  return parts.slice(0, -1).join("/")
}

function breadcrumbItems(directoryPath: string): Array<{ label: string; path: string }> {
  const parts = directoryPath.split("/").filter(Boolean)
  return [
    { label: "资料", path: "" },
    ...parts.map((part, index) => ({
      label: part,
      path: parts.slice(0, index + 1).join("/"),
    })),
  ]
}

function KnowledgeBaseSourceManagerWindow() {
  const payload = useMemo(readWindowPayload, [])
  const { error: showError, promise } = useAppNotifications()
  const [entries, setEntries] = useState<SynapseKnowledgeBaseRawEntry[]>([])
  const [currentDirectory, setCurrentDirectory] = useState("")
  const [query, setQuery] = useState("")
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [createFolderOpen, setCreateFolderOpen] = useState(false)
  const [newFolderName, setNewFolderName] = useState("")
  const [renameTarget, setRenameTarget] = useState<SynapseKnowledgeBaseRawEntry | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTargetPath, setMoveTargetPath] = useState("")
  const [trashPaths, setTrashPaths] = useState<string[]>([])
  const bridge = getSynapseBridge()

  const refreshDirectory = useCallback(async () => {
    if (!payload || !bridge) return
    setIsLoading(true)
    try {
      const result = await bridge.knowledgeBase.listRawDirectory({
        projectId: payload.projectId,
        directoryPath: currentDirectory,
      })
      setEntries(result.entries)
    } catch (error) {
      logger.error("Failed to load knowledge base raw directory.", { error })
      showError("读取资料失败")
    } finally {
      setIsLoading(false)
    }
  }, [bridge, currentDirectory, payload, showError])

  useEffect(() => {
    void refreshDirectory()
  }, [refreshDirectory])

  useEffect(() => {
    setSelectedPaths(new Set())
  }, [currentDirectory])

  const visibleEntries = useMemo(
    () => entries.filter((entry) => matchesSearch(entry, query)),
    [entries, query],
  )

  const selectedList = useMemo(() => Array.from(selectedPaths), [selectedPaths])

  const uploadFiles = useCallback(async (filePaths: string[]) => {
    if (!payload || !bridge || filePaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.uploadRawFiles({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
          filePaths,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => result.entries.length > 0 ? "已上传" : "没有可上传的文件",
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])

  const chooseFiles = useCallback(async () => {
    if (!payload || !bridge) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.selectAndUploadRawFiles({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => result.entries.length > 0 ? "已上传" : null,
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])

  const createFolder = useCallback(async () => {
    if (!payload || !bridge) return
    const name = newFolderName.trim()
    if (!name) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.createRawFolder({
          projectId: payload.projectId,
          parentDirectoryPath: currentDirectory,
          name,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在新建",
        success: "已新建",
        error: "新建失败",
      },
    )
    setNewFolderName("")
    setCreateFolderOpen(false)
  }, [bridge, currentDirectory, newFolderName, payload, promise, refreshDirectory])

  const renameEntry = useCallback(async () => {
    if (!payload || !bridge || !renameTarget) return
    const newName = renameValue.trim()
    if (!newName) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.renameRawEntry({
          projectId: payload.projectId,
          relativePath: renameTarget.relativePath,
          newName,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在重命名",
        success: "已重命名",
        error: "重命名失败",
      },
    )
    setRenameTarget(null)
    setRenameValue("")
  }, [bridge, payload, promise, refreshDirectory, renameTarget, renameValue])

  const moveSelected = useCallback(async () => {
    if (!payload || !bridge || selectedList.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.moveRawEntries({
          projectId: payload.projectId,
          relativePaths: selectedList,
          targetDirectoryPath: moveTargetPath.trim(),
        })
        setSelectedPaths(new Set())
        await refreshDirectory()
        return result
      },
      {
        loading: "正在移动",
        success: "已移动",
        error: "移动失败",
      },
    )
    setMoveTargetPath("")
    setMoveOpen(false)
  }, [bridge, moveTargetPath, payload, promise, refreshDirectory, selectedList])

  const trashSelected = useCallback(async () => {
    if (!payload || !bridge || trashPaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.trashRawEntries({
          projectId: payload.projectId,
          relativePaths: trashPaths,
        })
        setSelectedPaths(new Set())
        await refreshDirectory()
        return result
      },
      {
        loading: "正在移到废纸篓",
        success: "已移到废纸篓",
        error: "移动失败",
      },
    )
    setTrashPaths([])
  }, [bridge, payload, promise, refreshDirectory, trashPaths])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (!bridge) return
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => bridge.knowledgeBase.filePathForDroppedFile(file))
      .filter((filePath): filePath is string => Boolean(filePath))
    void uploadFiles(filePaths)
  }, [bridge, uploadFiles])

  const toggleSelected = useCallback((relativePath: string, checked: boolean) => {
    setSelectedPaths((previous) => {
      const next = new Set(previous)
      if (checked) {
        next.add(relativePath)
      } else {
        next.delete(relativePath)
      }
      return next
    })
  }, [])

  const openRenameDialog = useCallback((entry: SynapseKnowledgeBaseRawEntry) => {
    setRenameTarget(entry)
    setRenameValue(entry.name)
  }, [])

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>无法打开资料</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </main>
    )
  }

  const breadcrumbs = breadcrumbItems(currentDirectory)

  return (
    <main
      aria-label="资料文件"
      className="flex h-screen flex-col bg-background text-foreground"
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border p-4">
        <nav aria-label="当前位置" className="flex min-w-0 items-center gap-1 text-sm">
          {breadcrumbs.map((item, index) => (
            <div key={item.path || "root"} className="flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-0"
                onClick={() => setCurrentDirectory(item.path)}
              >
                <span className="truncate">{item.label}</span>
              </Button>
            </div>
          ))}
        </nav>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            className="w-44"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setNewFolderName("")
              setCreateFolderOpen(true)
            }}
            aria-label="新建文件夹"
          >
            <FolderPlus data-icon="inline-start" />
            新建文件夹
          </Button>
          <Button type="button" variant="outline" onClick={chooseFiles} aria-label="选择文件">
            <Upload data-icon="inline-start" />
            选择文件
          </Button>
        </div>
      </header>

      <section
        aria-label="拖拽上传资料"
        className={cn("min-h-0 flex-1 overflow-auto", isDragging && "bg-accent")}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2">
          <div className="text-sm text-muted-foreground">{selectedList.length > 0 ? `已选择 ${selectedList.length} 项` : "拖拽文件到窗口"}</div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedList.length === 0}
              onClick={() => {
                setMoveTargetPath("")
                setMoveOpen(true)
              }}
              aria-label="移动所选"
            >
              <MoveRight data-icon="inline-start" />
              移动
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={selectedList.length === 0}
              onClick={() => setTrashPaths(selectedList)}
              aria-label="移到废纸篓"
            >
              <Trash2 data-icon="inline-start" />
              删除
            </Button>
          </div>
        </div>

        <Table className="table-fixed">
          <colgroup>
            <col className="w-12" />
            <col />
            <col className="w-28" />
            <col className="w-36" />
            <col className="w-14" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead />
              <TableHead>名称</TableHead>
              <TableHead className="text-right">大小</TableHead>
              <TableHead className="text-right">更新时间</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleEntries.map((entry) => (
              <TableRow key={entry.relativePath}>
                <TableCell>
                  <Checkbox
                    aria-label={`选择 ${entry.name}`}
                    checked={selectedPaths.has(entry.relativePath)}
                    onCheckedChange={(checked) => toggleSelected(entry.relativePath, checked === true)}
                  />
                </TableCell>
                <TableCell className="max-w-0 overflow-hidden">
                  {entry.kind === "directory" ? (
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-auto min-w-0 justify-start px-0 font-medium"
                      onClick={() => setCurrentDirectory(entry.relativePath)}
                      aria-label={`打开文件夹 ${entry.name}`}
                    >
                      <Folder data-icon="inline-start" />
                      <span className="truncate">{entry.name}</span>
                    </Button>
                  ) : (
                    <div className="flex min-w-0 items-center gap-2 font-medium">
                      <FileText className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{entry.name}</span>
                    </div>
                  )}
                  <div className="truncate text-xs text-muted-foreground">{entry.relativePath}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatBytes(entry.size)}</TableCell>
                <TableCell className="text-right text-muted-foreground">{formatModifiedAt(entry.modifiedAt)}</TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label={`更多 ${entry.name}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {entry.kind === "directory" ? (
                        <DropdownMenuItem onSelect={() => setCurrentDirectory(entry.relativePath)}>
                          <Folder />
                          打开
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem onSelect={() => openRenameDialog(entry)}>
                        <Pencil />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => {
                        setSelectedPaths(new Set([entry.relativePath]))
                        setMoveTargetPath(parentPath(entry.relativePath))
                        setMoveOpen(true)
                      }}>
                        <MoveRight />
                        移动
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onSelect={() => setTrashPaths([entry.relativePath])}>
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
            {visibleEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5}>
                  <Empty className="border-0">
                    <EmptyHeader>
                      <EmptyTitle>{isLoading ? "读取中" : query ? "没有匹配项" : "暂无资料"}</EmptyTitle>
                      <EmptyDescription>拖拽文件到窗口</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </section>

      <Dialog open={createFolderOpen} onOpenChange={setCreateFolderOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建文件夹</DialogTitle>
            <DialogDescription>输入名称。</DialogDescription>
          </DialogHeader>
          <Input
            value={newFolderName}
            onChange={(event) => setNewFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void createFolder()
            }}
            placeholder="文件夹名称"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateFolderOpen(false)}>取消</Button>
            <Button type="button" onClick={createFolder} aria-label="确认新建">新建</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renameTarget)} onOpenChange={(open) => {
        if (!open) setRenameTarget(null)
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
            <DialogDescription>输入新名称。</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void renameEntry()
            }}
            placeholder="新名称"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>取消</Button>
            <Button type="button" onClick={renameEntry} aria-label="确认重命名">重命名</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={moveOpen} onOpenChange={setMoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>移动</DialogTitle>
            <DialogDescription>留空移动到资料。</DialogDescription>
          </DialogHeader>
          <Input
            value={moveTargetPath}
            onChange={(event) => setMoveTargetPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void moveSelected()
            }}
            placeholder="目标文件夹"
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setMoveOpen(false)}>取消</Button>
            <Button type="button" onClick={moveSelected} aria-label="确认移动">移动</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={trashPaths.length > 0} onOpenChange={(open) => {
        if (!open) setTrashPaths([])
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移到废纸篓？</AlertDialogTitle>
            <AlertDialogDescription>所选项目会进入系统废纸篓。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={trashSelected} aria-label="确认移到废纸篓">
              移到废纸篓
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export { KnowledgeBaseSourceManagerWindow }
