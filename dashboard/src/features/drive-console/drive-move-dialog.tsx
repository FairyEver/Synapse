import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type { DriveBrowserItemDto, DriveItemTreeEntryDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { trackedDriveApi as driveApi } from '@/features/drive-browser/shared/drive-telemetry-api'

const DRIVE_MOVE_TREE_LIMIT = 200

export function DriveMoveDialog({
  item,
  open,
  submitting,
  onOpenChange,
  onSubmit,
}: {
  readonly item: DriveBrowserItemDto | null
  readonly open: boolean
  readonly submitting: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (parentId: string | null) => void
}) {
  const [treeItems, setTreeItems] = useState<readonly DriveItemTreeEntryDto[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(null)
  const [selectedParentId, setSelectedParentId] = useState<string | null>(null)
  const folders = selectableMoveFolders(treeItems, item)

  useEffect(() => {
    if (!open) {
      setTreeItems([])
      setNextOffset(null)
      setSelectedParentId(null)
      return
    }

    let cancelled = false
    setLoadingFolders(true)
    setTreeItems([])
    setNextOffset(null)
    setSelectedParentId(null)
    void driveApi.listTree({ parentId: null, offset: 0, limit: DRIVE_MOVE_TREE_LIMIT })
      .then((page) => {
        if (cancelled) return
        setTreeItems(page.items)
        setNextOffset(page.hasMore ? page.nextOffset : null)
      })
      .catch((error) => {
        if (!cancelled) toast(errorMessage(error, '目标位置加载失败'))
      })
      .finally(() => {
        if (!cancelled) setLoadingFolders(false)
      })

    return () => {
      cancelled = true
    }
  }, [item?.id, item?.type, open])

  const loadMoreFolders = async () => {
    if (loadingFolders || nextOffset === null) return
    setLoadingFolders(true)
    try {
      const page = await driveApi.listTree({ parentId: null, offset: nextOffset, limit: DRIVE_MOVE_TREE_LIMIT })
      setTreeItems((current) => [...current, ...page.items])
      setNextOffset(page.hasMore ? page.nextOffset : null)
    } catch (error) {
      toast(errorMessage(error, '目标位置加载失败'))
    } finally {
      setLoadingFolders(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-drive-telemetry-scope='portal' aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>移动</DialogTitle>
        </DialogHeader>
        <div className='grid gap-3'>
          <div className='text-sm text-muted-foreground'>{item?.name}</div>
          <div className='max-h-72 overflow-y-auto rounded-lg border p-1'>
            <Button
              type='button'
              variant={selectedParentId === null ? 'secondary' : 'ghost'}
              className='w-full justify-start'
              onClick={() => setSelectedParentId(null)}
            >
              根目录
            </Button>
            {folders.map((folder) => (
              <Button
                key={folder.id}
                type='button'
                variant={selectedParentId === folder.id ? 'secondary' : 'ghost'}
                className='w-full min-w-0 justify-start overflow-hidden'
                onClick={() => setSelectedParentId(folder.id)}
              >
                <span className='truncate'>{folder.path}</span>
              </Button>
            ))}
            {loadingFolders && treeItems.length === 0 ? <div className='px-3 py-2 text-sm text-muted-foreground'>加载中</div> : null}
            {!loadingFolders && folders.length === 0 ? <div className='px-3 py-2 text-sm text-muted-foreground'>暂无文件夹</div> : null}
            {nextOffset !== null ? (
              <div className='flex justify-center p-2'>
                <Button type='button' variant='outline' size='sm' disabled={loadingFolders} onClick={() => { void loadMoreFolders() }}>
                  {loadingFolders ? '加载中' : '加载更多'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button data-drive-telemetry-event='web.drive.item.move-submit' type='button' disabled={submitting} onClick={() => onSubmit(selectedParentId)}>移动</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function selectableMoveFolders(
  items: readonly DriveItemTreeEntryDto[],
  item: DriveBrowserItemDto | null
) {
  const blockedIds = new Set<string>()
  if (item?.type === 'folder') blockedIds.add(item.id)

  let changed = true
  while (changed) {
    changed = false
    for (const entry of items) {
      if (entry.parentId && blockedIds.has(entry.parentId) && !blockedIds.has(entry.id)) {
        blockedIds.add(entry.id)
        changed = true
      }
    }
  }

  return items.filter((entry) => entry.type === 'folder' && !blockedIds.has(entry.id))
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
