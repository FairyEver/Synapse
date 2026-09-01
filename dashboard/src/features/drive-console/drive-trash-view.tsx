import { useEffect, useState } from 'react'
import type { DriveTrashItemDto, DriveTrashListPageDto } from '@synapse/shared'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { trackedDriveApi as driveApi } from '@/features/drive-browser/shared/drive-telemetry-api'

export function DriveTrashView({ onChanged }: { readonly onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<DriveTrashItemDto[]>([])
  const [page, setPage] = useState<DriveTrashListPageDto['page']>({ offset: 0, limit: 50, hasMore: false, nextOffset: null })
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DriveTrashItemDto | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const nextPage = await driveApi.listTrash({ offset: 0, limit: 50 })
      setItems([...nextPage.items])
      setPage(nextPage.page)
    } catch (error) {
      toast(errorMessage(error, '回收站加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const loadMore = async () => {
    if (!page.hasMore || page.nextOffset === null) return
    setLoadingMore(true)
    try {
      const nextPage = await driveApi.listTrash({ offset: page.nextOffset, limit: page.limit })
      setItems((current) => [...current, ...nextPage.items])
      setPage(nextPage.page)
    } catch (error) {
      toast(errorMessage(error, '回收站加载失败'))
    } finally {
      setLoadingMore(false)
    }
  }

  const restoreItem = async (item: DriveTrashItemDto) => {
    try {
      if (item.kind === 'public_asset') {
        if (!item.assetId) throw new Error('公开素材缺少资源 ID，无法恢复')
        await driveApi.restorePublicAsset(item.assetId)
      } else {
        await driveApi.restoreItem(item.id)
      }
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '恢复失败'))
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await driveApi.deleteTrashItem(deleteTarget.id)
      setDeleteTarget(null)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '删除失败'))
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className='text-sm text-muted-foreground'>加载中</div>
  if (items.length === 0) return <div className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>回收站为空</div>
  return (
    <>
      <div className='rounded-lg border bg-background'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>原路径</TableHead>
              <TableHead className='text-right'>操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.name}</TableCell>
                <TableCell className='text-muted-foreground'>{item.originalPath ?? '-'}</TableCell>
                <TableCell className='text-right'>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    data-drive-telemetry-event='web.drive.trash.restore'
                    onClick={() => {
                      void restoreItem(item)
                    }}
                  >
                    恢复
                  </Button>
                  <Button
                    type='button'
                    variant='ghost'
                    size='sm'
                    data-drive-telemetry-event='web.drive.trash.delete-open'
                    onClick={() => setDeleteTarget(item)}
                  >
                    删除
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {page.hasMore ? (
          <div className='flex justify-end border-t p-3'>
            <Button type='button' variant='outline' size='sm' disabled={loadingMore} onClick={() => { void loadMore() }}>
              {loadingMore ? '加载中' : '加载更多'}
            </Button>
          </div>
        ) : null}
      </div>
      <ConfirmDialog
        contentProps={{ 'data-drive-telemetry-scope': 'portal' }}
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `删除${deleteTarget.name}` : '删除'}
        desc='将永久删除，无法恢复。'
        cancelBtnText='取消'
        confirmText='删除'
        destructive
        isLoading={submitting}
        handleConfirm={() => {
          void deleteItem()
        }}
      />
    </>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
