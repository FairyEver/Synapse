import { Copy, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { AdminUserRow, PasswordResetLinkResult } from '@/lib/api'
import { formatExactDateTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

type UserPasswordResetLinkDialogProps = {
  open: boolean
  user: AdminUserRow | null
  result?: PasswordResetLinkResult
  isPending: boolean
  onGenerate: () => void
  onOpenChange: (open: boolean) => void
}

export function UserPasswordResetLinkDialog({
  open,
  user,
  result,
  isPending,
  onGenerate,
  onOpenChange,
}: UserPasswordResetLinkDialogProps) {
  async function copyLink() {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.resetUrl)
      toast.success('链接已复制')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>
            {result ? '重置链接已生成' : '生成重置链接'}
          </DialogTitle>
          <DialogDescription>
            {result
              ? `发送给 ${user?.email ?? '该用户'}。关闭后无法再次查看。`
              : `${user?.email ?? '该用户'} 的链接将在 30 分钟后失效。生成后，之前未使用的链接将失效。`}
          </DialogDescription>
        </DialogHeader>
        {result ? (
          <div className='grid gap-3'>
            <div className='grid gap-2'>
              <Label htmlFor='password-reset-link'>重置链接</Label>
              <Input
                id='password-reset-link'
                readOnly
                value={result.resetUrl}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <p className='text-sm text-muted-foreground'>
              有效至 {formatExactDateTime(new Date(result.expiresAt))}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            variant='outline'
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            {result ? '关闭' : '取消'}
          </Button>
          {result ? (
            <Button onClick={() => void copyLink()}>
              <Copy />
              复制链接
            </Button>
          ) : (
            <Button disabled={isPending} onClick={onGenerate}>
              {isPending ? <Loader2 className='animate-spin' /> : null}
              {isPending ? '生成中' : '生成链接'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
