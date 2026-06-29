import { useEffect, useState } from 'react'
import type { DriveBrowserItemDto, DriveSiteAccessMode, DriveSiteDto, DriveSitePreflightDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { driveApi } from '@/lib/api'

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

  useEffect(() => {
    setPreflight(null)
    if (!open || !folder) return
    let cancelled = false
    void driveApi.preflightSite(folder.id).then((result) => {
      if (!cancelled) setPreflight(result)
    })
    return () => {
      cancelled = true
    }
  }, [folder, open])

  const canPublish = Boolean(folder && preflight && preflight.sourceFolderItemId === folder.id)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>发布站点</DialogTitle>
        </DialogHeader>
        <div className='text-sm text-muted-foreground'>{folder?.name}</div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button>
          <Button
            type='button'
            disabled={!canPublish}
            onClick={() => {
              if (!folder || !preflight || preflight.sourceFolderItemId !== folder.id) return
              void driveApi.createSite({
                sourceFolderItemId: folder.id,
                name: folder.name,
                entryPath: preflight.defaultEntryPath,
                accessMode: 'public',
                expiresIn: 'forever',
              }).then(async () => {
                await onCreated()
                onOpenChange(false)
              })
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

  const load = async () => {
    const page = await driveApi.listSites({ offset: 0, limit: 50 })
    setSites([...page.items])
  }

  useEffect(() => {
    if (open) void load()
  }, [open])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-3xl' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>站点</DialogTitle>
        </DialogHeader>
        <div className='grid gap-2'>
          {sites.length === 0 ? <div className='text-sm text-muted-foreground'>暂无站点</div> : null}
          {sites.map((site) => (
            <div key={site.siteId} className='flex items-center justify-between gap-3 border-b py-2'>
              <div className='min-w-0'>
                <div className='truncate text-sm font-medium'>{site.name}</div>
                <div className='truncate text-xs text-muted-foreground'>{site.url}</div>
              </div>
              <div className='flex items-center gap-1'>
                <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.republishSite(site.siteId, { entryPath: site.entryPath }).then(load) }}>
                  重发
                </Button>
                <Button type='button' variant='ghost' size='sm' onClick={() => {
                  setAccessTarget(site)
                  setAccessMode(site.accessMode)
                }}>
                  访问设置
                </Button>
                {site.status === 'active' ? (
                  <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.disableSite(site.siteId).then(load) }}>停用</Button>
                ) : (
                  <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.enableSite(site.siteId).then(load) }}>启用</Button>
                )}
                <Button type='button' variant='ghost' size='sm' onClick={() => { void driveApi.deleteSite(site.siteId).then(load) }}>删除</Button>
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>关闭</Button>
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
              <Button type='button' variant='outline' onClick={() => setAccessTarget(null)}>取消</Button>
              <Button type='button' onClick={() => {
                if (!accessTarget) return
                void Promise.resolve(driveApi.updateSiteAccess(accessTarget.siteId, {
                  accessMode,
                  expiresIn: 'forever',
                })).then(async () => {
                  setAccessTarget(null)
                  await load()
                })
              }}>
                保存访问
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
