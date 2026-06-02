import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
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
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { cn } from "@/lib/utils"
import type {
  SynapseKnowledgeBaseOpenSourceManagerPayload,
  SynapseKnowledgeBaseRawEntry,
  SynapseKnowledgeBaseRawMutationResult,
} from "@/types/knowledge-base"

const logger = createRendererLogger("knowledge-base.source-manager")
type DirectoryTree = Record<string, SynapseKnowledgeBaseRawEntry[]>
type TreeRenderer = (items: SynapseKnowledgeBaseRawEntry[]) => ReactNode
type PendingRawMove = {
  relativePaths: string[]
  targetDirectoryPath: string
}

type SourceManagerSidebarProps = {
  currentDirectory: string
  rootItems: SynapseKnowledgeBaseRawEntry[]
  renderTreeItems: TreeRenderer
  onOpenRoot: () => void
}

type SourceManagerToolbarProps = {
  breadcrumbs: Array<{ label: string; path: string }>
  query: string
  onQueryChange: (query: string) => void
  onNavigate: (path: string) => void
  onCreateFolder: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
}

type SourceSelectionBarProps = {
  selectedCount: number
  onMove: () => void
  onExport: () => void
  onTrash: () => void
}

type SourceEntryListProps = {
  entries: SynapseKnowledgeBaseRawEntry[]
  isLoading: boolean
  query: string
  selectedPaths: Set<string>
  onToggleSelected: (relativePath: string, checked: boolean) => void
  onOpenDirectory: (relativePath: string) => void
  onRename: (entry: SynapseKnowledgeBaseRawEntry) => void
  onMoveEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onExportEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onTrashEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  internalDropTarget: string | null
  onDragEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onDragEnd: () => void
  onInternalDragOverDirectory: (targetDirectoryPath: string | null) => void
  onDropOnDirectory: (targetDirectoryPath: string) => void
}

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

function formatEntryMeta(entry: SynapseKnowledgeBaseRawEntry): string {
  const primary = entry.kind === "directory" ? "文件夹" : formatBytes(entry.size)
  return `${primary} · ${formatModifiedAt(entry.modifiedAt)}`
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

function directoriesOnly(entries: SynapseKnowledgeBaseRawEntry[]): SynapseKnowledgeBaseRawEntry[] {
  return entries.filter((entry) => entry.kind === "directory")
}

function sourceUploadSuccessMessage(
  result: SynapseKnowledgeBaseRawMutationResult,
  emptyMessage: string | null,
): string | null {
  if (result.skipped.length > 0) {
    const skippedSummary = skippedReasonSummary(result.skipped)
    if (result.entries.length > 0) {
      return `已上传 ${result.entries.length} 项，跳过 ${result.skipped.length} 项${skippedSummary}`
    }
    return `跳过 ${result.skipped.length} 项${skippedSummary}`
  }
  return result.entries.length > 0 ? "已上传" : emptyMessage
}

function skippedReasonSummary(result: readonly { reason: string }[]): string {
  const counts = result.reduce<Record<string, number>>((next, item) => {
    next[item.reason] = (next[item.reason] ?? 0) + 1
    return next
  }, {})
  const parts = Object.entries(counts).map(([reason, count]) => `${skippedReasonLabel(reason)} ${count}`)
  return parts.length > 0 ? `（${parts.join("，")}）` : ""
}

function skippedReasonLabel(reason: string): string {
  switch (reason) {
    case "not-file":
      return "不是文件"
    case "not-directory":
      return "不是文件夹"
    case "read-error":
      return "读取失败"
    case "conversion-error":
      return "转换失败"
    case "invalid-path":
      return "路径无效"
    case "collision":
      return "目标已存在"
    case "trash-error":
      return "删除失败"
    case "symlink":
      return "符号链接"
    case "system-noise":
      return "系统文件"
    case "export-error":
      return "导出失败"
    default:
      return "跳过"
  }
}

function hasDirectoryCache(tree: DirectoryTree, directoryPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(tree, directoryPath)
}

function uniqueDirectoryPaths(directoryPaths: readonly string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const directoryPath of directoryPaths) {
    if (seen.has(directoryPath)) continue
    seen.add(directoryPath)
    result.push(directoryPath)
  }
  return result
}

function isPathOrDescendant(path: string, rootPath: string): boolean {
  if (!rootPath) return path === ""
  return path === rootPath || path.startsWith(`${rootPath}/`)
}

function canMoveRawPathsToTarget(relativePaths: readonly string[], targetDirectoryPath: string): boolean {
  return relativePaths.length > 0 && relativePaths.every((relativePath) => (
    relativePath !== targetDirectoryPath && !targetDirectoryPath.startsWith(`${relativePath}/`)
  ))
}

function needsRawMutationConfirmation(
  entries: SynapseKnowledgeBaseRawEntry[],
  relativePaths: string[],
): boolean {
  if (relativePaths.length > 1) return true
  const selected = new Set(relativePaths)
  return entries.some((entry) => selected.has(entry.relativePath) && entry.kind === "directory")
}

function SourceManagerSidebar({
  currentDirectory,
  rootItems,
  renderTreeItems,
  onOpenRoot,
}: SourceManagerSidebarProps) {
  return (
    <aside aria-label="文件夹树" className="flex w-64 shrink-0 flex-col border-r border-border bg-muted/30 p-3">
      <div className="px-2 py-2 text-sm font-semibold">资料</div>
      <div className="flex flex-col gap-1">
        <Button
          type="button"
          variant={currentDirectory === "" ? "secondary" : "ghost"}
          className="justify-start"
          onClick={onOpenRoot}
          aria-label="打开树文件夹 资料"
        >
          <Folder data-icon="inline-start" />
          资料
        </Button>
        {renderTreeItems(rootItems)}
      </div>
    </aside>
  )
}

function SourceManagerToolbar({
  breadcrumbs,
  query,
  onQueryChange,
  onNavigate,
  onCreateFolder,
  onUploadFiles,
  onUploadFolder,
}: SourceManagerToolbarProps) {
  return (
    <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
      <nav aria-label="当前位置" className="flex min-w-0 items-center gap-1 text-sm">
        {breadcrumbs.map((item, index) => (
          <div key={item.path || "root"} className="flex min-w-0 items-center gap-1">
            {index > 0 ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-w-0"
              onClick={() => onNavigate(item.path)}
            >
              <span className="truncate">{item.label}</span>
            </Button>
          </div>
        ))}
      </nav>
      <div className="flex shrink-0 items-center gap-2">
        <Input
          className="w-48"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索当前文件夹"
        />
        <Button type="button" variant="outline" onClick={onCreateFolder} aria-label="新建文件夹">
          <FolderPlus data-icon="inline-start" />
          新建文件夹
        </Button>
        <Button type="button" variant="outline" onClick={onUploadFiles} aria-label="上传文件">
          <Upload data-icon="inline-start" />
          上传文件
        </Button>
        <Button type="button" variant="outline" onClick={onUploadFolder} aria-label="上传文件夹">
          <FolderUp data-icon="inline-start" />
          上传文件夹
        </Button>
      </div>
    </header>
  )
}

function SourceSelectionBar({ selectedCount, onMove, onExport, onTrash }: SourceSelectionBarProps) {
  if (selectedCount === 0) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="text-sm text-muted-foreground">已选择 {selectedCount} 项</div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onMove} aria-label="移动所选">
          <MoveRight data-icon="inline-start" />
          移动
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onExport} aria-label="导出所选">
          <Download data-icon="inline-start" />
          导出
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={onTrash} aria-label="移到废纸篓">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </div>
    </div>
  )
}

function SourceEntryList({
  entries,
  isLoading,
  query,
  selectedPaths,
  onToggleSelected,
  onOpenDirectory,
  onRename,
  onMoveEntry,
  onExportEntry,
  onTrashEntry,
  internalDropTarget,
  onDragEntry,
  onDragEnd,
  onInternalDragOverDirectory,
  onDropOnDirectory,
}: SourceEntryListProps) {
  if (entries.length === 0) {
    return (
      <Empty className="border-0 py-16">
        <EmptyHeader>
          <EmptyTitle>{isLoading ? "读取中" : query ? "没有匹配项" : "没有文件"}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div role="list" aria-label="资料列表" className="divide-y divide-border">
      {entries.map((entry) => {
        const selected = selectedPaths.has(entry.relativePath)
        return (
          <div
            key={entry.relativePath}
            role="listitem"
            className={cn(
              "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-1 py-2",
              internalDropTarget === entry.relativePath && "bg-accent",
            )}
            data-raw-path={entry.relativePath}
            data-raw-drop-target={entry.kind === "directory" ? entry.relativePath : undefined}
            draggable
            onDragStart={(event) => {
              event.stopPropagation()
              onDragEntry(entry)
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              event.stopPropagation()
              onInternalDragOverDirectory(entry.relativePath)
            }}
            onDrop={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              event.stopPropagation()
              onDropOnDirectory(entry.relativePath)
            }}
          >
            <Checkbox
              aria-label={`选择 ${entry.name}`}
              checked={selected}
              onCheckedChange={(checked) => onToggleSelected(entry.relativePath, checked === true)}
            />
            <div className="flex min-w-0 items-center gap-3">
              {entry.kind === "directory" ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                {entry.kind === "directory" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 justify-start px-0 py-0 font-medium"
                    onClick={() => onOpenDirectory(entry.relativePath)}
                    aria-label={`打开文件夹 ${entry.name}`}
                  >
                    <span className="truncate">{entry.name}</span>
                  </Button>
                ) : (
                  <div className="truncate text-sm font-medium">{entry.name}</div>
                )}
                <div className="truncate text-xs text-muted-foreground">{formatEntryMeta(entry)}</div>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={`更多 ${entry.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {entry.kind === "directory" ? (
                  <DropdownMenuItem onSelect={() => onOpenDirectory(entry.relativePath)}>
                    <Folder />
                    打开
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onSelect={() => onRename(entry)}>
                  <Pencil />
                  重命名
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onMoveEntry(entry)}>
                  <MoveRight />
                  移动
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onExportEntry(entry)}>
                  <Download />
                  导出
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => onTrashEntry(entry)}>
                  <Trash2 />
                  删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
    </div>
  )
}

function KnowledgeBaseSourceManagerWindow() {
  const payload = useMemo(readWindowPayload, [])
  const { error: showError, promise } = useAppNotifications()
  const [entries, setEntries] = useState<SynapseKnowledgeBaseRawEntry[]>([])
  const [directoryTree, setDirectoryTree] = useState<DirectoryTree>({})
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set([""]))
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
  const [pendingMove, setPendingMove] = useState<PendingRawMove | null>(null)
  const [trashPaths, setTrashPaths] = useState<string[]>([])
  const [internalDragPaths, setInternalDragPaths] = useState<string[]>([])
  const [internalDropTarget, setInternalDropTarget] = useState<string | null>(null)
  const internalDragPathsRef = useRef<string[]>([])
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
      setDirectoryTree((previous) => ({
        ...previous,
        [currentDirectory]: directoriesOnly(result.entries),
      }))
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

  const pruneTreeDirectories = useCallback((directoryPaths: readonly string[]) => {
    const stalePaths = uniqueDirectoryPaths(directoryPaths.filter(Boolean))
    if (stalePaths.length === 0) return
    setDirectoryTree((previous) => {
      const next = { ...previous }
      let changed = false
      for (const cachedPath of Object.keys(previous)) {
        if (stalePaths.some((stalePath) => isPathOrDescendant(cachedPath, stalePath))) {
          delete next[cachedPath]
          changed = true
        }
      }
      return changed ? next : previous
    })
  }, [])

  const refreshTreeDirectories = useCallback(async (directoryPaths: readonly string[]) => {
    if (!payload || !bridge) return
    const pathsToRefresh = uniqueDirectoryPaths(directoryPaths)
    if (pathsToRefresh.length === 0) return
    try {
      const results = await Promise.all(pathsToRefresh.map(async (directoryPath) => {
        const result = await bridge.knowledgeBase.listRawDirectory({
          projectId: payload.projectId,
          directoryPath,
        })
        return [directoryPath, directoriesOnly(result.entries)] as const
      }))
      setDirectoryTree((previous) => {
        const next = { ...previous }
        for (const [directoryPath, childDirectories] of results) {
          next[directoryPath] = childDirectories
        }
        return next
      })
    } catch (error) {
      logger.error("Failed to refresh knowledge base raw tree directories.", { error })
      showError("读取资料失败")
    }
  }, [bridge, payload, showError])

  const loadTreeDirectory = useCallback(async (directoryPath: string) => {
    if (!payload || !bridge || hasDirectoryCache(directoryTree, directoryPath)) return
    try {
      const result = await bridge.knowledgeBase.listRawDirectory({
        projectId: payload.projectId,
        directoryPath,
      })
      setDirectoryTree((previous) => ({
        ...previous,
        [directoryPath]: directoriesOnly(result.entries),
      }))
    } catch (error) {
      logger.error("Failed to load knowledge base raw tree directory.", { error })
      showError("读取资料失败")
    }
  }, [bridge, directoryTree, payload, showError])

  const openTreeDirectory = useCallback((directoryPath: string) => {
    setCurrentDirectory(directoryPath)
    setExpandedDirectories((previous) => new Set([...previous, directoryPath]))
    void loadTreeDirectory(directoryPath)
  }, [loadTreeDirectory])

  const toggleTreeDirectory = useCallback((directoryPath: string) => {
    setExpandedDirectories((previous) => {
      const next = new Set(previous)
      if (next.has(directoryPath)) {
        next.delete(directoryPath)
      } else {
        next.add(directoryPath)
        void loadTreeDirectory(directoryPath)
      }
      return next
    })
  }, [loadTreeDirectory])

  const visibleEntries = useMemo(
    () => entries.filter((entry) => matchesSearch(entry, query)),
    [entries, query],
  )

  const selectedList = useMemo(() => Array.from(selectedPaths), [selectedPaths])

  const uploadItems = useCallback(async (itemPaths: string[]) => {
    if (!payload || !bridge || itemPaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.uploadRawItems({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
          itemPaths,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, "没有可上传的文件"),
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
        success: (result) => sourceUploadSuccessMessage(result, null),
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])

  const chooseFolder = useCallback(async () => {
    if (!payload || !bridge) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.selectAndUploadRawDirectory({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
        })
        await refreshDirectory()
        return result
      },
      {
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, null),
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
        if (renameTarget.kind === "directory") {
          pruneTreeDirectories([renameTarget.relativePath])
        }
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
  }, [bridge, payload, promise, pruneTreeDirectories, refreshDirectory, renameTarget, renameValue])

  const runMoveRawEntries = useCallback(async (relativePaths: string[], targetDirectoryPath: string) => {
    if (!payload || !bridge || relativePaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.moveRawEntries({
          projectId: payload.projectId,
          relativePaths,
          targetDirectoryPath,
        })
        pruneTreeDirectories(relativePaths)
        setSelectedPaths(new Set())
        await refreshDirectory()
        if (targetDirectoryPath !== currentDirectory) {
          await refreshTreeDirectories([targetDirectoryPath])
        }
        return result
      },
      {
        loading: "正在移动",
        success: "已移动",
        error: "移动失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, pruneTreeDirectories, refreshDirectory, refreshTreeDirectories])

  const moveSelected = useCallback(async () => {
    if (selectedList.length === 0) return
    const targetDirectoryPath = moveTargetPath.trim()
    if (needsRawMutationConfirmation(entries, selectedList)) {
      setPendingMove({ relativePaths: selectedList, targetDirectoryPath })
      setMoveOpen(false)
      return
    }
    await runMoveRawEntries(selectedList, targetDirectoryPath)
    setMoveTargetPath("")
    setMoveOpen(false)
  }, [entries, moveTargetPath, runMoveRawEntries, selectedList])

  const runTrashRawEntries = useCallback(async (relativePaths: string[]) => {
    if (!payload || !bridge || relativePaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.trashRawEntries({
          projectId: payload.projectId,
          relativePaths,
        })
        pruneTreeDirectories(relativePaths)
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
  }, [bridge, payload, promise, pruneTreeDirectories, refreshDirectory])

  const startInternalDrag = useCallback((entry: SynapseKnowledgeBaseRawEntry) => {
    const paths = selectedPaths.has(entry.relativePath) ? selectedList : [entry.relativePath]
    internalDragPathsRef.current = paths
    setInternalDragPaths(paths)
  }, [selectedList, selectedPaths])

  const endInternalDrag = useCallback(() => {
    internalDragPathsRef.current = []
    setInternalDragPaths([])
    setInternalDropTarget(null)
  }, [])

  const dropInternalDrag = useCallback(async (targetDirectoryPath: string) => {
    const paths = internalDragPathsRef.current
    internalDragPathsRef.current = []
    setInternalDragPaths([])
    setInternalDropTarget(null)
    if (!canMoveRawPathsToTarget(paths, targetDirectoryPath)) return
    await runMoveRawEntries(paths, targetDirectoryPath)
  }, [runMoveRawEntries])

  const exportEntries = useCallback(async (relativePaths: string[]) => {
    if (!payload || !bridge || relativePaths.length === 0) return
    await promise(
      async () => bridge.knowledgeBase.exportRawEntries({
        projectId: payload.projectId,
        relativePaths,
      }),
      {
        loading: "正在导出",
        success: "已导出",
        error: "导出失败",
      },
    )
  }, [bridge, payload, promise])

  const trashSelected = useCallback(async () => {
    await runTrashRawEntries(trashPaths)
    setTrashPaths([])
  }, [runTrashRawEntries, trashPaths])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (!bridge) return
    const itemPaths = Array.from(event.dataTransfer.files)
      .map((file) => bridge.knowledgeBase.filePathForDroppedFile(file))
      .filter((filePath): filePath is string => Boolean(filePath))
    void uploadItems(itemPaths)
  }, [bridge, uploadItems])

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

  const renderTreeItems = useCallback((items: SynapseKnowledgeBaseRawEntry[]) => (
    <div className="ml-4 flex flex-col gap-1">
      {items.map((entry) => {
        const isExpanded = expandedDirectories.has(entry.relativePath)
        const childItems = directoryTree[entry.relativePath] ?? []
        return (
          <div key={entry.relativePath} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleTreeDirectory(entry.relativePath)}
                aria-label={`${isExpanded ? "折叠" : "展开"} ${entry.name}`}
              >
                {isExpanded ? <ChevronDown /> : <ChevronRight />}
              </Button>
              <Button
                type="button"
                variant={currentDirectory === entry.relativePath ? "secondary" : "ghost"}
                size="sm"
                className="min-w-0 flex-1 justify-start"
                data-raw-drop-target={entry.relativePath}
                onClick={() => openTreeDirectory(entry.relativePath)}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (internalDragPaths.length > 0) {
                    setInternalDropTarget(entry.relativePath)
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  void dropInternalDrag(entry.relativePath)
                }}
                aria-label={`打开树文件夹 ${entry.name}`}
              >
                <Folder data-icon="inline-start" />
                <span className="truncate">{entry.name}</span>
              </Button>
            </div>
            {isExpanded && childItems.length > 0 ? renderTreeItems(childItems) : null}
          </div>
        )
      })}
    </div>
  ), [currentDirectory, directoryTree, dropInternalDrag, expandedDirectories, internalDragPaths.length, openTreeDirectory, toggleTreeDirectory])

  const renderMoveTreeItems = useCallback((items: SynapseKnowledgeBaseRawEntry[]) => (
    <div className="ml-4 flex flex-col gap-1">
      {items.map((entry) => {
        const isExpanded = expandedDirectories.has(entry.relativePath)
        const childItems = directoryTree[entry.relativePath] ?? []
        return (
          <div key={entry.relativePath} className="flex flex-col gap-1">
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => toggleTreeDirectory(entry.relativePath)}
                aria-label={`${isExpanded ? "折叠" : "展开"} ${entry.name}`}
              >
                {isExpanded ? <ChevronDown /> : <ChevronRight />}
              </Button>
              <Button
                type="button"
                variant={moveTargetPath === entry.relativePath ? "secondary" : "ghost"}
                size="sm"
                className="min-w-0 flex-1 justify-start"
                onClick={() => {
                  setMoveTargetPath(entry.relativePath)
                  void loadTreeDirectory(entry.relativePath)
                }}
                aria-label={`选择目标文件夹 ${entry.name}`}
              >
                <Folder data-icon="inline-start" />
                <span className="truncate">{entry.name}</span>
              </Button>
            </div>
            {isExpanded && childItems.length > 0 ? renderMoveTreeItems(childItems) : null}
          </div>
        )
      })}
    </div>
  ), [directoryTree, expandedDirectories, loadTreeDirectory, moveTargetPath, toggleTreeDirectory])

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
      className="flex h-screen bg-background text-foreground"
      onDragOver={(event) => {
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
    >
      <SourceManagerSidebar
        currentDirectory={currentDirectory}
        rootItems={directoryTree[""] ?? []}
        renderTreeItems={renderTreeItems}
        onOpenRoot={() => openTreeDirectory("")}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <SourceManagerToolbar
          breadcrumbs={breadcrumbs}
          query={query}
          onQueryChange={setQuery}
          onNavigate={setCurrentDirectory}
          onCreateFolder={() => {
            setNewFolderName("")
            setCreateFolderOpen(true)
          }}
          onUploadFiles={chooseFiles}
          onUploadFolder={chooseFolder}
        />

        <section
          aria-label="拖拽上传资料"
          className={cn("relative min-h-0 flex-1 overflow-auto", isDragging && "bg-accent/50")}
        >
          <div className="space-y-2 p-4">
            <SourceSelectionBar
              selectedCount={selectedList.length}
              onMove={() => {
                setMoveTargetPath("")
                setMoveOpen(true)
              }}
              onExport={() => void exportEntries(selectedList)}
              onTrash={() => setTrashPaths(selectedList)}
            />
            <SourceEntryList
              entries={visibleEntries}
              isLoading={isLoading}
              query={query}
              selectedPaths={selectedPaths}
              onToggleSelected={toggleSelected}
              onOpenDirectory={setCurrentDirectory}
              onRename={openRenameDialog}
              onMoveEntry={(entry) => {
                setSelectedPaths(new Set([entry.relativePath]))
                setMoveTargetPath(parentPath(entry.relativePath))
                setMoveOpen(true)
              }}
              onExportEntry={(entry) => void exportEntries([entry.relativePath])}
              onTrashEntry={(entry) => setTrashPaths([entry.relativePath])}
              internalDropTarget={internalDropTarget}
              onDragEntry={startInternalDrag}
              onDragEnd={endInternalDrag}
              onInternalDragOverDirectory={(targetDirectoryPath) => {
                if (internalDragPaths.length > 0) {
                  setInternalDropTarget(targetDirectoryPath)
                }
              }}
              onDropOnDirectory={(targetDirectoryPath) => {
                void dropInternalDrag(targetDirectoryPath)
              }}
            />
          </div>
          {isDragging ? (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/80 text-sm text-muted-foreground">
              松开上传
            </div>
          ) : null}
        </section>
      </div>

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
            <DialogDescription>选择目标文件夹。</DialogDescription>
          </DialogHeader>
          <div className="max-h-72 overflow-auto rounded-md border border-border p-2">
            <Button
              type="button"
              variant={moveTargetPath === "" ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={() => setMoveTargetPath("")}
              aria-label="选择目标文件夹 资料"
            >
              <Folder data-icon="inline-start" />
              资料
            </Button>
            {renderMoveTreeItems(directoryTree[""] ?? [])}
          </div>
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
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {trashPaths.slice(0, 5).map((relativePath) => (
                  <span key={relativePath} className="break-all">{relativePath}</span>
                ))}
                {trashPaths.length > 5 ? (
                  <span>还有 {trashPaths.length - 5} 项</span>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={trashSelected} aria-label="确认移到废纸篓">
              移到废纸篓
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={pendingMove !== null} onOpenChange={(open) => {
        if (!open) setPendingMove(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移动？</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {pendingMove?.relativePaths.slice(0, 5).map((relativePath) => (
                  <span key={relativePath} className="break-all">{relativePath}</span>
                ))}
                {pendingMove && pendingMove.relativePaths.length > 5 ? (
                  <span>还有 {pendingMove.relativePaths.length - 5} 项</span>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => {
              const pending = pendingMove
              setPendingMove(null)
              if (!pending) return
              void runMoveRawEntries(pending.relativePaths, pending.targetDirectoryPath)
              setMoveTargetPath("")
            }}>
              确认
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

export { KnowledgeBaseSourceManagerWindow }
