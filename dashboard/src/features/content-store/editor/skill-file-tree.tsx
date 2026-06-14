import { useEffect, useRef, useState } from 'react'
import { FilePlus, Pencil, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { formatContentStoreSize } from '../content-store-display'
import type { SkillEditorFile } from './content-store-editor-types'
import {
  addSkillTextFileWithPath,
  deleteSkillFile,
  renameSkillFile,
  replaceSkillFileFromUpload,
} from './content-store-file-model'

type SkillFileTreeProps = {
  files: SkillEditorFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
  onFilesChange: (files: SkillEditorFile[]) => void
}

export function SkillFileTree({
  files,
  selectedPath,
  onSelect,
  onFilesChange,
}: SkillFileTreeProps) {
  const uploadRef = useRef<HTMLInputElement | null>(null)
  const [pathInput, setPathInput] = useState('')
  const [renameInput, setRenameInput] = useState(selectedPath ?? '')

  useEffect(() => {
    setRenameInput(selectedPath ?? '')
  }, [selectedPath])

  async function handleAddTextFile() {
    try {
      const result = await addSkillTextFileWithPath(files, pathInput)
      onFilesChange(result.files)
      onSelect(result.path)
      setPathInput('')
    } catch (error) {
      toast.error(getMessage(error, '新增失败'))
    }
  }

  function handleRename() {
    if (!selectedPath) return
    try {
      const next = renameSkillFile(files, selectedPath, renameInput)
      onFilesChange(next)
      onSelect(next.find((file) => file.path === renameInput)?.path ?? renameInput)
    } catch (error) {
      toast.error(getMessage(error, '重命名失败'))
    }
  }

  function handleDelete() {
    if (!selectedPath) return
    try {
      const next = deleteSkillFile(files, selectedPath)
      onFilesChange(next)
      onSelect(next[0]?.path ?? 'SKILL.md')
    } catch (error) {
      toast.error(getMessage(error, '删除失败'))
    }
  }

  async function handleUpload(upload: File | undefined) {
    if (!upload) return
    try {
      const next = await replaceSkillFileFromUpload(files, upload)
      onFilesChange(next)
      onSelect(next.find((file) => file.path === upload.name)?.path ?? upload.name)
    } catch (error) {
      toast.error(getMessage(error, '上传失败'))
    } finally {
      if (uploadRef.current) uploadRef.current.value = ''
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card'>
      <div className='flex items-center justify-between gap-2 px-3 py-2'>
        <div className='flex min-w-0 items-center gap-2'>
          <div className='text-sm font-medium'>文件</div>
          <Badge variant='secondary'>{files.length}</Badge>
        </div>
        <Button
          type='button'
          variant='ghost'
          size='sm'
          onClick={() => uploadRef.current?.click()}
        >
          <Upload data-icon='inline-start' />
          上传
        </Button>
        <input
          ref={uploadRef}
          type='file'
          className='hidden'
          onChange={(event) => void handleUpload(event.target.files?.[0])}
        />
      </div>
      <Separator />
      <div className='grid gap-2 p-3'>
        <Label htmlFor='skill-file-path'>路径</Label>
        <div className='flex gap-2'>
          <Input
            id='skill-file-path'
            value={pathInput}
            onChange={(event) => setPathInput(event.target.value)}
            placeholder='docs/guide.md'
            className='h-8 text-sm'
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => void handleAddTextFile()}
          >
            <FilePlus data-icon='inline-start' />
            新建
          </Button>
        </div>
      </div>
      <Separator />
      <ScrollArea className='min-h-0 flex-1'>
        {files.length ? (
          <div className='p-2'>
            {files.map((file) => (
              <button
                key={file.path}
                type='button'
                data-active={file.path === selectedPath}
                className='flex h-8 w-full items-center justify-between gap-2 rounded-md px-2 text-left text-sm hover:bg-accent data-[active=true]:bg-accent'
                onClick={() => {
                  onSelect(file.path)
                }}
              >
                <span className='min-w-0 truncate'>{file.path}</span>
                {file.kind === 'binary' ? (
                  <span className='shrink-0 text-xs text-muted-foreground'>
                    {formatContentStoreSize(file.size)}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        ) : (
          <div className='p-3 text-sm text-muted-foreground'>暂无文件</div>
        )}
      </ScrollArea>
      <Separator />
      <div className='grid gap-3 p-3'>
        <div className='grid gap-2'>
          <Label htmlFor='skill-file-rename'>重命名</Label>
          <div className='flex gap-2'>
            <Input
              id='skill-file-rename'
              value={renameInput}
              onChange={(event) => setRenameInput(event.target.value)}
              disabled={!selectedPath || selectedPath === 'SKILL.md'}
              className='h-8 text-sm'
            />
            <Button
              type='button'
              variant='outline'
              size='sm'
              disabled={!selectedPath || selectedPath === 'SKILL.md'}
              onClick={handleRename}
            >
              <Pencil data-icon='inline-start' />
              应用
            </Button>
          </div>
        </div>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='w-full text-destructive hover:text-destructive'
          disabled={!selectedPath || selectedPath === 'SKILL.md'}
          onClick={handleDelete}
        >
          <Trash2 data-icon='inline-start' />
          删除文件
        </Button>
      </div>
    </div>
  )
}

function getMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}
