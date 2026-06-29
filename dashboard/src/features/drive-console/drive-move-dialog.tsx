import type { DriveBrowserItemDto } from '@synapse/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>移动</DialogTitle>
        </DialogHeader>
        <div className='text-sm text-muted-foreground'>{item?.name}</div>
        <DialogFooter>
          <Button type='button' variant='outline' disabled={submitting} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type='button' disabled={submitting} onClick={() => onSubmit(null)}>移动到根目录</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
