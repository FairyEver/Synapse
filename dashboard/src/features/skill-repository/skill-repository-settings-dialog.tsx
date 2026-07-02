import { useEffect, useState } from 'react'
import type { SkillRepositoryDetailDto } from '@synapse/shared'
import { Link } from '@tanstack/react-router'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export function SkillRepositorySettingsDialog({
  repository,
  open,
  saving,
  deleting,
  error,
  onOpenChange,
  onSave,
  onDelete,
}: {
  readonly repository: SkillRepositoryDetailDto
  readonly open: boolean
  readonly saving: boolean
  readonly deleting: boolean
  readonly error: string | null
  readonly onOpenChange: (open: boolean) => void
  readonly onSave: (input: { readonly name: string; readonly title: string; readonly description: string | null; readonly visibility: 'private' | 'public' }) => Promise<void>
  readonly onDelete: () => Promise<void>
}) {
  const [name, setName] = useState(repository.name)
  const [title, setTitle] = useState(repository.title)
  const [description, setDescription] = useState(repository.description ?? '')
  const [visibility, setVisibility] = useState(repository.visibility)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState('')

  useEffect(() => {
    if (!open) return
    setName(repository.name)
    setTitle(repository.title)
    setDescription(repository.description ?? '')
    setVisibility(repository.visibility)
    setDeleteConfirm('')
  }, [open, repository.description, repository.name, repository.title, repository.visibility])

  const canDelete = deleteConfirm === repository.name

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>设置</DialogTitle>
          </DialogHeader>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault()
              void onSave({
                name,
                title,
                description: description.trim() ? description : null,
                visibility,
              })
            }}
          >
            <div className='grid gap-2'>
              <Label htmlFor='skill-repository-name'>仓库名</Label>
              <Input id='skill-repository-name' value={name} onChange={(event) => setName(event.target.value)} />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='skill-repository-title'>标题</Label>
              <Input id='skill-repository-title' value={title} onChange={(event) => setTitle(event.target.value)} />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='skill-repository-description'>描述</Label>
              <Textarea
                id='skill-repository-description'
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>
            <div className='grid gap-2'>
              <Label>可见性</Label>
              <Select value={visibility} onValueChange={(value: 'private' | 'public') => setVisibility(value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value='private'>私有</SelectItem>
                  <SelectItem value='public'>公开</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {repository.forkedFromRepositoryId ? (
              <div className='grid gap-2'>
                <Label>Fork 来源</Label>
                <Input value={repository.forkedFromRepositoryId} readOnly />
              </div>
            ) : null}
            {error ? (
              <div className='flex items-center justify-between gap-3 text-sm text-destructive'>
                <span>{error}</span>
                {error.includes('用户名') ? (
                  <Button type='button' variant='outline' size='sm' asChild>
                    <Link to='/settings'>设置</Link>
                  </Button>
                ) : null}
              </div>
            ) : null}
            <DialogFooter className='gap-2 sm:justify-between'>
              <Button type='button' variant='destructive' onClick={() => setDeleteOpen(true)}>
                删除
              </Button>
              <div className='flex gap-2'>
                <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>取消</Button>
                <Button type='submit' disabled={saving}>{saving ? '保存中' : '保存'}</Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除仓库？</AlertDialogTitle>
            <AlertDialogDescription>
              输入仓库名确认删除。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} />
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction disabled={!canDelete || deleting} onClick={() => { void onDelete() }}>
              {deleting ? '删除中' : '删除'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
