import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  DriveBrowserEditDto,
  DriveDocumentImageImportRequest,
  DriveDocumentImageSource,
  DriveDocumentImageSourcesDto,
} from '@synapse/shared'
import { Image } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { driveBrowserApi } from '@/lib/api'
import type { DriveRendererEditContext } from './drive-renderer-shell'
import type { DriveRendererToolbarItem } from './drive-renderer-toolbar-context'

export type DriveMarkdownImageSourceContext =
  | { readonly context: 'owner'; readonly itemId: string }
  | { readonly context: 'share'; readonly shareId: string; readonly itemId?: string | null }

type UseDriveMarkdownImageSourcesInput = {
  readonly context?: DriveMarkdownImageSourceContext
  readonly edit?: DriveBrowserEditDto | null
  readonly editContext?: DriveRendererEditContext
  readonly disabled?: boolean
}

const IMAGE_SOURCE_KIND_LABELS: Record<DriveDocumentImageSource['kind'], string> = {
  owner_asset: '我的素材',
  collaborator_asset: '协作者素材',
  external: '外部图片',
  relative: '相对路径',
  data: '内嵌图片',
  fallback: '无法转存',
  invalid: '无法转存',
  unsupported: '无法转存',
}

export function useDriveMarkdownImageSources({
  context,
  edit,
  editContext,
  disabled = false,
}: UseDriveMarkdownImageSourcesInput): {
  readonly toolbarItem: DriveRendererToolbarItem | null
  readonly panel: ReactNode
} {
  const [sources, setSources] = useState<DriveDocumentImageSourcesDto | null>(null)
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const currentVersionId = edit?.currentVersionId ?? sources?.versionId ?? null
  const importableCount = sources?.summary.importable ?? 0
  const visibleSourceCount = sources?.summary.total ?? 0
  const canImport = Boolean(sources?.canImport && currentVersionId && editContext && !disabled)

  const scan = useCallback(async () => {
    if (!context || !editContext) {
      setSources(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      setSources(await scanImageSources(context))
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : '图片来源加载失败。')
    } finally {
      setLoading(false)
    }
  }, [context, editContext])

  useEffect(() => {
    void scan()
  }, [scan])

  const importSources = useCallback(async (srcValues: readonly string[]) => {
    if (!context || !currentVersionId || !editContext || srcValues.length === 0 || disabled) return
    const body: DriveDocumentImageImportRequest = {
      baseVersionId: currentVersionId,
      sources: srcValues.map((src) => ({ src })),
    }
    setImporting(true)
    setError(null)
    try {
      await importImageSources(context, body)
      await editContext.reload()
      setOpen(false)
      await scan()
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '图片转存失败。')
    } finally {
      setImporting(false)
    }
  }, [context, currentVersionId, disabled, editContext, scan])

  const toolbarItem = useMemo<DriveRendererToolbarItem | null>(() => {
    if (!context || visibleSourceCount === 0) return null
    const count = importableCount > 0 ? ` ${importableCount}` : ''
    return {
      kind: 'button',
      id: 'markdown-image-sources',
      label: `图片来源${count}`,
      icon: Image,
      variant: 'outline',
      disabled: disabled || loading,
      onClick: () => setOpen(true),
    }
  }, [context, disabled, importableCount, loading, visibleSourceCount])

  return {
    toolbarItem,
    panel: (
      <DriveMarkdownImageSourceDialog
        open={open}
        sources={sources}
        loading={loading}
        importing={importing}
        error={error}
        canImport={canImport}
        onOpenChange={setOpen}
        onImport={importSources}
        onRefresh={scan}
      />
    ),
  }
}

async function scanImageSources(context: DriveMarkdownImageSourceContext): Promise<DriveDocumentImageSourcesDto> {
  if (context.context === 'owner') return driveBrowserApi.scanOwnerImageSources(context.itemId)
  return driveBrowserApi.scanShareImageSources(context.shareId, context.itemId)
}

async function importImageSources(
  context: DriveMarkdownImageSourceContext,
  body: DriveDocumentImageImportRequest
) {
  if (context.context === 'owner') return driveBrowserApi.importOwnerImageSources(context.itemId, body)
  return driveBrowserApi.importShareImageSources(context.shareId, context.itemId, body)
}

function DriveMarkdownImageSourceDialog({
  open,
  sources,
  loading,
  importing,
  error,
  canImport,
  onOpenChange,
  onImport,
  onRefresh,
}: {
  readonly open: boolean
  readonly sources: DriveDocumentImageSourcesDto | null
  readonly loading: boolean
  readonly importing: boolean
  readonly error: string | null
  readonly canImport: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onImport: (sources: readonly string[]) => void
  readonly onRefresh: () => void
}) {
  const importableSources = sources?.sources.filter((source) => source.canImport).map((source) => source.src) ?? []
  const canImportAll = canImport && importableSources.length > 0 && !importing

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>图片来源</DialogTitle>
        </DialogHeader>
        <div className='flex items-center justify-end gap-2'>
          {canImportAll ? (
            <Button type='button' size='sm' disabled={importing} onClick={() => onImport(importableSources)}>
              转存全部
            </Button>
          ) : null}
          <Button type='button' variant='outline' size='sm' disabled={loading || importing} onClick={onRefresh}>
            刷新
          </Button>
        </div>
        {error ? <p className='text-sm text-destructive'>{error}</p> : null}
        {sources ? (
          <div className='grid max-h-96 gap-2 overflow-auto'>
            {sources.sources.map((source) => (
              <ImageSourceRow
                key={source.id}
                source={source}
                importing={importing}
                canImport={canImport}
                onImport={onImport}
              />
            ))}
          </div>
        ) : (
          <p className='text-sm text-muted-foreground'>{loading ? '加载中' : '暂无图片'}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ImageSourceRow({
  source,
  importing,
  canImport,
  onImport,
}: {
  readonly source: DriveDocumentImageSource
  readonly importing: boolean
  readonly canImport: boolean
  readonly onImport: (sources: readonly string[]) => void
}) {
  const importEnabled = canImport && source.canImport && !importing
  return (
    <div className='grid gap-2 rounded-md border p-3'>
      <div className='flex items-center justify-between gap-2'>
        <span className='text-xs font-medium text-muted-foreground'>{IMAGE_SOURCE_KIND_LABELS[source.kind]}</span>
        {source.canImport ? (
          <Button type='button' variant='outline' size='sm' disabled={!importEnabled} onClick={() => onImport([source.src])}>
            转存
          </Button>
        ) : null}
      </div>
      <div className='break-all text-sm text-foreground'>{source.src}</div>
    </div>
  )
}
