import { useEffect, useState } from 'react'
import type { DriveAccessExpiresIn, DriveSiteDto } from '@synapse/shared'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { driveApi } from '@/lib/api'

const DRIVE_SITE_DIALOG_PAGE_SIZE = 50

export function DriveWebSharesPanel({
  active,
  onChanged,
  onCopyUrl,
}: {
  readonly active: boolean
  readonly onChanged: () => Promise<void>
  readonly onCopyUrl: (url: string) => Promise<void>
}) {
  const [sites, setSites] = useState<DriveSiteDto[]>([])
  const [accessTarget, setAccessTarget] = useState<DriveSiteDto | null>(null)
  const [passwordEnabled, setPasswordEnabled] = useState(true)
  const [expiresIn, setExpiresIn] = useState<DriveAccessExpiresIn>('3d')
  const [deleteTarget, setDeleteTarget] = useState<DriveSiteDto | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)

  const load = async ({ offset = 0, append = false }: { readonly offset?: number; readonly append?: boolean } = {}) => {
    setLoading(true)
    try {
      const page = await driveApi.listSites({ offset, limit: DRIVE_SITE_DIALOG_PAGE_SIZE })
      setSites((current) => append ? [...current, ...page.items] : [...page.items])
      setNextOffset(page.page.hasMore ? page.page.nextOffset : null)
    } catch (error) {
      toast(errorMessage(error, '网页分享加载失败'))
    } finally {
      setLoading(false)
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
      toast(errorMessage(error, '网页分享加载失败'))
    }
  }

  useEffect(() => {
    if (active) void load()
  }, [active])

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
      await onChanged()
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
        accessMode: passwordEnabled ? 'password' : 'public',
        expiresIn,
      })
      setAccessTarget(null)
      await refreshLoadedSites()
      await onChanged()
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

  return (
    <>
      <div className='grid gap-2'>
        {loading && sites.length === 0 ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
        {!loading && sites.length === 0 ? <div className='text-sm text-muted-foreground'>暂无网页分享</div> : null}
        {sites.map((site) => (
          <div key={site.siteId} className='flex items-center justify-between gap-3 border-b py-2'>
            <div className='min-w-0 flex-1'>
              <div className='truncate text-sm font-medium'>{site.name}</div>
              <Input value={site.password ? site.urlWithPassword : site.url} readOnly className='mt-1 font-mono text-xs' />
            </div>
            <div className='flex shrink-0 flex-wrap items-center justify-end gap-1'>
              <Button type='button' variant='ghost' size='sm' onClick={() => { void onCopyUrl(site.password ? site.urlWithPassword : site.url) }}>
                复制链接
              </Button>
              <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.republishSite(site.siteId, { entryPath: site.entryPath }), '更新网页失败') }}>
                更新网页
              </Button>
              <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => {
                setAccessTarget(site)
                setPasswordEnabled(site.passwordEnabled)
                setExpiresIn(site.expiresIn)
              }}>
                访问设置
              </Button>
              {site.status === 'active' ? (
                <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.disableSite(site.siteId), '停止分享失败') }}>停止分享</Button>
              ) : site.status !== 'failed' ? (
                <Button type='button' variant='ghost' size='sm' disabled={submitting} onClick={() => { void runSiteAction(() => driveApi.enableSite(site.siteId), '恢复分享失败') }}>恢复分享</Button>
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
      <Dialog open={accessTarget !== null} onOpenChange={(nextOpen) => {
        if (!nextOpen) setAccessTarget(null)
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>访问设置</DialogTitle></DialogHeader>
          <div className='grid gap-4'>
            <label className='flex items-center justify-between gap-3' htmlFor='drive-web-share-password-enabled'>
              <span className='text-sm font-medium'>需要密码</span>
              <Switch id='drive-web-share-password-enabled' checked={passwordEnabled} onCheckedChange={setPasswordEnabled} />
            </label>
            <div className='grid gap-2'>
              <Label htmlFor='drive-web-share-expires-in'>有效时长</Label>
              <ExpirySelect id='drive-web-share-expires-in' value={expiresIn} onValueChange={setExpiresIn} />
            </div>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' disabled={submitting} onClick={() => setAccessTarget(null)}>取消</Button>
            <Button type='button' disabled={submitting} onClick={() => { void updateSiteAccess() }}>保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setDeleteTarget(null)
        }}
        title={deleteTarget ? `删除${deleteTarget.name}` : '删除'}
        desc='将删除网页分享及其已发布副本。'
        cancelBtnText='取消'
        confirmText='删除'
        destructive
        isLoading={submitting}
        handleConfirm={() => { void deleteSite() }}
      />
    </>
  )
}

function ExpirySelect({
  id,
  value,
  onValueChange,
}: {
  readonly id: string
  readonly value: DriveAccessExpiresIn
  readonly onValueChange: (value: DriveAccessExpiresIn) => void
}) {
  return (
    <Select value={value} onValueChange={(nextValue) => onValueChange(nextValue as DriveAccessExpiresIn)}>
      <SelectTrigger id={id} className='w-full'><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value='3d'>3 天</SelectItem>
        <SelectItem value='7d'>7 天</SelectItem>
        <SelectItem value='30d'>30 天</SelectItem>
        <SelectItem value='1y'>1 年</SelectItem>
        <SelectItem value='forever'>永久</SelectItem>
      </SelectContent>
    </Select>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
