import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { FolderPlus, MoreHorizontal, RefreshCw, Share2, Trash2, Upload } from "lucide-react"
import type { DriveItemDto, DriveUploadPrepareResult } from "@synapse/shared"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

type DrivePathEntry = {
  readonly id: string | null
  readonly name: string
}

function DriveModule() {
  const [items, setItems] = useState<DriveItemDto[]>([])
  const [path, setPath] = useState<DrivePathEntry[]>([{ id: null, name: "根目录" }])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const parentId = path.at(-1)?.id ?? null

  const loadItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const nextItems = await requireSynapseBridge().account.listDriveItems({ parentId })
      setItems(nextItems)
    } catch (rawError) {
      setError(errorMessage(rawError, "加载失败"))
    } finally {
      setLoading(false)
    }
  }, [parentId])

  useEffect(() => {
    void loadItems()
  }, [loadItems])

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return items
    return items.filter((item) => item.name.toLowerCase().includes(keyword))
  }, [items, query])

  const openFolder = useCallback((item: DriveItemDto) => {
    if (item.type !== "folder") return
    setPath((current) => [...current, { id: item.id, name: item.name }])
  }, [])

  const jumpToPath = useCallback((index: number) => {
    setPath((current) => current.slice(0, index + 1))
  }, [])

  const handleFileSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (files.length === 0) return
    const results = await uploadFiles(files, parentId)
    toast(results.failed === 0 ? `已上传 ${results.completed} 个文件` : `上传完成 ${results.completed} 个，失败 ${results.failed} 个`)
    await loadItems()
  }, [loadItems, parentId])

  const handleFolderSelected = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ""
    if (files.length === 0) return
    const results = await uploadFolder(files, parentId)
    toast(results.failed === 0 ? `已上传 ${results.completed} 个文件` : `上传完成 ${results.completed} 个，失败 ${results.failed} 个`)
    await loadItems()
  }, [loadItems, parentId])

  const handleCreateFolder = useCallback(async () => {
    const name = window.prompt("文件夹名称")?.trim()
    if (!name) return
    try {
      await requireSynapseBridge().account.createDriveFolder({ parentId, name })
      toast("文件夹已创建")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "创建失败"))
    }
  }, [loadItems, parentId])

  const handleRename = useCallback(async (item: DriveItemDto) => {
    const name = window.prompt("新名称", item.name)?.trim()
    if (!name || name === item.name) return
    try {
      await requireSynapseBridge().account.renameDriveItem({ itemId: item.id, name })
      toast("已重命名")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "重命名失败"))
    }
  }, [loadItems])

  const handleMove = useCallback(async (item: DriveItemDto) => {
    const target = window.prompt("目标文件夹 ID，留空移到根目录", "")?.trim() ?? ""
    try {
      await requireSynapseBridge().account.moveDriveItem({ itemId: item.id, parentId: target || null })
      toast("已移动")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "移动失败"))
    }
  }, [loadItems])

  const handleDelete = useCallback(async (item: DriveItemDto) => {
    if (!window.confirm(`删除「${item.name}」？`)) return
    try {
      await requireSynapseBridge().account.deleteDriveItem({ itemId: item.id })
      toast("已删除")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "删除失败"))
    }
  }, [loadItems])

  const handleShare = useCallback(async (item: DriveItemDto) => {
    try {
      const share = await requireSynapseBridge().account.shareDriveItem({ itemId: item.id })
      await navigator.clipboard.writeText(share.url)
      toast("链接已复制")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "分享失败"))
    }
  }, [loadItems])

  const handleDisableShare = useCallback(async (item: DriveItemDto) => {
    if (!item.activeShareId) return
    try {
      await requireSynapseBridge().account.disableDriveShare({ shareId: item.activeShareId })
      toast("已取消分享")
      await loadItems()
    } catch (rawError) {
      toast(errorMessage(rawError, "取消分享失败"))
    }
  }, [loadItems])

  return (
    <section className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">云盘</h1>
          <nav className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground" aria-label="当前位置">
            {path.map((entry, index) => (
              <Button key={`${entry.id ?? "root"}-${index}`} variant="ghost" size="sm" onClick={() => jumpToPath(index)}>
                {entry.name}
              </Button>
            ))}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileSelected} />
          <input ref={folderInputRef} type="file" multiple className="hidden" onChange={handleFolderSelected} {...{ webkitdirectory: "" }} />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            上传文件
          </Button>
          <Button variant="outline" size="sm" onClick={() => folderInputRef.current?.click()}>
            <Upload data-icon="inline-start" />
            上传文件夹
          </Button>
          <Button variant="outline" size="sm" onClick={handleCreateFolder}>
            <FolderPlus data-icon="inline-start" />
            新建文件夹
          </Button>
          <Button variant="ghost" size="icon" onClick={() => void loadItems()} aria-label="刷新">
            <RefreshCw />
          </Button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-4">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索"
        />
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {loading ? <div className="text-sm text-muted-foreground">加载中...</div> : (
          <div className="min-h-0 overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">大小</TableHead>
                  <TableHead>更新时间</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="min-w-0">
                      <Button variant="link" className="h-auto max-w-full px-0" onClick={() => openFolder(item)}>
                        <span className="truncate">{item.name}</span>
                      </Button>
                    </TableCell>
                    <TableCell>
                      <Badge variant={item.shared ? "secondary" : "outline"}>{item.shared ? "已分享" : item.type === "folder" ? "文件夹" : "文件"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{item.type === "folder" ? "-" : formatBytes(item.size)}</TableCell>
                    <TableCell>{new Date(item.updatedAt).toLocaleString("zh-CN")}</TableCell>
                    <TableCell>
                      <DriveItemMenu
                        item={item}
                        onRename={handleRename}
                        onMove={handleMove}
                        onDelete={handleDelete}
                        onShare={handleShare}
                        onDisableShare={handleDisableShare}
                      />
                    </TableCell>
                  </TableRow>
                ))}
                {visibleItems.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-muted-foreground">暂无文件</TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </section>
  )
}

function DriveItemMenu({
  item,
  onRename,
  onMove,
  onDelete,
  onShare,
  onDisableShare,
}: {
  readonly item: DriveItemDto
  readonly onRename: (item: DriveItemDto) => void
  readonly onMove: (item: DriveItemDto) => void
  readonly onDelete: (item: DriveItemDto) => void
  readonly onShare: (item: DriveItemDto) => void
  readonly onDisableShare: (item: DriveItemDto) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="更多">
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onShare(item)}>
            <Share2 data-icon="inline-start" />
            分享
          </DropdownMenuItem>
          {item.activeShareId ? (
            <DropdownMenuItem onClick={() => onDisableShare(item)}>取消分享</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => onRename(item)}>重命名</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onMove(item)}>移动</DropdownMenuItem>
          <DropdownMenuItem onClick={() => onDelete(item)}>
            <Trash2 data-icon="inline-start" />
            删除
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

async function uploadFiles(files: readonly File[], parentId: string | null): Promise<{ completed: number; failed: number }> {
  let completed = 0
  let failed = 0
  for (const file of files) {
    try {
      const prepared = await requireSynapseBridge().account.prepareDriveUpload({
        parentId,
        name: file.name,
        size: String(file.size),
        mimeType: file.type || null,
      })
      await uploadPreparedFile(prepared, file)
      await requireSynapseBridge().account.completeDriveUpload({ sessionId: prepared.sessionId })
      completed += 1
    } catch {
      failed += 1
    }
  }
  return { completed, failed }
}

async function uploadFolder(files: readonly File[], parentId: string | null): Promise<{ completed: number; failed: number }> {
  const withPaths = files.map((file) => ({ file, path: readRelativeFilePath(file) }))
  const firstPath = withPaths[0]?.path ?? "上传文件夹"
  const folderName = firstPath.split("/")[0] || "上传文件夹"
  const prepared = await requireSynapseBridge().account.prepareDriveFolderUpload({
    parentId,
    folderName,
    files: withPaths.map(({ file, path }) => ({
      relativePath: path.split("/").slice(1).join("/") || file.name,
      size: String(file.size),
      mimeType: file.type || null,
    })),
  })
  const entriesByPath = new Map(prepared.entries.map((entry) => [entry.relativePath, entry]))
  let completed = 0
  let failed = 0
  for (const { file, path } of withPaths) {
    const relativePath = path.split("/").slice(1).join("/") || file.name
    const entry = entriesByPath.get(relativePath)
    if (!entry) {
      failed += 1
      continue
    }
    try {
      await uploadPreparedFile(entry, file)
      await requireSynapseBridge().account.completeDriveUpload({ sessionId: entry.sessionId })
      completed += 1
    } catch {
      failed += 1
    }
  }
  return { completed, failed }
}

async function uploadPreparedFile(prepared: Pick<DriveUploadPrepareResult, "upload">, file: File): Promise<void> {
  const response = await fetch(prepared.upload.url, {
    method: prepared.upload.method,
    headers: prepared.upload.headers,
    body: file,
  })
  if (!response.ok) throw new Error("上传失败")
}

function readRelativeFilePath(file: File): string {
  const withDirectory = file as File & { webkitRelativePath?: string }
  return withDirectory.webkitRelativePath || file.name
}

function formatBytes(value: string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes)) return "-"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

export { DriveModule }
