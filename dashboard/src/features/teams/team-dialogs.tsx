import { useEffect, useState } from 'react'
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

export const teamNameMaxLength = 30

type TeamNameDialogProps = {
  open: boolean
  title: string
  initialName: string
  submitText: string
  isPending: boolean
  error: string | null
  onOpenChange: (open: boolean) => void
  onSubmit: (name: string) => void
}

export function TeamNameDialog({
  open,
  title,
  initialName,
  submitText,
  isPending,
  error,
  onOpenChange,
  onSubmit,
}: TeamNameDialogProps) {
  const [name, setName] = useState(initialName)

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  const trimmedName = name.trim()
  const tooLong = trimmedName.length > teamNameMaxLength
  const localError = tooLong
    ? `团队名称不能超过 ${teamNameMaxLength} 个字符。`
    : null
  const message = localError ?? error

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className='sr-only'>{title}。</DialogDescription>
        </DialogHeader>
        <div className='grid gap-2'>
          <Label htmlFor='team-name'>团队名称</Label>
          <Input
            id='team-name'
            value={name}
            autoComplete='off'
            aria-invalid={Boolean(message)}
            onChange={(event) => setName(event.target.value)}
          />
          {message ? (
            <p className='text-sm text-destructive'>{message}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            disabled={isPending || !trimmedName || tooLong}
            onClick={() => onSubmit(trimmedName)}
          >
            {submitText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
