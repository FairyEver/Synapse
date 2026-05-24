import { type DragEvent, useCallback, useEffect, useMemo, useState } from "react"
import { FolderOpen, Link, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty"
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
  SynapseKnowledgeBaseSourceEntry,
} from "@/types/knowledge-base"

const logger = createRendererLogger("knowledge-base.source-manager")

const STATUS_LABELS: Record<SynapseKnowledgeBaseSourceEntry["status"], string> = {
  pending: "新文件",
  changed: "有更新",
  imported: "已放入",
  unsupported: "暂不支持",
  error: "读取失败",
}

const STATUS_VARIANTS: Record<
  SynapseKnowledgeBaseSourceEntry["status"],
  "default" | "secondary" | "destructive" | "outline"
> = {
  pending: "default",
  changed: "outline",
  imported: "secondary",
  unsupported: "outline",
  error: "destructive",
}

function readWindowPayload(): SynapseKnowledgeBaseOpenSourceManagerPayload | null {
  const params = new URLSearchParams(window.location.search)
  const projectId = params.get("projectId")
  const projectPath = params.get("projectPath")
  const projectName = params.get("projectName")
  if (!projectId || !projectPath || !projectName) {
    return null
  }
  return { projectId, projectPath, projectName }
}

function formatBytes(size: number): string {
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

function matchesSearch(source: SynapseKnowledgeBaseSourceEntry, keyword: string): boolean {
  const normalized = keyword.trim().toLowerCase()
  if (!normalized) return true
  return `${source.name}\n${source.relativePath}`.toLowerCase().includes(normalized)
}

function KnowledgeBaseSourceManagerWindow() {
  const payload = useMemo(readWindowPayload, [])
  const { error: showError, promise } = useAppNotifications()
  const [sources, setSources] = useState<SynapseKnowledgeBaseSourceEntry[]>([])
  const [query, setQuery] = useState("")
  const [sourceUrl, setSourceUrl] = useState("")
  const [isLoading, setIsLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const bridge = getSynapseBridge()

  const refreshSources = useCallback(async () => {
    if (!payload || !bridge) return
    setIsLoading(true)
    try {
      const result = await bridge.knowledgeBase.listSources(payload.projectPath)
      setSources(result.sources)
    } catch (error) {
      logger.error("Failed to load knowledge base sources.", { error })
      showError("读取资料失败")
    } finally {
      setIsLoading(false)
    }
  }, [bridge, payload, showError])

  useEffect(() => {
    void refreshSources()
  }, [refreshSources])

  const uploadFiles = useCallback(async (filePaths: string[]) => {
    if (!payload || !bridge || filePaths.length === 0) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.uploadSources({
          projectPath: payload.projectPath,
          filePaths,
        })
        await refreshSources()
        return result
      },
      {
        loading: "正在放入",
        success: (result) => result.uploaded.length > 0 ? "已放入" : "没有可放入的文件",
        error: "放入失败",
      },
    )
  }, [bridge, payload, promise, refreshSources])

  const addUrlSource = useCallback(async () => {
    if (!payload || !bridge) return
    const url = sourceUrl.trim()
    if (!url) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.addUrlSource({
          projectPath: payload.projectPath,
          url,
        })
        if (result.uploaded.length > 0) {
          setSourceUrl("")
        }
        await refreshSources()
        return result
      },
      {
        loading: "正在添加",
        success: (result) => result.uploaded.length > 0 ? "已添加" : "添加失败",
        error: "添加失败",
      },
    )
  }, [bridge, payload, promise, refreshSources, sourceUrl])

  const chooseFiles = useCallback(async () => {
    if (!payload || !bridge) return
    await promise(
      async () => {
        const result = await bridge.knowledgeBase.selectAndUploadSources(payload.projectPath)
        await refreshSources()
        return result
      },
      {
        loading: "正在放入",
        success: (result) => result.uploaded.length > 0 ? "已放入" : null,
        error: "放入失败",
      },
    )
  }, [bridge, payload, promise, refreshSources])

  const openRawDirectory = useCallback(async () => {
    if (!payload || !bridge) return
    try {
      await bridge.knowledgeBase.openRawDirectory(payload.projectPath)
    } catch (error) {
      logger.error("Failed to open knowledge base raw directory.", { error })
      showError("打开目录失败")
    }
  }, [bridge, payload, showError])

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsDragging(false)
    if (!bridge) return
    const filePaths = Array.from(event.dataTransfer.files)
      .map((file) => bridge.knowledgeBase.filePathForDroppedFile(file))
      .filter((filePath): filePath is string => Boolean(filePath))
    void uploadFiles(filePaths)
  }, [bridge, uploadFiles])

  const visibleSources = useMemo(
    () => sources.filter((source) => matchesSearch(source, query)),
    [query, sources],
  )

  if (!payload) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
        <Empty>
          <EmptyHeader>
            <EmptyTitle>无法打开资料管理</EmptyTitle>
          </EmptyHeader>
        </Empty>
      </main>
    )
  }

  return (
    <main className="flex h-screen bg-background text-foreground">
      <section aria-label="资料列表" className="flex min-w-0 flex-1 flex-col overflow-hidden p-4">
        <div className="flex shrink-0 items-center pb-3">
          <Input
            className="max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索资料"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-auto border-t border-border">
          <Table className="table-fixed">
            <colgroup>
              <col />
              <col className="w-28" />
              <col className="w-24" />
              <col className="w-32" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>资料</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">大小</TableHead>
                <TableHead className="text-right">更新时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleSources.map((source) => (
                <TableRow key={source.relativePath}>
                  <TableCell className="max-w-0 overflow-hidden">
                    <div className="truncate font-medium">{source.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{source.relativePath}</div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_VARIANTS[source.status]}>
                      {STATUS_LABELS[source.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatBytes(source.size)}</TableCell>
                  <TableCell className="text-right text-muted-foreground">{formatModifiedAt(source.modifiedAt)}</TableCell>
                </TableRow>
              ))}
              {visibleSources.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4}>
                    <Empty className="border-0">
                      <EmptyHeader>
                        <EmptyTitle>{isLoading ? "读取中" : query ? "没有匹配资料" : "暂无资料"}</EmptyTitle>
                        <EmptyDescription>拖拽文件到右侧区域</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </div>
      </section>

      <aside aria-label="添加资料" className="flex h-screen w-80 shrink-0 flex-col border-l border-border bg-muted/30 p-4">
        <div
          className={cn(
            "flex min-h-44 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-background p-5 text-center text-sm text-muted-foreground",
            isDragging && "bg-accent text-accent-foreground",
          )}
          onDragOver={(event) => {
            event.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
        >
          <Upload className="size-5" />
          <div className="flex flex-col gap-1">
            <div className="font-medium text-foreground">放入资料</div>
            <div className="text-xs">拖拽文件到这里</div>
            <div className="text-xs">支持 Markdown、Word、Excel、PDF、PPT、网页 URL</div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-2">
            <Input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void addUrlSource()
                }
              }}
              placeholder="粘贴网页 URL"
            />
            <Button type="button" variant="outline" size="icon" onClick={addUrlSource} aria-label="添加 URL">
              <Link className="size-4" />
            </Button>
          </div>
          <Button onClick={chooseFiles}>
            <Upload data-icon="inline-start" />
            选择文件
          </Button>
          <Button variant="outline" onClick={openRawDirectory}>
            <FolderOpen data-icon="inline-start" />
            打开目录
          </Button>
        </div>

        <div className="mt-auto space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
          <div className="space-y-1">
            <div>放入后，在知识库对话里说“汲取知识”。</div>
            <div>旧版 .doc/.ppt 需要本地转换工具。</div>
            <div>图片和扫描 PDF 暂不支持。</div>
          </div>
          目标目录：raw/
        </div>
      </aside>
    </main>
  )
}

export { KnowledgeBaseSourceManagerWindow }
