import { useState } from 'react'
import { Copy, Loader2 } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { dashboardApi, type PasswordResetLinkResult } from '@/lib/api'
import { formatExactDateTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export function PasswordResetSettings() {
  const [passwordResetLink, setPasswordResetLink] = useState<PasswordResetLinkResult | null>(null)
  const createPasswordResetLink = useMutation({
    mutationFn: dashboardApi.createMyPasswordResetLink,
    onSuccess: setPasswordResetLink,
    onError: (mutationError: Error) => toast.error(mutationError.message),
  })

  function closeDialog() {
    setPasswordResetLink(null)
    createPasswordResetLink.reset()
  }

  async function copyPasswordResetLink() {
    if (!passwordResetLink) return
    try {
      await navigator.clipboard.writeText(passwordResetLink.resetUrl)
      toast.success('链接已复制')
    } catch {
      toast.error('复制失败，请手动复制')
    }
  }

  return (
    <>
      <section className='space-y-3'>
        <h3 className='text-lg font-medium'>密码</h3>
        <Button
          variant='outline'
          disabled={createPasswordResetLink.isPending}
          onClick={() => createPasswordResetLink.mutate()}
        >
          {createPasswordResetLink.isPending ? <Loader2 className='animate-spin' /> : null}
          {createPasswordResetLink.isPending ? '生成中' : '生成重置链接'}
        </Button>
      </section>
      <Dialog
        open={Boolean(passwordResetLink)}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>重置链接已生成</DialogTitle>
            <DialogDescription>
              重新生成会使旧链接失效，重置密码后需重新登录。关闭后无法再次查看。
            </DialogDescription>
          </DialogHeader>
          <div className='grid gap-3'>
            <div className='grid gap-2'>
              <Label htmlFor='password-reset-link'>重置链接</Label>
              <Input
                id='password-reset-link'
                readOnly
                value={passwordResetLink?.resetUrl ?? ''}
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
            <p className='text-sm text-muted-foreground'>
              有效至 {passwordResetLink ? formatExactDateTime(new Date(passwordResetLink.expiresAt)) : ''}
            </p>
          </div>
          <DialogFooter>
            <Button
              variant='outline'
              onClick={closeDialog}
            >
              关闭
            </Button>
            <Button onClick={() => void copyPasswordResetLink()}>
              <Copy />
              复制链接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
