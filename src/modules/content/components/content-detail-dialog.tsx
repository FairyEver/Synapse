import {
  FileBox,
  FileText,
  LoaderCircle,
  PackageOpen,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Separator } from "@/components/ui/separator"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getContentIconOption } from "@/lib/content-appearance"
import { getCategoryLabel } from "@/lib/content-categories"
import { ContentActionSplitButton } from "@/modules/content/components/content-action-split-button"
import { useContentDetail } from "@/modules/content/hooks/use-content-detail"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import type {
  SynapseContentFile,
  SynapseContentMeta,
} from "@/types/content"

type ContentDetailDialogProps = {
  item: SynapseContentMeta | null
  onOpenChange: (open: boolean) => void
  onStatusChange?: (message: string | null, tone?: "default" | "destructive") => void
  open: boolean
}

function formatDateTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function formatFileSize(size: number): string {
  if (size < 1024) {
    return `${size} B`
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }

  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function FilePreview({ file }: { file: SynapseContentFile }) {
  if (file.kind === "binary") {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border bg-muted/20 p-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-foreground">
            <FileBox />
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-sm text-muted-foreground">
              二进制文件不支持预览。
            </p>
            <p className="text-xs text-muted-foreground">大小：{formatFileSize(file.size)}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto rounded-lg border border-border bg-muted/20 p-4">
      <pre className="whitespace-pre-wrap break-words font-mono text-sm leading-6 text-foreground">
        {file.content}
      </pre>
    </div>
  )
}

function ContentPreviewArea({
  activeFilePath,
  files,
  isLoading,
  previewError,
  setActiveFilePath,
}: {
  activeFilePath: string | null
  files: SynapseContentFile[]
  isLoading: boolean
  previewError: string | null
  setActiveFilePath: (path: string) => void
}) {
  if (isLoading) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <LoaderCircle className="animate-spin" />
          </EmptyMedia>
          <EmptyTitle>正在读取内容</EmptyTitle>
          <EmptyDescription>请稍等一下。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (previewError) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <PackageOpen />
          </EmptyMedia>
          <EmptyTitle>无法显示预览</EmptyTitle>
          <EmptyDescription>{previewError}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (files.length === 0) {
    return (
      <Empty className="min-h-[360px] rounded-lg border border-border bg-muted/20">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileText />
          </EmptyMedia>
          <EmptyTitle>没有可预览的文件</EmptyTitle>
          <EmptyDescription>当前内容里还没有可显示的文件。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  if (files.length === 1) {
    return (
      <div className="min-h-0 flex-1">
        <FilePreview file={files[0]} />
      </div>
    )
  }

  return (
    <Tabs
      value={activeFilePath ?? files[0].relativePath}
      onValueChange={setActiveFilePath}
      className="min-h-0 flex-1"
    >
      <div className="overflow-x-auto pb-1">
        <TabsList variant="line" className="min-w-full justify-start">
          {files.map((file) => (
            <TabsTrigger key={file.relativePath} value={file.relativePath}>
              {file.relativePath}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>

      {files.map((file) => (
        <TabsContent
          key={file.relativePath}
          value={file.relativePath}
          className="min-h-0 flex-1 overflow-hidden"
        >
          <FilePreview file={file} />
        </TabsContent>
      ))}
    </Tabs>
  )
}

function ContentDetailDialog({
  item,
  onOpenChange,
  onStatusChange,
  open,
}: ContentDetailDialogProps) {
  const { activeFilePath, files, isLoading, previewError, setActiveFilePath } = useContentDetail(item, open)

  if (!item) {
    return null
  }

  const categoryLabel = getCategoryLabel(item.type, item.category)
  const iconOption = getContentIconOption(item.icon)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
        <DialogHeader className="px-5 pt-5">
          <div className="flex items-start justify-between gap-4 pr-8">
            <div className="flex min-w-0 items-start gap-4">
              <ContentIconBadge size="lg" tone={item.iconBg} title={item.title}>
                {iconOption ? (
                  <iconOption.icon className="size-6" />
                ) : (
                  <span className="block max-w-full truncate px-1 leading-none">{item.icon}</span>
                )}
              </ContentIconBadge>

              <div className="min-w-0 space-y-2">
                <DialogTitle className="truncate">{item.title}</DialogTitle>
                <DialogDescription className="text-sm">{item.description}</DialogDescription>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>分类：{categoryLabel}</span>
                  <span>作者：{item.author}</span>
                  <span>创建于：{formatDateTime(item.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center">
              <ContentActionSplitButton item={item} onStatusChange={onStatusChange} />
            </div>
          </div>
        </DialogHeader>

        <Separator className="mt-5" />

        <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 py-4">
          <ContentPreviewArea
            activeFilePath={activeFilePath}
            files={files}
            isLoading={isLoading}
            previewError={previewError}
            setActiveFilePath={setActiveFilePath}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>文件数：{files.length}</span>
            {activeFilePath ? <span>当前文件：{activeFilePath}</span> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { ContentDetailDialog }
