import type { DriveDocumentImageSource, DriveDocumentImageSourcesDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

export type DriveMarkdownImageSourcePanelProps = {
  readonly open: boolean
  readonly sources: DriveDocumentImageSourcesDto | null
  readonly onOpenChange: (open: boolean) => void
  readonly onImport: (sources: readonly string[]) => void
  readonly onRefresh: () => void
}

const IMAGE_SOURCE_KIND_LABELS = {
  owner_asset: "我的素材",
  collaborator_asset: "协作者素材",
  external: "外部图片",
  relative: "相对路径",
  data: "内嵌图片",
  fallback: "无法转存",
  invalid: "无法转存",
  unsupported: "无法转存",
}

function imageSourceKindLabel(kind: DriveDocumentImageSource["kind"]): string {
  return IMAGE_SOURCE_KIND_LABELS[kind] ?? IMAGE_SOURCE_KIND_LABELS.fallback
}

export function DriveMarkdownImageSourcePanel({
  open,
  sources,
  onOpenChange,
  onImport,
  onRefresh,
}: DriveMarkdownImageSourcePanelProps) {
  const importableSources = sources?.sources.filter((source) => source.canImport).map((source) => source.src) ?? []
  const pendingSources = sources?.sources.filter((source) => source.kind !== "owner_asset") ?? []
  const ownerSources = sources?.sources.filter((source) => source.kind === "owner_asset") ?? []
  const canImportAll = Boolean(sources?.canImport && importableSources.length > 0)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>图片来源</SheetTitle>
        </SheetHeader>
        <div className="flex items-center justify-end gap-2 px-4">
          {canImportAll ? (
            <Button type="button" size="sm" onClick={() => onImport(importableSources)}>
              转存全部
            </Button>
          ) : null}
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            刷新
          </Button>
        </div>
        {sources ? (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-4 px-4 pb-4">
              <ImageSourceGroup title="需处理" sources={pendingSources} onImport={onImport} />
              <ImageSourceGroup title="已托管" sources={ownerSources} onImport={onImport} />
            </div>
          </ScrollArea>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function ImageSourceGroup({
  title,
  sources,
  onImport,
}: {
  readonly title: string
  readonly sources: readonly DriveDocumentImageSource[]
  readonly onImport: (sources: readonly string[]) => void
}) {
  if (sources.length === 0) return null

  return (
    <section className="grid gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid gap-2">
        {sources.map((source) => (
          <ImageSourceItem key={source.id} source={source} onImport={onImport} />
        ))}
      </div>
    </section>
  )
}

function ImageSourceItem({
  source,
  onImport,
}: {
  readonly source: DriveDocumentImageSource
  readonly onImport: (sources: readonly string[]) => void
}) {
  const canImport = source.canImport
  const showOwnerOnly = !canImport && source.kind !== "owner_asset"

  return (
    <div className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{imageSourceKindLabel(source.kind)}</span>
        {canImport ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onImport([source.src])}>
            转存
          </Button>
        ) : null}
        {showOwnerOnly ? (
          <span className="text-xs text-muted-foreground">所有者可转存</span>
        ) : null}
      </div>
      <div className="break-all text-sm text-foreground">{source.src}</div>
    </div>
  )
}
