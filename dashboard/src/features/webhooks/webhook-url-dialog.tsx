import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type WebhookUrlDialogProps = {
  open: boolean
  title: string
  url: string
  onOpenChange: (open: boolean) => void
}

export function WebhookUrlDialog({
  open,
  title,
  url,
  onOpenChange,
}: WebhookUrlDialogProps) {
  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('已复制')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '复制失败')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className='grid gap-2'>
          <Label htmlFor='webhook-url'>URL</Label>
          <Input id='webhook-url' readOnly value={url} />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            关闭
          </Button>
          <Button onClick={() => void copyUrl()}>
            <Copy />
            复制
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
