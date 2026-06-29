import { useEffect, useState } from 'react'
import type { ContentStoreType, ContentStoreVisibility } from '@synapse/shared'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { getContentStoreTypeLabel } from '../content-store-display'

type ContentStorePublishDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  type: ContentStoreType
  visibility: ContentStoreVisibility
  description: string
  isPublishing: boolean
  onDescriptionChange: (value: string) => void
  onPublish: (publishPublic: boolean) => Promise<unknown>
}

export function ContentStorePublishDialog({
  open,
  onOpenChange,
  title,
  type,
  visibility,
  description,
  isPublishing,
  onDescriptionChange,
  onPublish,
}: ContentStorePublishDialogProps) {
  const [publishPublic, setPublishPublic] = useState(visibility === 'public')
  const [isSubmitting, setIsSubmitting] = useState(false)
  useEffect(() => {
    if (open) {
      setPublishPublic(visibility === 'public')
      setIsSubmitting(false)
    }
  }, [open, visibility])

  const needsDescription = publishPublic && !description.trim()
  const isPublishDisabled = isPublishing || isSubmitting || needsDescription

  async function handlePublish() {
    if (isPublishDisabled) return
    setIsSubmitting(true)
    try {
      await onPublish(publishPublic)
      onOpenChange(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '发布失败')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>发布</DialogTitle>
        </DialogHeader>
        <div className='flex flex-col gap-4'>
          <div className='grid gap-2 text-sm'>
            <div className='font-medium'>{title || '未命名'}</div>
            <div className='text-muted-foreground'>{getContentStoreTypeLabel(type)}</div>
          </div>
          <div className='flex items-center justify-between gap-3 rounded-md border p-3'>
            <Label htmlFor='publish-public'>发布后公开</Label>
            <Switch
              id='publish-public'
              checked={publishPublic}
              onCheckedChange={setPublishPublic}
            />
          </div>
          {publishPublic ? (
            <div className='flex flex-col gap-2'>
              <Label htmlFor='publish-description'>描述</Label>
              <Textarea
                id='publish-description'
                value={description}
                onChange={(event) => onDescriptionChange(event.target.value)}
                aria-invalid={needsDescription}
              />
              {needsDescription ? (
                <div className='text-sm text-muted-foreground'>公开前需要填写描述</div>
              ) : null}
            </div>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type='button'
            variant='outline'
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type='button'
            disabled={isPublishDisabled}
            onClick={() => { void handlePublish() }}
          >
            发布
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
