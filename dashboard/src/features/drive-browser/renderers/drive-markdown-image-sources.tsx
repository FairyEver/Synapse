import { useCallback, useMemo, useState, type ReactNode } from 'react'
import type {
  DriveBrowserEditDto,
  DriveDocumentImageImportResult,
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

type DriveDocumentImageImportFailure = DriveDocumentImageImportResult['failed'][number]

const IMAGE_SOURCE_KIND_LABELS: Record<DriveDocumentImageSource['kind'], string> = {
  owner_asset: '我的素材',
  collaborator_asset: '协作者素材',
  external: '外部图片',
  relative: '相对路径',
  data: '内嵌图片',
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
  const sourceCacheKey = useMemo(
    () => driveMarkdownImageSourceCacheKey(context, edit?.currentVersionId ?? null),
    [context, edit?.currentVersionId]
  )
  const [scanResult, setScanResult] = useState<{ readonly key: string; readonly sources: DriveDocumentImageSourcesDto } | null>(null)
  const sources = scanResult?.key === sourceCacheKey ? scanResult.sources : null
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [importFailures, setImportFailures] = useState<readonly DriveDocumentImageImportFailure[]>([])
  const currentVersionId = edit?.currentVersionId ?? sources?.versionId ?? null
  const importableCount = sources?.summary.importable ?? 0
  const canImport = Boolean(sources?.canImport && currentVersionId && editContext && !disabled)

  const scan = useCallback(async () => {
    if (!context || !editContext || !sourceCacheKey) {
      setScanResult(null)
      return
    }
    setLoading(true)
    setError(null)
    setNotice(null)
    setImportFailures([])
    try {
      setScanResult({ key: sourceCacheKey, sources: await scanImageSources(context) })
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : '图片来源加载失败。')
    } finally {
      setLoading(false)
    }
  }, [context, editContext, sourceCacheKey])

  const importSources = useCallback(async (srcValues: readonly string[]) => {
    if (!context || !currentVersionId || !editContext || srcValues.length === 0 || disabled) return
    const body: DriveDocumentImageImportRequest = {
      baseVersionId: currentVersionId,
      sources: srcValues.map((src) => ({ src })),
    }
    setImporting(true)
    setError(null)
    setNotice(null)
    setImportFailures([])
    try {
      const result = await importImageSources(context, body)
      const hasFailures = result.failed.length > 0 || result.summary.failedCount > 0
      let reloadFailed = false
      try {
        await editContext.reload()
        await scan()
      } catch {
        setNotice('图片转存已完成，预览刷新失败，请手动刷新。')
        reloadFailed = true
      }
      if (hasFailures) {
        setImportFailures(result.failed)
        return
      }
      if (reloadFailed) {
        return
      }
      setOpen(false)
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : '图片转存失败。')
    } finally {
      setImporting(false)
    }
  }, [context, currentVersionId, disabled, editContext, scan])

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setImportFailures([])
      setNotice(null)
      setOpen(false)
      return
    }
    setOpen(true)
    if (!sources && !loading && !disabled) void scan()
  }, [disabled, loading, scan, sources])

  const toolbarItem = useMemo<DriveRendererToolbarItem | null>(() => {
    if (!context || !editContext) return null
    const count = sources && importableCount > 0 ? ` ${importableCount}` : ''
    return {
      kind: 'button',
      id: 'markdown-image-sources',
      label: `图片来源${count}`,
      icon: Image,
      variant: 'outline',
      disabled: disabled || loading,
      onClick: () => handleOpenChange(true),
    }
  }, [context, disabled, editContext, handleOpenChange, importableCount, loading, sources])

  return {
    toolbarItem,
    panel: (
      <DriveMarkdownImageSourceDialog
        open={open}
        sources={sources}
        loading={loading}
        importing={importing}
        error={error}
        notice={notice}
        importFailures={importFailures}
        canImport={canImport}
        onOpenChange={handleOpenChange}
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

function driveMarkdownImageSourceCacheKey(
  context: DriveMarkdownImageSourceContext | undefined,
  versionId: string | null,
): string | null {
  if (!context) return null
  if (context.context === 'owner') return `owner:${context.itemId}:${versionId ?? ''}`
  return `share:${context.shareId}:${context.itemId ?? ''}:${versionId ?? ''}`
}

async function importImageSources(
  context: DriveMarkdownImageSourceContext,
  body: DriveDocumentImageImportRequest
): Promise<DriveDocumentImageImportResult> {
  if (context.context === 'owner') return driveBrowserApi.importOwnerImageSources(context.itemId, body)
  return driveBrowserApi.importShareImageSources(context.shareId, context.itemId, body)
}

function DriveMarkdownImageSourceDialog({
  open,
  sources,
  loading,
  importing,
  error,
  notice,
  importFailures,
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
  readonly notice: string | null
  readonly importFailures: readonly DriveDocumentImageImportFailure[]
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
        {notice ? <p className='text-sm text-muted-foreground'>{notice}</p> : null}
        {importFailures.length > 0 ? (
          <div className='grid gap-1 rounded-md border p-2 text-sm text-destructive'>
            <div>部分图片转存失败：{importFailures.length}</div>
            <ul className='list-disc pl-4'>
              {importFailures.map((failure) => (
                <li key={failure.src} className='break-all'>
                  {failure.src}：{failure.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
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
