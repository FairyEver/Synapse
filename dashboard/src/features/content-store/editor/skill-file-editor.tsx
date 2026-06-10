import { useRef } from 'react'
import Editor from '@monaco-editor/react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
    return <div className='rounded-md border p-4 text-sm text-muted-foreground'>暂无文件</div>
  }

  async function handleTextChange(value: string | undefined) {
    if (!selectedFile || selectedFile.kind !== 'text') return
    try {
      onFilesChange(await updateSkillTextFile(files, selectedFile.path, value ?? ''))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '编辑失败')
    }
  }

  async function handleReplace(upload: File | undefined) {
    if (!upload || !selectedFile) return
    try {
      onFilesChange(await replaceSkillFileFromUpload(files, upload, selectedFile.path))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '替换失败')
    }
  }

  return (
    <div className='flex min-h-0 flex-col rounded-md border'>
      <div className='flex items-center justify-between gap-3 border-b px-3 py-2 text-sm'>
        <div className='min-w-0 truncate font-medium'>{selectedFile.path}</div>
        <div className='flex shrink-0 items-center gap-3'>
          <span className='text-muted-foreground'>
            {formatContentStoreSize(selectedFile.size)}
          </span>
          <Button
            type='button'
            variant='outline'
            className='h-8 px-2'
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
        <div className='min-h-120'>
          <Editor
            height='480px'
            language={languageForPath(selectedFile.path)}
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
        <div className='flex min-h-80 flex-col gap-2 p-4 text-sm'>
          <div className='font-medium'>{selectedFile.path}</div>
          <div className='text-muted-foreground'>
            {formatContentStoreSize(selectedFile.size)}
          </div>
          <div className='text-muted-foreground'>二进制文件不可编辑</div>
        </div>
      )}
    </div>
  )
}

function languageForPath(path: string): string {
  if (path.endsWith('.json')) return 'json'
  if (path.endsWith('.ts') || path.endsWith('.tsx')) return 'typescript'
  if (path.endsWith('.js') || path.endsWith('.jsx') || path.endsWith('.mjs')) return 'javascript'
  if (path.endsWith('.yaml') || path.endsWith('.yml')) return 'yaml'
  if (path.endsWith('.css')) return 'css'
  if (path.endsWith('.html')) return 'html'
  return 'markdown'
}
