import { useEffect, useRef, useState } from 'react'
import type { DrivePublicAssetDto } from '@synapse/shared'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDriveBrowserBytes } from '@/features/drive-browser/shared/drive-format'
import { driveApi } from '@/lib/api'

export function DrivePublicAssetsView({ onChanged }: { readonly onChanged: () => Promise<void> }) {
  const [items, setItems] = useState<DrivePublicAssetDto[]>([])
  const [loading, setLoading] = useState(true)
  const [renameTarget, setRenameTarget] = useState<DrivePublicAssetDto | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<DrivePublicAssetDto | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const replaceTargetRef = useRef<DrivePublicAssetDto | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)
  const replaceInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    setLoading(true)
    try {
      const page = await driveApi.listPublicAssets({ offset: 0, limit: 50 })
      setItems([...page.items])
    } catch (error) {
      toast(errorMessage(error, '公开素材加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const uploadPublicAsset = async (file: File, target: DrivePublicAssetDto | null) => {
    const prepared = target
      ? await driveApi.preparePublicAssetReplace(target.assetId, { name: file.name, size: String(file.size), mimeType: file.type || null })
      : await driveApi.preparePublicAssetUpload({ name: file.name, size: String(file.size), mimeType: file.type || null })
    let completed = false
    try {
      const response = await fetch(prepared.upload.url, { method: prepared.upload.method, headers: prepared.upload.headers, body: file })
      if (!response.ok) throw new Error(response.statusText || '上传失败')
      if (target) {
        await driveApi.completePublicAssetReplace(target.assetId, prepared.sessionId)
      } else {
        await driveApi.completePublicAssetUpload(prepared.sessionId)
      }
      completed = true
      await load()
      await onChanged()
    } catch (error) {
      if (!completed) {
        try {
          if (target) {
            await driveApi.cancelPublicAssetReplace(target.assetId, prepared.sessionId)
          } else {
            await driveApi.cancelPublicAssetUpload(prepared.sessionId)
          }
        } catch {
          // Keep the original transfer error visible.
        }
      }
      throw error
    }
  }

  const runUpload = async (file: File, target: DrivePublicAssetDto | null) => {
    try {
      await uploadPublicAsset(file, target)
    } catch (error) {
      toast(errorMessage(error, '上传失败'))
    }
  }

  const renamePublicAsset = async () => {
    if (!renameTarget) return
    setSubmitting(true)
    try {
      await driveApi.renamePublicAsset(renameTarget.assetId, renameValue.trim())
      setRenameTarget(null)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '重命名失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const trashPublicAsset = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    try {
      await driveApi.trashPublicAsset(deleteTarget.assetId)
      setDeleteTarget(null)
      await load()
      await onChanged()
    } catch (error) {
      toast(errorMessage(error, '删除失败'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='grid gap-3'>
      <div className='flex justify-end'>
        <input
          ref={uploadInputRef}
          aria-label='上传公开素材'
          type='file'
          accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/x-icon'
          className='hidden'
          onChange={(event) => {
            const [file] = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            if (file) void runUpload(file, null)
          }}
        />
        <input
          ref={replaceInputRef}
          aria-label='替换公开素材'
          type='file'
          accept='image/png,image/jpeg,image/gif,image/webp,image/avif,image/x-icon'
          className='hidden'
          onChange={(event) => {
            const [file] = Array.from(event.currentTarget.files ?? [])
            event.currentTarget.value = ''
            const target = replaceTargetRef.current
            replaceTargetRef.current = null
            if (file && target) void runUpload(file, target)
          }}
        />
        <Button type='button' variant='outline' size='sm' onClick={() => uploadInputRef.current?.click()}>上传公开素材</Button>
      </div>
      {loading ? <div className='text-sm text-muted-foreground'>加载中</div> : null}
      {!loading && items.length === 0 ? <div className='rounded-lg border p-6 text-center text-sm text-muted-foreground'>暂无公开素材</div> : null}
      {!loading && items.length > 0 ? (
        <div className='rounded-lg border bg-background'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead className='text-right'>大小</TableHead>
                <TableHead className='text-right'>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.assetId}>
                  <TableCell>{item.name}</TableCell>
                  <TableCell className='text-right text-muted-foreground'>{formatDriveBrowserBytes(item.size)}</TableCell>
                  <TableCell className='text-right'>
                    <Button type='button' variant='ghost' size='sm' asChild>
                      <a href={item.url} target='_blank' rel='noreferrer'>打开</a>
                    </Button>
                    <Button type='button' variant='ghost' size='sm' onClick={() => {
                      setRenameTarget(item)
                      setRenameValue(item.name)
                    }}>
                      重命名
                    </Button>
                    <Button type='button' variant='ghost' size='sm' onClick={() => {
                      replaceTargetRef.current = item
                      replaceInputRef.current?.click()
                    }}>
                      替换
                    </Button>
                    <Button type='button' variant='ghost' size='sm' onClick={() => setDeleteTarget(item)}>
                      删除
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
      <Dialog open={renameTarget !== null} onOpenChange={(open) => {
        if (!open) setRenameTarget(null)
      }}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>重命名</DialogTitle></DialogHeader>
          <div className='grid gap-2'>
            <Label htmlFor='drive-public-asset-name'>素材名称</Label>
            <Input id='drive-public-asset-name' value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setRenameTarget(null)}>取消</Button>
            <Button type='button' disabled={submitting || !renameTarget || renameValue.trim().length === 0} onClick={() => {
              void renamePublicAsset()
            }}>
              保存
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={deleteTarget ? `删除${deleteTarget.name}` : '删除'}
        desc='素材会进入回收站。'
        cancelBtnText='取消'
        confirmText='删除'
        destructive
        isLoading={submitting}
        handleConfirm={() => {
          void trashPublicAsset()
        }}
      />
    </div>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message
  return fallback
}
