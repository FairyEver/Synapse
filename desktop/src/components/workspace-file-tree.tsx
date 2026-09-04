import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type Ref,
} from "react"
import {
  ChevronRight,
  File,
  FileSymlink,
  Folder,
  FolderOpen,
  LoaderCircle,
  X,
} from "lucide-react"
import { Tree, type NodeRendererProps } from "react-arborist"

import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  VirtualScrollArea,
  VirtualScrollAreaViewport,
} from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { writeWorkspaceFileTreeDrag } from "@/lib/workspace-file-tree-drag"
import type {
  WorkspaceFileTreeDataSource,
  WorkspaceFileTreeEntry,
  WorkspaceFileTreeScope,
} from "@/types/workspace-file-tree"

const logger = createRendererLogger("workspace-file-tree")
const ROW_HEIGHT = 28

type FileTreeNode = WorkspaceFileTreeEntry & {
  readonly children?: readonly FileTreeNode[]
}

type WorkspaceFileTreeProps = {
  readonly dataSource: WorkspaceFileTreeDataSource
  readonly theme?: "dark" | "inherit"
  readonly onClose: () => void
  readonly closeButtonRef?: Ref<HTMLButtonElement>
}

export function WorkspaceFileTree({
  closeButtonRef,
  dataSource,
  onClose,
  theme = "inherit",
}: WorkspaceFileTreeProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const scopeRef = useRef<WorkspaceFileTreeScope | null>(null)
  const directoriesRef = useRef<ReadonlyMap<string, readonly WorkspaceFileTreeEntry[]>>(new Map())
  const requestIdsRef = useRef(new Map<string, number>())
  const generationRef = useRef(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [scope, setScope] = useState<WorkspaceFileTreeScope | null>(null)
  const [directories, setDirectories] = useState<ReadonlyMap<string, readonly WorkspaceFileTreeEntry[]>>(new Map())
  const [loadingPaths, setLoadingPaths] = useState<ReadonlySet<string>>(new Set())
  const [failedPath, setFailedPath] = useState<string | null>(null)
  const [opening, setOpening] = useState(true)
  const [retryKey, setRetryKey] = useState(0)

  const commitDirectories = useCallback((next: ReadonlyMap<string, readonly WorkspaceFileTreeEntry[]>) => {
    directoriesRef.current = next
    setDirectories(next)
  }, [])

  const loadDirectory = useCallback(async (
    activeScope: WorkspaceFileTreeScope,
    relativePath: string,
    generation: number,
  ) => {
    const nextRequestId = (requestIdsRef.current.get(relativePath) ?? 0) + 1
    requestIdsRef.current.set(relativePath, nextRequestId)
    setLoadingPaths((current) => new Set(current).add(relativePath))
    try {
      const result = await dataSource.list({ scopeId: activeScope.scopeId, relativePath })
      if (generationRef.current !== generation
        || requestIdsRef.current.get(relativePath) !== nextRequestId) return
      const next = new Map(directoriesRef.current)
      next.set(relativePath, result.entries)
      commitDirectories(next)
      setFailedPath((current) => current === relativePath ? null : current)
    } catch (error) {
      if (generationRef.current !== generation) return
      logger.warn("Failed to read workspace file tree directory.", {
        relativePathLength: relativePath.length,
        error,
      })
      setFailedPath(relativePath)
    } finally {
      if (generationRef.current === generation) {
        setLoadingPaths((current) => {
          const next = new Set(current)
          next.delete(relativePath)
          return next
        })
      }
    }
  }, [commitDirectories, dataSource])

  useEffect(() => {
    const generation = generationRef.current + 1
    generationRef.current = generation
    scopeRef.current = null
    setScope(null)
    requestIdsRef.current.clear()
    commitDirectories(new Map())
    setLoadingPaths(new Set())
    setFailedPath(null)
    setOpening(true)
    let disposed = false

    void dataSource.open().then(async (nextScope) => {
      if (disposed || generationRef.current !== generation) {
        await dataSource.close({ scopeId: nextScope.scopeId })
        return
      }
      scopeRef.current = nextScope
      setScope(nextScope)
      await loadDirectory(nextScope, "", generation)
    }).catch((error) => {
      if (disposed || generationRef.current !== generation) return
      logger.warn("Failed to open workspace file tree.", { error })
      setFailedPath("")
    }).finally(() => {
      if (!disposed && generationRef.current === generation) setOpening(false)
    })

    return () => {
      disposed = true
      generationRef.current++
      const activeScope = scopeRef.current
      scopeRef.current = null
      if (activeScope) {
        void dataSource.close({ scopeId: activeScope.scopeId }).catch((error) => {
          logger.warn("Failed to close workspace file tree scope.", { error })
        })
      }
    }
  }, [commitDirectories, dataSource, loadDirectory, retryKey])

  useEffect(() => dataSource.onChanged((event) => {
    const activeScope = scopeRef.current
    if (!activeScope || event.scopeId !== activeScope.scopeId) return
    if (!directoriesRef.current.has(event.relativePath)) return
    void loadDirectory(activeScope, event.relativePath, generationRef.current)
  }), [dataSource, loadDirectory])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return undefined
    const commitSize = (width: number, height: number) => {
      const next = { width: Math.floor(width), height: Math.floor(height) }
      setSize((current) => current.width === next.width && current.height === next.height ? current : next)
    }
    const rect = container.getBoundingClientRect()
    commitSize(rect.width, rect.height)
    if (typeof ResizeObserver === "undefined") return undefined
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect
      if (box) commitSize(box.width, box.height)
    })
    observer.observe(container)
    return () => observer.disconnect()
  }, [failedPath, opening])

  const nodes = useMemo(() => buildNodes("", directories), [directories])
  const handleToggle = useCallback((relativePath: string) => {
    const activeScope = scopeRef.current
    if (!activeScope || directoriesRef.current.has(relativePath)) return
    void loadDirectory(activeScope, relativePath, generationRef.current)
  }, [loadDirectory])
  const handleRetry = useCallback(() => {
    const activeScope = scopeRef.current
    if (!activeScope) {
      setRetryKey((current) => current + 1)
      return
    }
    void loadDirectory(activeScope, failedPath ?? "", generationRef.current)
  }, [failedPath, loadDirectory])

  return (
    <section
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col bg-background text-foreground",
        theme === "dark" && "dark",
      )}
      aria-label="文件树"
    >
      <header className="flex h-8 shrink-0 items-center justify-between gap-2 border-b px-2">
        <h2 className="truncate text-sm font-medium" title={scope?.rootName}>
          {scope?.rootName ?? "文件"}
        </h2>
        <Button
          ref={closeButtonRef}
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="关闭文件树"
          title="关闭文件树"
          onClick={onClose}
        >
          <X />
        </Button>
      </header>
      {failedPath !== null ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-3 text-sm text-muted-foreground">
          <span>无法读取目录</span>
          <Button type="button" variant="outline" size="sm" onClick={handleRetry}>
            重试
          </Button>
        </div>
      ) : opening ? (
        <div className="space-y-2 p-2" aria-label="正在读取目录">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      ) : nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center px-3 text-sm text-muted-foreground">
          空文件夹
        </div>
      ) : (
        <div ref={containerRef} className="min-h-0 flex-1 overflow-hidden py-1">
          {size.width > 0 && size.height > 0 ? (
            <VirtualScrollArea>
              <Tree<FileTreeNode>
                data={nodes}
                width={size.width}
                height={size.height}
                rowHeight={ROW_HEIGHT}
                indent={12}
                overscanCount={8}
                idAccessor="relativePath"
                childrenAccessor="children"
                disableDrag
                disableDrop
                disableEdit
                openByDefault={false}
                selectionFollowsFocus
                aria-label="工作区文件"
                className="!overflow-x-hidden"
                rowClassName="!min-w-0 overflow-hidden"
                outerElementType={VirtualScrollAreaViewport}
                onToggle={handleToggle}
              >
                {(props) => (
                  <WorkspaceFileTreeNode
                    {...props}
                    loading={loadingPaths.has(props.node.id)}
                    scopeId={scope?.scopeId ?? ""}
                  />
                )}
              </Tree>
            </VirtualScrollArea>
          ) : null}
        </div>
      )}
    </section>
  )
}

function WorkspaceFileTreeNode({
  loading,
  node,
  scopeId,
  style,
}: NodeRendererProps<FileTreeNode> & { readonly loading: boolean; readonly scopeId: string }) {
  const directory = node.data.kind === "directory"
  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (directory && !event.metaKey && !event.ctrlKey && !event.shiftKey) node.toggle()
  }
  const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !node.isSelected) {
      node.select()
    }
  }
  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    const relativePaths = node.isSelected
      ? node.tree.selectedNodes.map((selected) => selected.data.relativePath)
      : [node.data.relativePath]
    if (!node.isSelected) node.select()
    writeWorkspaceFileTreeDrag(event.dataTransfer, { scopeId, relativePaths })
  }
  return (
    <div
      draggable
      style={style as CSSProperties}
      className={cn(
        "flex h-full w-full min-w-0 cursor-pointer items-center gap-1 overflow-hidden py-1 pr-2 text-sm outline-none",
        node.isSelected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/50",
      )}
      title={node.data.name}
      onClick={handleClick}
      onDragStart={handleDragStart}
      onMouseDown={handleMouseDown}
    >
      {directory ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={node.isOpen ? `收起 ${node.data.name}` : `展开 ${node.data.name}`}
          className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
          onClick={(event) => {
            event.stopPropagation()
            node.toggle()
          }}
        >
          {loading ? <LoaderCircle className="size-3 animate-spin" /> : (
            <ChevronRight className={cn("size-3", node.isOpen && "rotate-90")} />
          )}
        </button>
      ) : <span className="size-4 shrink-0" />}
      {node.data.kind === "directory"
        ? node.isOpen ? <FolderOpen className="size-3.5 shrink-0" /> : <Folder className="size-3.5 shrink-0" />
        : node.data.kind === "symbolic-link"
          ? <FileSymlink className="size-3.5 shrink-0 text-muted-foreground" />
          : <File className="size-3.5 shrink-0 text-muted-foreground" />}
      <span className="min-w-0 flex-1 truncate">{node.data.name}</span>
    </div>
  )
}

function buildNodes(
  relativePath: string,
  directories: ReadonlyMap<string, readonly WorkspaceFileTreeEntry[]>,
): readonly FileTreeNode[] {
  return (directories.get(relativePath) ?? []).map((entry) => ({
    ...entry,
    ...(entry.kind === "directory" ? {
      children: buildNodes(entry.relativePath, directories),
    } : {}),
  }))
}
