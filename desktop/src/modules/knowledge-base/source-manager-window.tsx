import { type DragEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { formatBytes } from "@synapse/shared"
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderPlus,
  FolderUp,
  Link,
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
import { RelativeTime } from "@/components/relative-time"
import { Input } from "@/components/ui/input"
import { useAppNotifications } from "@/app-shell/notifications"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { validateKnowledgeBaseRawEntryNameInput } from "@/lib/knowledge-base-raw-entry-name"
import { cn } from "@/lib/utils"
import type {
  SynapseKnowledgeBaseOpenSourceManagerPayload,
  SynapseKnowledgeBaseRawEntry,
  SynapseKnowledgeBaseRawMutationResult,
  SynapseKnowledgeBaseUploadSourcesResult,
} from "@/types/knowledge-base"

const logger = createRendererLogger("knowledge-base.source-manager")
const INTERNAL_RAW_DRAG_TYPE = "application/x-synapse-raw-entry-paths"
const RAW_DIRECTORY_PAGE_SIZE = 200
type DirectoryTree = Record<string, SynapseKnowledgeBaseRawEntry[]>
type TreeRenderer = (items: SynapseKnowledgeBaseRawEntry[], depth?: number) => ReactNode
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
  onAddUrl: () => void
  onCreateFolder: () => void
  onUploadFiles: () => void
  onUploadFolder: () => void
}

type SourceSelectionBarProps = {
  selectedCount: number
  visibleCount: number
  checked: boolean | "indeterminate"
  onCheckedChange: (checked: boolean) => void
  onMove: () => void
  onExport: () => void
  onTrash: () => void
}

type SourceEntryPaginationProps = {
  page: number
  pageSize: number
  totalCount: number
  visibleCount: number
  hasMore: boolean
  onPrevious: () => void
  onNext: () => void
}

type SourceEntryListProps = {
  entries: SynapseKnowledgeBaseRawEntry[]
  isLoading: boolean
  loadError: boolean
  query: string
  selectedPaths: Set<string>
  onToggleSelected: (relativePath: string, checked: boolean) => void
  onOpenDirectory: (relativePath: string) => void
  onRename: (entry: SynapseKnowledgeBaseRawEntry) => void
  onMoveEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onExportEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  onTrashEntry: (entry: SynapseKnowledgeBaseRawEntry) => void
  internalDropTarget: string | null
  onDragEntry: (entry: SynapseKnowledgeBaseRawEntry, event: DragEvent<HTMLElement>) => void
  onDragEnd: () => void
  onInternalDragOverDirectory: (targetDirectoryPath: string | null) => void
  onDropOnDirectory: (targetDirectoryPath: string, event: DragEvent<HTMLElement>) => void
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

function SourceEntryMeta({ entry }: { readonly entry: SynapseKnowledgeBaseRawEntry }) {
  const primary = entry.kind === "directory" ? "文件夹" : formatBytes(entry.size)
  return (
    <div className="flex min-w-0 items-center gap-1 truncate text-xs text-muted-foreground">
      <span className="shrink-0">{primary}</span>
      <span className="shrink-0">·</span>
      <RelativeTime value={entry.modifiedAt} />
    </div>
  )
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
  return rawMutationSuccessMessage(result, "已上传", emptyMessage)
}

function sourceUrlSuccessMessage(
  result: SynapseKnowledgeBaseUploadSourcesResult,
  emptyMessage: string | null,
): string | null {
  if (result.skipped.length > 0) {
    const skippedSummary = skippedReasonSummary(result.skipped)
    if (result.uploaded.length > 0) {
      return `已添加 ${result.uploaded.length} 项，跳过 ${result.skipped.length} 项${skippedSummary}`
    }
    return `跳过 ${result.skipped.length} 项${skippedSummary}`
  }
  return result.uploaded.length > 0 ? "已添加" : emptyMessage
}

function rawMutationSuccessMessage(
  result: SynapseKnowledgeBaseRawMutationResult,
  successMessage: string,
  emptyMessage: string | null,
): string | null {
  if (result.skipped.length > 0) {
    const skippedSummary = skippedReasonSummary(result.skipped)
    if (result.entries.length > 0) {
      return `${successMessage} ${result.entries.length} 项，跳过 ${result.skipped.length} 项${skippedSummary}`
    }
    return `跳过 ${result.skipped.length} 项${skippedSummary}`
  }
  return result.entries.length > 0 ? successMessage : emptyMessage
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
    case "unsupported":
      return "不支持"
    case "invalid-path":
      return "路径无效"
    case "invalid-name":
      return "名称无效"
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
    case "too-many-files":
      return "文件过多"
    case "too-large":
      return "总大小超限"
    case "too-deep":
      return "目录过深"
    case "file-too-large":
      return "文件过大"
    case "invalid_url":
      return "URL 无效"
    case "unsupported_protocol":
      return "协议不支持"
    case "url_credentials":
      return "URL 含凭据"
    case "local_or_private_host":
      return "本地地址不支持"
    case "http_error":
      return "HTTP 错误"
    case "unsupported_content_type":
      return "内容类型不支持"
    case "size_limit_exceeded":
      return "内容过大"
    case "network_error":
      return "网络错误"
    default:
      return "跳过"
  }
}

function hasDirectoryCache(tree: DirectoryTree, directoryPath: string): boolean {
  return Object.prototype.hasOwnProperty.call(tree, directoryPath)
}

const TREE_DEPTH_PADDING = [
  "pl-0",
  "pl-3",
  "pl-6",
  "pl-9",
  "pl-12",
  "pl-14",
] as const

function treeDepthPadding(depth: number): string {
  return TREE_DEPTH_PADDING[Math.min(depth, TREE_DEPTH_PADDING.length - 1)]
}

function shouldShowTreeDisclosure(
  entry: SynapseKnowledgeBaseRawEntry,
  tree: DirectoryTree,
  checkedDirectories: Set<string>,
  loadingDirectories: Set<string>,
): boolean {
  if (loadingDirectories.has(entry.relativePath)) return true
  if ((tree[entry.relativePath] ?? []).length > 0) return true
  return !checkedDirectories.has(entry.relativePath)
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

function hasExternalDraggedFiles(dataTransfer: DataTransfer | null | undefined): boolean {
  return Array.from(dataTransfer?.types ?? []).includes("Files") || (dataTransfer?.files.length ?? 0) > 0
}

function readInternalDraggedRawPaths(dataTransfer: DataTransfer | null | undefined): string[] {
  const rawValue = dataTransfer?.getData(INTERNAL_RAW_DRAG_TYPE)
  if (!rawValue) return []
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((value): value is string => typeof value === "string" && value.length > 0)
  } catch {
    return []
  }
}

function writeInternalDraggedRawPaths(dataTransfer: DataTransfer | null | undefined, paths: readonly string[]): void {
  if (!dataTransfer) return
  dataTransfer.effectAllowed = "move"
  dataTransfer.setData(INTERNAL_RAW_DRAG_TYPE, JSON.stringify(paths))
}

function markInternalRawDropTarget(dataTransfer: DataTransfer | null | undefined): void {
  if (!dataTransfer) return
  dataTransfer.dropEffect = "move"
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
  onAddUrl,
  onCreateFolder,
  onUploadFiles,
  onUploadFolder,
}: SourceManagerToolbarProps) {
  return (
    <div className="flex shrink-0 flex-col border-b border-border">
      <header className="flex flex-wrap items-center justify-end gap-2 px-4 pb-2 pt-3">
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
        <Button type="button" variant="outline" onClick={onAddUrl} aria-label="添加 URL">
          <Link data-icon="inline-start" />
          添加 URL
        </Button>
        <Button type="button" variant="outline" onClick={onUploadFolder} aria-label="上传文件夹">
          <FolderUp data-icon="inline-start" />
          上传文件夹
        </Button>
      </header>
      <nav aria-label="当前位置" className="overflow-x-auto px-4 pb-3">
        <div className="flex min-w-max items-center gap-1 text-sm">
          {breadcrumbs.map((item, index) => (
            <div key={item.path || "root"} className="flex shrink-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-0 max-w-48 shrink-0"
                onClick={() => onNavigate(item.path)}
              >
                <span className="truncate">{item.label}</span>
              </Button>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}

function SourceSelectionBar({
  selectedCount,
  visibleCount,
  checked,
  onCheckedChange,
  onMove,
  onExport,
  onTrash,
}: SourceSelectionBarProps) {
  const hasSelection = selectedCount > 0
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-1 py-1">
      <div className="flex items-center gap-3">
        <Checkbox
          aria-label="全选当前可见项"
          checked={checked}
          disabled={visibleCount === 0}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
        />
        <div className="text-sm text-muted-foreground">已选择 {selectedCount} 项</div>
      </div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={!hasSelection} onClick={onMove} aria-label="移动所选">
          <MoveRight data-icon="inline-start" />
          移动
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasSelection} onClick={onExport} aria-label="导出所选">
          <Download data-icon="inline-start" />
          导出
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasSelection} onClick={onTrash} aria-label="移到废纸篓">
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
      </div>
    </div>
  )
}

function SourceEntryPagination({
  page,
  pageSize,
  totalCount,
  visibleCount,
  hasMore,
  onPrevious,
  onNext,
}: SourceEntryPaginationProps) {
  if (totalCount <= pageSize && page === 0) return null

  const start = totalCount === 0 ? 0 : page * pageSize + 1
  const end = Math.min(page * pageSize + visibleCount, totalCount)

  return (
    <div className="flex min-h-9 items-center justify-between gap-3 px-1 py-1">
      <div className="text-sm text-muted-foreground">{start}-{end} / {totalCount}</div>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={onPrevious} aria-label="上一页">
          <ChevronLeft data-icon="inline-start" />
          上一页
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={!hasMore} onClick={onNext} aria-label="下一页">
          下一页
          <ChevronRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  )
}

function SourceEntryList({
  entries,
  isLoading,
  loadError,
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
          <EmptyTitle>{loadError ? "读取失败" : isLoading ? "读取中" : query ? "没有匹配项" : "没有文件"}</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div role="list" aria-label="资料列表" className="flex flex-col gap-1">
      {entries.map((entry) => {
        const selected = selectedPaths.has(entry.relativePath)
        const isDirectory = entry.kind === "directory"
        return (
          <div
            key={entry.relativePath}
            role="listitem"
            className={cn(
              "grid min-h-14 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-muted",
              isDirectory && "cursor-pointer",
              internalDropTarget === entry.relativePath && "bg-muted",
            )}
            data-raw-path={entry.relativePath}
            data-raw-drop-target={isDirectory ? entry.relativePath : undefined}
            data-track="knowledge-base.source.entry"
            data-track-native="true"
            draggable
            onClick={isDirectory ? () => onOpenDirectory(entry.relativePath) : undefined}
            onDragStart={(event) => {
              event.stopPropagation()
              onDragEntry(entry, event)
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              event.stopPropagation()
              markInternalRawDropTarget(event.dataTransfer)
              onInternalDragOverDirectory(entry.relativePath)
            }}
            onDrop={(event) => {
              if (entry.kind !== "directory") return
              event.preventDefault()
              event.stopPropagation()
              onDropOnDirectory(entry.relativePath, event)
            }}
          >
            <div
              className="flex items-center"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <Checkbox
                aria-label={`选择 ${entry.name}`}
                checked={selected}
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                onCheckedChange={(checked) => onToggleSelected(entry.relativePath, checked === true)}
              />
            </div>
            <div className="flex min-w-0 items-center gap-3">
              {isDirectory ? (
                <Folder className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <FileText className="size-4 shrink-0 text-muted-foreground" />
              )}
              <div className="min-w-0">
                {isDirectory ? (
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 justify-start px-0 py-0 font-medium hover:bg-transparent"
                    onClick={(event) => {
                      event.stopPropagation()
                      onOpenDirectory(entry.relativePath)
                    }}
                    aria-label={`打开文件夹 ${entry.name}`}
                  >
                    <span className="truncate">{entry.name}</span>
                  </Button>
                ) : (
                  <div className="truncate text-sm font-medium">{entry.name}</div>
                )}
                <SourceEntryMeta entry={entry} />
              </div>
            </div>
            <div
              className="flex items-center"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-10"
                    onClick={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    aria-label={`更多 ${entry.name}`}
                  >
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
          </div>
        )
      })}
    </div>
  )
}

function KnowledgeBaseSourceManagerWindow() {
  const payload = useMemo(readWindowPayload, [])
  const { error: showError, promise, warning: showWarning } = useAppNotifications()
  const [entries, setEntries] = useState<SynapseKnowledgeBaseRawEntry[]>([])
  const [entryPage, setEntryPage] = useState(0)
  const [entryTotalCount, setEntryTotalCount] = useState(0)
  const [entryHasMore, setEntryHasMore] = useState(false)
  const [directoryTree, setDirectoryTree] = useState<DirectoryTree>({})
  const [checkedTreeDirectories, setCheckedTreeDirectories] = useState<Set<string>>(() => new Set())
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set([""]))
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(() => new Set())
  const [currentDirectory, setCurrentDirectory] = useState("")
  const [query, setQuery] = useState("")
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set())
  const [isLoading, setIsLoading] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [addUrlOpen, setAddUrlOpen] = useState(false)
  const [sourceUrl, setSourceUrl] = useState("")
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
  const currentDirectoryRef = useRef("")
  const internalDragPathsRef = useRef<string[]>([])
  const checkedTreeDirectoriesRef = useRef<Set<string>>(new Set())
  const loadingDirectoriesRef = useRef<Set<string>>(new Set())
  const treeDirectoryVersionsRef = useRef<Map<string, number>>(new Map())
  const activeDirectoryVersionsRef = useRef<Map<string, number>>(new Map())
  const bridge = getSynapseBridge()

  const openDirectory = useCallback((directoryPath: string) => {
    currentDirectoryRef.current = directoryPath
    setEntryPage(0)
    setCurrentDirectory(directoryPath)
  }, [])

  const updateQuery = useCallback((nextQuery: string) => {
    setEntryPage(0)
    setQuery(nextQuery)
  }, [])

  const setTreeDirectoryLoading = useCallback((directoryPath: string, loading: boolean) => {
    const nextRef = new Set(loadingDirectoriesRef.current)
    if (loading) {
      nextRef.add(directoryPath)
    } else {
      nextRef.delete(directoryPath)
    }
    loadingDirectoriesRef.current = nextRef
    setLoadingDirectories(nextRef)
  }, [])

  const markTreeDirectoryChecked = useCallback((directoryPath: string) => {
    const next = new Set(checkedTreeDirectoriesRef.current)
    next.add(directoryPath)
    checkedTreeDirectoriesRef.current = next
    setCheckedTreeDirectories(next)
  }, [])

  const bumpTreeDirectoryVersion = useCallback((directoryPath: string) => {
    const nextVersion = (treeDirectoryVersionsRef.current.get(directoryPath) ?? 0) + 1
    treeDirectoryVersionsRef.current.set(directoryPath, nextVersion)
    return nextVersion
  }, [])

  const bumpActiveDirectoryVersion = useCallback((directoryPath: string) => {
    const nextVersion = (activeDirectoryVersionsRef.current.get(directoryPath) ?? 0) + 1
    activeDirectoryVersionsRef.current.set(directoryPath, nextVersion)
    return nextVersion
  }, [])

  const invalidateTreeDirectoryVersions = useCallback((directoryPaths: readonly string[]) => {
    const stalePaths = uniqueDirectoryPaths(directoryPaths.filter(Boolean))
    if (stalePaths.length === 0) return
    const pathsToInvalidate = new Set(stalePaths)
    for (const versionPath of treeDirectoryVersionsRef.current.keys()) {
      if (stalePaths.some((stalePath) => isPathOrDescendant(versionPath, stalePath))) {
        pathsToInvalidate.add(versionPath)
      }
    }
    for (const directoryPath of pathsToInvalidate) {
      bumpTreeDirectoryVersion(directoryPath)
    }
  }, [bumpTreeDirectoryVersion])

  const refreshDirectory = useCallback(async () => {
    if (!payload || !bridge) return
    const requestDirectory = currentDirectory
    const requestPage = entryPage
    const requestQuery = query.trim()
    const activeRequestVersion = bumpActiveDirectoryVersion(requestDirectory)
    const treeRequestVersion = bumpTreeDirectoryVersion(requestDirectory)
    const isActiveDirectoryRequest = () =>
      currentDirectoryRef.current === requestDirectory
      && activeDirectoryVersionsRef.current.get(requestDirectory) === activeRequestVersion
    const setActiveLoading = isActiveDirectoryRequest()
    if (setActiveLoading) {
      setIsLoading(true)
      setLoadError(false)
    }
    void bridge.knowledgeBase.listRawDirectory({
      projectId: payload.projectId,
      directoryPath: requestDirectory,
      entryKind: "directory",
    }).then((treeResult) => {
      if (treeDirectoryVersionsRef.current.get(requestDirectory) === treeRequestVersion) {
        setDirectoryTree((previous) => ({
          ...previous,
          [requestDirectory]: directoriesOnly(treeResult.entries),
        }))
        markTreeDirectoryChecked(requestDirectory)
      }
    }).catch((error: unknown) => {
      if (treeDirectoryVersionsRef.current.get(requestDirectory) === treeRequestVersion) {
        logger.error("Failed to load knowledge base raw tree directory.", { error })
        if (currentDirectoryRef.current === requestDirectory) {
          showError("读取资料失败")
        }
      }
    }).finally(() => {
      if (treeDirectoryVersionsRef.current.get(requestDirectory) === treeRequestVersion) {
        setTreeDirectoryLoading(requestDirectory, false)
      }
    })
    try {
      const result = await bridge.knowledgeBase.listRawDirectory({
        projectId: payload.projectId,
        directoryPath: requestDirectory,
        entryKind: "all",
        query: requestQuery || undefined,
        offset: requestPage * RAW_DIRECTORY_PAGE_SIZE,
        limit: RAW_DIRECTORY_PAGE_SIZE,
      })
      if (isActiveDirectoryRequest()) {
        setEntries(result.entries)
        setEntryTotalCount(result.totalCount ?? result.entries.length)
        setEntryHasMore(result.hasMore ?? false)
      }
    } catch (error) {
      if (isActiveDirectoryRequest()) {
        logger.error("Failed to load knowledge base raw directory.", { error })
        setEntries([])
        setEntryTotalCount(0)
        setEntryHasMore(false)
        setLoadError(true)
        showError("读取资料失败")
      }
    } finally {
      if (setActiveLoading && isActiveDirectoryRequest()) {
        setIsLoading(false)
      }
    }
  }, [
    bridge,
    bumpActiveDirectoryVersion,
    bumpTreeDirectoryVersion,
    currentDirectory,
    entryPage,
    markTreeDirectoryChecked,
    payload,
    query,
    setTreeDirectoryLoading,
    showError,
  ])

  useEffect(() => {
    void refreshDirectory()
  }, [refreshDirectory])

  useEffect(() => {
    setSelectedPaths(new Set())
  }, [currentDirectory])

  const pruneTreeDirectories = useCallback((directoryPaths: readonly string[]) => {
    const stalePaths = uniqueDirectoryPaths(directoryPaths.filter(Boolean))
    if (stalePaths.length === 0) return
    invalidateTreeDirectoryVersions(stalePaths)
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
    const nextChecked = new Set(checkedTreeDirectoriesRef.current)
    let checkedChanged = false
    for (const checkedPath of checkedTreeDirectoriesRef.current) {
      if (stalePaths.some((stalePath) => isPathOrDescendant(checkedPath, stalePath))) {
        nextChecked.delete(checkedPath)
        checkedChanged = true
      }
    }
    if (checkedChanged) {
      checkedTreeDirectoriesRef.current = nextChecked
      setCheckedTreeDirectories(nextChecked)
    }
    const nextLoading = new Set(loadingDirectoriesRef.current)
    let loadingChanged = false
    for (const loadingPath of loadingDirectoriesRef.current) {
      if (stalePaths.some((stalePath) => isPathOrDescendant(loadingPath, stalePath))) {
        nextLoading.delete(loadingPath)
        loadingChanged = true
      }
    }
    if (loadingChanged) {
      loadingDirectoriesRef.current = nextLoading
      setLoadingDirectories(nextLoading)
    }
  }, [invalidateTreeDirectoryVersions])

  const refreshTreeDirectories = useCallback(async (directoryPaths: readonly string[]) => {
    if (!payload || !bridge) return
    const pathsToRefresh = uniqueDirectoryPaths(directoryPaths)
    if (pathsToRefresh.length === 0) return
    const requestVersions = new Map<string, number>()
    for (const directoryPath of pathsToRefresh) {
      requestVersions.set(directoryPath, bumpTreeDirectoryVersion(directoryPath))
      setTreeDirectoryLoading(directoryPath, true)
    }
    await Promise.all(pathsToRefresh.map(async (directoryPath) => {
      const requestVersion = requestVersions.get(directoryPath) ?? 0
      try {
        const result = await bridge.knowledgeBase.listRawDirectory({
          projectId: payload.projectId,
          directoryPath,
          entryKind: "directory",
        })
        if (treeDirectoryVersionsRef.current.get(directoryPath) === requestVersion) {
          setDirectoryTree((previous) => ({
            ...previous,
            [directoryPath]: directoriesOnly(result.entries),
          }))
          markTreeDirectoryChecked(directoryPath)
        }
      } catch (error) {
        if (treeDirectoryVersionsRef.current.get(directoryPath) === requestVersion) {
          logger.error("Failed to refresh knowledge base raw tree directories.", { error })
          showError("读取资料失败")
        }
      } finally {
        if (treeDirectoryVersionsRef.current.get(directoryPath) === requestVersion) {
          setTreeDirectoryLoading(directoryPath, false)
        }
      }
    }))
  }, [bridge, bumpTreeDirectoryVersion, markTreeDirectoryChecked, payload, setTreeDirectoryLoading, showError])

  const loadTreeDirectory = useCallback(async (directoryPath: string) => {
    if (
      !payload
      || !bridge
      || hasDirectoryCache(directoryTree, directoryPath)
      || loadingDirectoriesRef.current.has(directoryPath)
    ) return
    const treeRequestVersion = bumpTreeDirectoryVersion(directoryPath)
    setTreeDirectoryLoading(directoryPath, true)
    try {
      const result = await bridge.knowledgeBase.listRawDirectory({
        projectId: payload.projectId,
        directoryPath,
        entryKind: "directory",
      })
      if (treeDirectoryVersionsRef.current.get(directoryPath) === treeRequestVersion) {
        setDirectoryTree((previous) => ({
          ...previous,
          [directoryPath]: directoriesOnly(result.entries),
        }))
        markTreeDirectoryChecked(directoryPath)
      }
    } catch (error) {
      if (treeDirectoryVersionsRef.current.get(directoryPath) === treeRequestVersion) {
        logger.error("Failed to load knowledge base raw tree directory.", { error })
        showError("读取资料失败")
      }
    } finally {
      if (treeDirectoryVersionsRef.current.get(directoryPath) === treeRequestVersion) {
        setTreeDirectoryLoading(directoryPath, false)
      }
    }
  }, [bridge, bumpTreeDirectoryVersion, directoryTree, markTreeDirectoryChecked, payload, setTreeDirectoryLoading, showError])

  const openTreeDirectory = useCallback((directoryPath: string) => {
    openDirectory(directoryPath)
    setExpandedDirectories((previous) => new Set([...previous, directoryPath]))
    void loadTreeDirectory(directoryPath)
  }, [loadTreeDirectory, openDirectory])

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

  const previousEntryPage = useCallback(() => {
    setEntryPage((previous) => Math.max(0, previous - 1))
  }, [])

  const nextEntryPage = useCallback(() => {
    setEntryPage((previous) => previous + 1)
  }, [])

  const selectedList = useMemo(() => Array.from(selectedPaths), [selectedPaths])
  const selectedVisibleCount = useMemo(
    () => visibleEntries.filter((entry) => selectedPaths.has(entry.relativePath)).length,
    [selectedPaths, visibleEntries],
  )
  const selectionBarChecked = visibleEntries.length > 0 && selectedVisibleCount === visibleEntries.length
    ? true
    : selectedVisibleCount > 0
      ? "indeterminate"
      : false

  const uploadItems = useCallback(async (itemPaths: string[], targetDirectoryPath = currentDirectory) => {
    if (!payload || !bridge || itemPaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.uploadRawItems({
          projectId: payload.projectId,
          targetDirectoryPath,
          itemPaths,
        })
        if (targetDirectoryPath === currentDirectory) {
          await refreshDirectory()
        } else {
          await refreshTreeDirectories([targetDirectoryPath])
        }
        return result
      },
      {
        trackingName: "knowledge-base.source.upload-drop",
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, "没有可上传的文件"),
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory, refreshTreeDirectories])

  const readDroppedItemPaths = useCallback((dataTransfer: DataTransfer): string[] => {
    if (!bridge) return []
    const itemPaths: string[] = []
    let unresolvedCount = 0
    for (const file of Array.from(dataTransfer.files)) {
      const filePath = bridge.knowledgeBase.filePathForDroppedFile(file)
      if (filePath) {
        itemPaths.push(filePath)
      } else {
        unresolvedCount += 1
      }
    }
    if (unresolvedCount > 0) {
      showWarning(`跳过 ${unresolvedCount} 个无法读取路径的文件`)
    }
    return itemPaths
  }, [bridge, showWarning])

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
        trackingName: "knowledge-base.source.upload-files",
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
        trackingName: "knowledge-base.source.upload-folder",
        loading: "正在上传",
        success: (result) => sourceUploadSuccessMessage(result, null),
        error: "上传失败",
      },
    )
  }, [bridge, currentDirectory, payload, promise, refreshDirectory])

  const addUrlSource = useCallback(async () => {
    if (!payload || !bridge) return
    const url = sourceUrl.trim()
    if (!url) return
    const result = await promise(
      async () => {
        const result = await bridge.knowledgeBase.addUrlSource({
          projectId: payload.projectId,
          targetDirectoryPath: currentDirectory,
          url,
        })
        await refreshDirectory()
        return result
      },
      {
        trackingName: "knowledge-base.source.add-url",
        loading: "正在添加",
        success: (result) => sourceUrlSuccessMessage(result, "没有可添加的 URL"),
        error: "添加失败",
      },
    )
    if (result.uploaded.length > 0) {
      setSourceUrl("")
      setAddUrlOpen(false)
    }
  }, [bridge, currentDirectory, payload, promise, refreshDirectory, sourceUrl])

  const createFolder = useCallback(async () => {
    if (!payload || !bridge) return
    const validationError = validateKnowledgeBaseRawEntryNameInput(newFolderName)
    if (validationError) {
      showError(validationError)
      return
    }
    const name = newFolderName.trim()
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
        trackingName: "knowledge-base.folder.create",
        loading: "正在新建",
        success: "已新建",
        error: "新建失败",
      },
    )
    setNewFolderName("")
    setCreateFolderOpen(false)
  }, [bridge, currentDirectory, newFolderName, payload, promise, refreshDirectory, showError])

  const renameEntry = useCallback(async () => {
    if (!payload || !bridge || !renameTarget) return
    const validationError = validateKnowledgeBaseRawEntryNameInput(renameValue)
    if (validationError) {
      showError(validationError)
      return
    }
    const newName = renameValue.trim()
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
        trackingName: "knowledge-base.entry.rename",
        loading: "正在重命名",
        success: "已重命名",
        error: "重命名失败",
      },
    )
    setRenameTarget(null)
    setRenameValue("")
  }, [bridge, payload, promise, pruneTreeDirectories, refreshDirectory, renameTarget, renameValue, showError])

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
        trackingName: "knowledge-base.entry.move",
        loading: "正在移动",
        success: (result) => rawMutationSuccessMessage(result, "已移动", "没有可移动的条目"),
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
        trackingName: "knowledge-base.entry.trash",
        loading: "正在移到废纸篓",
        success: (result) => rawMutationSuccessMessage(result, "已移到废纸篓", "没有可删除的条目"),
        error: "移到废纸篓失败",
      },
    )
  }, [bridge, payload, promise, pruneTreeDirectories, refreshDirectory])

  const startInternalDrag = useCallback((entry: SynapseKnowledgeBaseRawEntry, event: DragEvent<HTMLElement>) => {
    const paths = selectedPaths.has(entry.relativePath) ? selectedList : [entry.relativePath]
    internalDragPathsRef.current = paths
    setInternalDragPaths(paths)
    writeInternalDraggedRawPaths(event.dataTransfer, paths)
  }, [selectedList, selectedPaths])

  const endInternalDrag = useCallback(() => {
    internalDragPathsRef.current = []
    setInternalDragPaths([])
    setInternalDropTarget(null)
  }, [])

  const dropInternalDrag = useCallback(async (
    targetDirectoryPath: string,
    event?: DragEvent<HTMLElement>,
  ) => {
    const paths = internalDragPathsRef.current.length > 0
      ? internalDragPathsRef.current
      : readInternalDraggedRawPaths(event?.dataTransfer)
    internalDragPathsRef.current = []
    setInternalDragPaths([])
    setInternalDropTarget(null)
    if (paths.length === 0 && event?.dataTransfer && hasExternalDraggedFiles(event.dataTransfer)) {
      await uploadItems(readDroppedItemPaths(event.dataTransfer), targetDirectoryPath)
      return
    }
    if (!canMoveRawPathsToTarget(paths, targetDirectoryPath)) return
    await runMoveRawEntries(paths, targetDirectoryPath)
  }, [readDroppedItemPaths, runMoveRawEntries, uploadItems])

  const exportEntries = useCallback(async (relativePaths: string[]) => {
    if (!payload || !bridge || relativePaths.length === 0) return
    await promise(
      async () => bridge.knowledgeBase.exportRawEntries({
        projectId: payload.projectId,
        relativePaths,
      }),
      {
        trackingName: "knowledge-base.entry.export",
        loading: "正在导出",
        success: (result) => rawMutationSuccessMessage(result, "已导出", null),
        error: "导出失败",
      },
    )
  }, [bridge, payload, promise])

  const trashSelected = useCallback(async () => {
    await runTrashRawEntries(trashPaths)
    setTrashPaths([])
  }, [runTrashRawEntries, trashPaths])

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (internalDragPathsRef.current.length > 0 || !hasExternalDraggedFiles(event.dataTransfer)) return
    void uploadItems(readDroppedItemPaths(event.dataTransfer))
  }, [readDroppedItemPaths, uploadItems])

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

  const toggleAllVisibleEntries = useCallback((checked: boolean) => {
    if (!checked) {
      setSelectedPaths(new Set())
      return
    }
    setSelectedPaths(new Set(visibleEntries.map((entry) => entry.relativePath)))
  }, [visibleEntries])

  const openRenameDialog = useCallback((entry: SynapseKnowledgeBaseRawEntry) => {
    setRenameTarget(entry)
    setRenameValue(entry.name)
  }, [])

  const renderTreeItems = useCallback((items: SynapseKnowledgeBaseRawEntry[], depth = 1) => (
    <div className="flex flex-col gap-0.5">
      {items.map((entry) => {
        const isExpanded = expandedDirectories.has(entry.relativePath)
        const isLoadingDirectory = loadingDirectories.has(entry.relativePath)
        const childItems = directoryTree[entry.relativePath] ?? []
        const showDisclosure = shouldShowTreeDisclosure(
          entry,
          directoryTree,
          checkedTreeDirectories,
          loadingDirectories,
        )
        return (
          <div key={entry.relativePath} className="flex flex-col gap-0.5">
            <div className={cn("flex items-center gap-1", treeDepthPadding(depth))}>
              {showDisclosure ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => toggleTreeDirectory(entry.relativePath)}
                  aria-label={`${isExpanded ? "折叠" : "展开"} ${entry.name}`}
                >
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </Button>
              ) : (
                <span className="size-7 shrink-0" aria-hidden="true" />
              )}
              <ContextMenu data-track="knowledge-base-source-tree-folder-menu">
                <ContextMenuTrigger asChild>
                  <Button
                    type="button"
                    variant={currentDirectory === entry.relativePath ? "secondary" : "ghost"}
                    size="sm"
                    className="h-7 min-w-0 flex-1 justify-start"
                    data-raw-drop-target={entry.relativePath}
                    onClick={() => openTreeDirectory(entry.relativePath)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      markInternalRawDropTarget(event.dataTransfer)
                      if (internalDragPaths.length > 0) {
                        setInternalDropTarget(entry.relativePath)
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      void dropInternalDrag(entry.relativePath, event)
                    }}
                    aria-label={`打开树文件夹 ${entry.name}`}
                  >
                    <Folder data-icon="inline-start" />
                    <span className="truncate">{entry.name}</span>
                  </Button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onSelect={() => openRenameDialog(entry)}>
                    <Pencil />
                    重命名
                  </ContextMenuItem>
                  <ContextMenuItem variant="destructive" onSelect={() => setTrashPaths([entry.relativePath])}>
                    <Trash2 />
                    删除
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            </div>
            {isExpanded && isLoadingDirectory ? (
              <div className={cn("px-2 py-1 text-xs text-muted-foreground", treeDepthPadding(depth + 1))}>读取中</div>
            ) : null}
            {isExpanded && childItems.length > 0 ? renderTreeItems(childItems, depth + 1) : null}
          </div>
        )
      })}
    </div>
  ), [
    checkedTreeDirectories,
    currentDirectory,
    directoryTree,
    dropInternalDrag,
    expandedDirectories,
    internalDragPaths.length,
    loadingDirectories,
    openRenameDialog,
    openTreeDirectory,
    setTrashPaths,
    toggleTreeDirectory,
  ])

  const renderMoveTreeItems = useCallback((items: SynapseKnowledgeBaseRawEntry[]) => (
    <div className="ml-4 flex flex-col gap-1">
      {items.map((entry) => {
        const isExpanded = expandedDirectories.has(entry.relativePath)
        const isLoadingDirectory = loadingDirectories.has(entry.relativePath)
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
            {isExpanded && isLoadingDirectory ? (
              <div className="ml-8 px-2 py-1 text-xs text-muted-foreground">读取中</div>
            ) : null}
            {isExpanded && childItems.length > 0 ? renderMoveTreeItems(childItems) : null}
          </div>
        )
      })}
    </div>
  ), [directoryTree, expandedDirectories, loadTreeDirectory, loadingDirectories, moveTargetPath, toggleTreeDirectory])

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
        if (internalDragPathsRef.current.length > 0 || !hasExternalDraggedFiles(event.dataTransfer)) {
          setIsDragging(false)
          return
        }
        event.preventDefault()
        setIsDragging(true)
      }}
      onDragLeave={handleDragLeave}
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
          onQueryChange={updateQuery}
          onNavigate={openDirectory}
          onAddUrl={() => {
            setSourceUrl("")
            setAddUrlOpen(true)
          }}
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
              visibleCount={visibleEntries.length}
              checked={selectionBarChecked}
              onCheckedChange={toggleAllVisibleEntries}
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
              loadError={loadError}
              query={query}
              selectedPaths={selectedPaths}
              onToggleSelected={toggleSelected}
              onOpenDirectory={openDirectory}
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
              onDropOnDirectory={(targetDirectoryPath, event) => {
                void dropInternalDrag(targetDirectoryPath, event)
              }}
            />
            <SourceEntryPagination
              page={entryPage}
              pageSize={RAW_DIRECTORY_PAGE_SIZE}
              totalCount={entryTotalCount}
              visibleCount={visibleEntries.length}
              hasMore={entryHasMore}
              onPrevious={previousEntryPage}
              onNext={nextEntryPage}
            />
          </div>
          {isDragging ? (
            <div className="pointer-events-none absolute inset-4 flex items-center justify-center rounded-lg border border-dashed border-border bg-background/80 text-sm text-muted-foreground">
              松开上传
            </div>
          ) : null}
        </section>
      </div>

      <Dialog open={addUrlOpen} onOpenChange={setAddUrlOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加 URL</DialogTitle>
            <DialogDescription>输入网页地址。</DialogDescription>
          </DialogHeader>
          <Input
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addUrlSource()
            }}
            placeholder="https://example.com/page"
            autoFocus
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddUrlOpen(false)}>取消</Button>
            <Button type="button" onClick={addUrlSource} aria-label="确认添加 URL">添加</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
