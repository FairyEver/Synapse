import { useEffect, useState } from 'react'
import type { DriveBrowserItemDto, DriveSiteAccessMode, DriveSiteDto, DriveSitePreflightDto } from '@synapse/shared'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { driveApi } from '@/lib/api'

const DRIVE_SITE_DIALOG_PAGE_SIZE = 50

export function DriveSiteCreateDialog({
  folder,
  open,
  onCreated,
  onOpenChange,
}: {
  readonly folder: Pick<DriveBrowserItemDto, 'id' | 'name'> | null
  readonly open: boolean
  readonly onCreated: () => Promise<void>
  readonly onOpenChange: (open: boolean) => void
}) {
  const [preflight, setPreflight] = useState<DriveSitePreflightDto | null>(null)
  const [entryPath, setEntryPath] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setPreflight(null)
    setEntryPath('')
    if (!open || !folder) return
    let cancelled = false
    void driveApi.preflightSite(folder.id).then((result) => {
      if (!cancelled) {
        setPreflight(result)
        setEntryPath(result.defaultEntryPath ?? '')
      }
    }).catch((error: unknown) => {
      if (!cancelled) toast(errorMessage(error, '站点检查失败'))
    })
    return () => {
      cancelled = true
    }
  }, [folder, open])

  const canPublish = Boolean(folder && preflight && preflight.sourceFolderItemId === folder.id && entryPath)

  const publishSite = async () => {
    if (submitting || !folder || !preflight || preflight.sourceFolderItemId !== folder.id || !entryPath) return
    setSubmitting(true)
    try {
      await driveApi.createSite({
        sourceFolderItemId: folder.id,
        name: folder.name,
        entryPath,
        accessMode: 'public',
        expiresIn: 'forever',
      })
      await onCreated()
      onOpenChange(false)
    } catch (error) {
      toast(errorMessage(error, '发布失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>发布站点</DialogTitle>
        </DialogHeader>
        <div className='grid gap-3'>
          <div className='text-sm text-muted-foreground'>{folder?.name}</div>
          {preflight?.htmlFiles.length ? (
            <div className='grid gap-2'>
              <label className='text-sm font-medium'>入口页</label>
              <Select value={entryPath} onValueChange={setEntryPath}>
                <SelectTrigger className='w-full'>
                  <SelectValue placeholder='选择入口页' />
                </SelectTrigger>
                <SelectContent>
                  {preflight.htmlFiles.map((htmlFile) => (
                    <SelectItem key={htmlFile} value={htmlFile}>{htmlFile}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : preflight ? (
            <div className='text-sm text-muted-foreground'>没有 HTML 文件</div>
          ) : null}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type='button'
            disabled={submitting || !canPublish}
            onClick={() => {
              void publishSite()
            }}
          >
            发布
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DriveSitesDialog({
  open,
  onOpenChange,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
}) {
  const [sites, setSites] = useState<DriveSiteDto[]>([])
  const [accessTarget, setAccessTarget] = useState<DriveSiteDto | null>(null)
  const [accessMode, setAccessMode] = useState<DriveSiteAccessMode>('public')
  const [deleteTarget, setDeleteTarget] = useState<DriveSiteDto | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)

  const load = async ({ offset = 0, append = false }: { readonly offset?: number; readonly append?: boolean } = {}) => {
    try {
      const page = await driveApi.listSites({ offset, limit: DRIVE_SITE_DIALOG_PAGE_SIZE })
      setSites((current) => append ? [...current, ...page.items] : [...page.items])
      setNextOffset(page.page.hasMore ? page.page.nextOffset : null)
    } catch (error) {
      toast(errorMessage(error, '站点加载失败'))
    }
  }

  const refreshLoadedSites = async () => {
    const targetCount = Math.max(DRIVE_SITE_DIALOG_PAGE_SIZE, sites.length)
    const loaded: DriveSiteDto[] = []
    let offset = 0
    let next: number | null = null
    try {
      while (loaded.length < targetCount) {
        const page = await driveApi.listSites({ offset, limit: DRIVE_SITE_DIALOG_PAGE_SIZE })
        loaded.push(...page.items)
        next = page.page.hasMore ? page.page.nextOffset : null
        if (!page.page.hasMore || page.page.nextOffset === null) break
        offset = page.page.nextOffset
      }
      setSites(loaded)
      setNextOffset(next)
    } catch (error) {
      toast(errorMessage(error, '站点加载失败'))
    }
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  const loadMore = async () => {
    if (nextOffset === null || loadingMore) return
    setLoadingMore(true)
    try {
      await load({ offset: nextOffset, append: true })
    } finally {
      setLoadingMore(false)
    }
  }

  const runSiteAction = async (action: () => Promise<unknown>, fallback: string) => {
    setSubmitting(true)
    try {
      await action()
      await refreshLoadedSites()
    } catch (error) {
      toast(errorMessage(error, fallback))
    } finally {
      setSubmitting(false)
    }
  }

  const updateSiteAccess = async () => {
    if (!accessTarget) return
    setSubmitting(true)
    try {
      await driveApi.updateSiteAccess(accessTarget.siteId, {
        accessMode,
        expiresIn: 'forever',
      })
      setAccessTarget(null)
      await refreshLoadedSites()
    } catch (error) {
      toast(errorMessage(error, '访问设置保存失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const deleteSite = async () => {
    if (!deleteTarget) return
    await runSiteAction(async () => {
      await driveApi.deleteSite(deleteTarget.siteId)
      setDeleteTarget(null)
    }, '删除失败')
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setAccessTarget(null)
      setDeleteTarget(null)
    }
    onOpenChange(nextOpen)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className='sm:max-w-3xl' aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>站点</DialogTitle>
          </DialogHeader>
          <div className='grid gap-2'>
            {sites.length === 0 ? <div className='text-sm text-muted-foreground'>暂无站点</div> : null}
            {sites.map((site) => (
              <div key={site.siteId} className='flex items-center justify-between gap-3 border-b py-2'>
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-medium'>{site.name}</div>
                  <Input value={site.password ? site.urlWithPassword : site.url} readOnly className='mt-1 font-mono text-xs' />
                </div>
                <div className='flex shrink-0 items-center gap-1'>
                  <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.republishSite(site.siteId, { entryPath: site.entryPath }), '重发失败') }}>
                    重发
                  </Button>
                  <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => {
                    setAccessTarget(site)
                    setAccessMode(site.accessMode)
                  }}>
                    访问设置
                  </Button>
                  {site.status === 'active' ? (
                    <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.disableSite(site.siteId), '停用失败') }}>停用</Button>
                  ) : site.status !== 'failed' ? (
                    <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.enableSite(site.siteId), '启用失败') }}>启用</Button>
                  ) : null}
                  <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => setDeleteTarget(site)}>删除</Button>
                </div>
              </div>
            ))}
            {nextOffset !== null ? (
              <div className='flex justify-center pt-2'>
                <Button type='button' variant='outline' size='sm' disabled={submitting || loadingMore} onClick={() => { void loadMore() }}>
                  {loadingMore ? '加载中' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => handleOpenChange(false)}>关闭</Button>
          </DialogFooter>
          <Dialog open={accessTarget !== null} onOpenChange={(nextOpen) => {
            if (!nextOpen) setAccessTarget(null)
          }}>
            <DialogContent aria-describedby={undefined}>
              <DialogHeader><DialogTitle>访问设置</DialogTitle></DialogHeader>
              <Select value={accessMode} onValueChange={(value) => setAccessMode(value as DriveSiteAccessMode)}>
                <SelectTrigger className='w-full'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='public'>公开</SelectItem>
                  <SelectItem value='password'>密码</SelectItem>
                </SelectContent>
              </Select>
              <DialogFooter>
                <Button type='button' variant='outline' disabled={submitting} onClick={() => setAccessTarget(null)}>取消</Button>
                <Button type='button' disabled={submitting} onClick={() => {
                  void updateSiteAccess()
                }}>
                  保存访问
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null)
        }}
        title={deleteTarget ? `删除${deleteTarget.name}` : '删除'}
        desc='将删除已发布站点。'
        cancelBtnText='取消'
        confirmText='删除'
        destructive
        isLoading={submitting}
        handleConfirm={() => {
          void deleteSite()
        }}
      />
    </>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
