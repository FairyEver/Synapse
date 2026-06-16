import { useRef } from 'react'
import Editor from '@monaco-editor/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { getCodeEditorLanguage } from '@/lib/code-editor-language'
import { formatContentStoreSize } from '../content-store-display'
import type { SkillEditorFile } from './content-store-editor-types'
import {
  replaceSkillFileFromUpload,
  updateSkillTextFile,
} from './content-store-file-model'

type SkillFileEditorProps = {
  files: SkillEditorFile[]
  selectedPath: string | null
  onFilesChange: (files: SkillEditorFile[]) => void
}

export function SkillFileEditor({
  files,
  selectedPath,
  onFilesChange,
}: SkillFileEditorProps) {
  const replaceRef = useRef<HTMLInputElement | null>(null)
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0] ?? null

  if (!selectedFile) {
    return (
      <div className='flex h-full min-h-0 items-center justify-center rounded-lg border bg-card p-4 text-sm text-muted-foreground'>
        暂无文件
      </div>
    )
  }

  async function handleTextChange(value: string | undefined) {
    if (!selectedFile || selectedFile.kind !== 'text') return
    try {
      onFilesChange(
        await updateSkillTextFile(files, selectedFile.path, value ?? '')
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '编辑失败')
    }
  }

  async function handleReplace(upload: File | undefined) {
    if (!upload || !selectedFile) return
    try {
      onFilesChange(
        await replaceSkillFileFromUpload(files, upload, selectedFile.path)
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换失败')
    }
  }

  return (
    <div className='flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-card'>
      <div className='flex min-h-12 flex-col gap-2 border-b px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between'>
        <div className='min-w-0 truncate font-medium'>{selectedFile.path}</div>
        <div className='flex shrink-0 items-center gap-2'>
          <span className='text-xs text-muted-foreground'>
            {formatContentStoreSize(selectedFile.size)}
          </span>
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => replaceRef.current?.click()}
          >
            替换
          </Button>
          <input
            ref={replaceRef}
            type='file'
            className='hidden'
            onChange={(event) => void handleReplace(event.target.files?.[0])}
          />
        </div>
      </div>
      {selectedFile.kind === 'text' ? (
        <div className='min-h-0 flex-1 overflow-hidden'>
          <Editor
            height='100%'
            language={getCodeEditorLanguage(selectedFile.path)}
            value={selectedFile.text}
            onChange={(value) => void handleTextChange(value)}
            options={{
              minimap: { enabled: false },
              wordWrap: 'on',
              scrollBeyondLastLine: false,
              fontSize: 13,
              tabSize: 2,
            }}
          />
        </div>
      ) : (
        <ScrollArea className='min-h-0 flex-1'>
          <div className='flex min-h-64 flex-col items-center justify-center gap-2 p-6 text-center text-sm'>
            <div className='font-medium'>{selectedFile.path}</div>
            <div className='text-muted-foreground'>二进制文件不可编辑</div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
