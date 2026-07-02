import { useRef, useState } from 'react'
import type { SkillRepositoryFileContentDto } from '@synapse/shared'
import { Download, MoreHorizontal, Upload } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { FileBrowserBreadcrumbs } from '../file-browser/finder/file-browser-breadcrumbs'
import { FileBrowserFullLayout, FileBrowserFileLayout } from '../file-browser/finder/file-browser-layout'
import { FileBrowserList } from '../file-browser/finder/file-browser-list'
import type { FileBrowserFileRow, FileBrowserTree } from '../file-browser/finder/file-browser-model'
import { FileBrowserCodeRenderer } from '../file-browser/renderers/code-renderer'
import { FileRendererShell, type FileRendererEditContext } from '../file-browser/renderers/renderer-shell'
import { isProtectedSkillRepositoryPath } from './skill-repository-view-model'

type FileUploadInput = {
  readonly path: string
  readonly contentBase64: string
  readonly mimeType?: string | null
  readonly expectedSha256?: string | null
}

export function SkillRepositoryFileBrowser({
  tree,
  selectedFilePath,
  fileContent,
  fileLoading,
  savingText,
  reloadingFile,
  onNavigateFolder,
  onOpenFile,
  onUploadFile,
  onRenameFile,
  onDeleteFile,
  onDownloadFile,
  onReloadText,
  onSaveText,
  readonlyMode = false,
}: {
  readonly tree: FileBrowserTree
  readonly selectedFilePath: string | null
  readonly fileContent: SkillRepositoryFileContentDto | null
  readonly fileLoading: boolean
  readonly savingText: boolean
  readonly reloadingFile: boolean
  readonly readonlyMode?: boolean
  readonly onNavigateFolder: (path: string) => void
  readonly onOpenFile: (path: string) => void
  readonly onUploadFile: (input: FileUploadInput) => Promise<unknown>
  readonly onRenameFile: (input: { readonly fromPath: string; readonly toPath: string }) => Promise<unknown>
  readonly onDeleteFile: (input: { readonly path: string; readonly expectedSha256?: string | null }) => Promise<unknown>
  readonly onDownloadFile: (path: string) => string
  readonly onReloadText: () => Promise<{ readonly text: string; readonly baseVersionId: string }>
  readonly onSaveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<{ readonly baseVersionId: string }>
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [replaceRow, setReplaceRow] = useState<FileBrowserFileRow | null>(null)
  const [renameRow, setRenameRow] = useState<FileBrowserFileRow | null>(null)
  const [deleteRow, setDeleteRow] = useState<FileBrowserFileRow | null>(null)
  const [renamePath, setRenamePath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const selectedName = lastPathSegment(selectedFilePath)
  const editContext: FileRendererEditContext | undefined = readonlyMode ? undefined : {
    reload: onReloadText,
    reloading: reloadingFile,
    saveText: onSaveText,
    savingText,
  }

  const handleFileInput = async (file: File) => {
    const targetPath = replaceRow
      ? replaceRow.file.path
      : [tree.currentPath, file.name].filter(Boolean).join('/')
    const expectedSha256 = replaceRow?.file.sha256 ?? null
    setError(null)
    try {
      await onUploadFile({
        path: targetPath,
        contentBase64: await fileToBase64(file),
        mimeType: file.type || null,
        expectedSha256,
      })
      if (replaceRow) onOpenFile(targetPath)
      setReplaceRow(null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传失败。')
    } finally {
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <section className='flex min-h-0 flex-1 flex-col gap-3'>
      <div className='flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between'>
        <FileBrowserBreadcrumbs breadcrumbs={tree.breadcrumbs} onNavigate={onNavigateFolder} />
        {!readonlyMode ? <div className='flex shrink-0 items-center gap-2'>
          {error ? <span className='text-sm text-destructive'>{error}</span> : null}
          <input
            ref={inputRef}
            type='file'
            className='hidden'
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void handleFileInput(file)
            }}
          />
          <Button
            type='button'
            variant='outline'
            size='sm'
            onClick={() => {
              setReplaceRow(null)
              inputRef.current?.click()
            }}
          >
            <Upload data-icon='inline-start' />
            上传
          </Button>
        </div> : null}
      </div>

      {selectedFilePath && fileContent ? (
        <FileBrowserFileLayout>
          {fileContent.file.kind === 'text' && fileContent.text !== null ? (
            <FileRendererShell title={selectedName ?? fileContent.file.path}>
              <FileBrowserCodeRenderer
                path={fileContent.file.path}
                text={fileContent.text}
                baseVersionId={fileContent.file.sha256}
                truncated={fileContent.truncated}
                editContext={editContext}
              />
            </FileRendererShell>
          ) : (
            <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>
              不支持在线编辑
            </div>
          )}
        </FileBrowserFileLayout>
      ) : (
        <FileBrowserFullLayout>
          {fileLoading ? (
            <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>加载中</div>
          ) : (
            <FileBrowserList
              rows={tree.rows}
              selectedPath={selectedFilePath}
              onOpenFolder={onNavigateFolder}
              onOpenFile={onOpenFile}
              renderFileActions={(row) => (
                <FileActions
                  row={row}
                  readonlyMode={readonlyMode}
                  onDownload={() => downloadFile(onDownloadFile(row.file.path))}
                  onReplace={() => {
                    setReplaceRow(row)
                    inputRef.current?.click()
                  }}
                  onRename={() => {
                    setRenameRow(row)
                    setRenamePath(row.file.path)
                  }}
                  onDelete={() => setDeleteRow(row)}
                />
              )}
            />
          )}
        </FileBrowserFullLayout>
      )}

      <Dialog open={Boolean(renameRow)} onOpenChange={(open) => { if (!open) setRenameRow(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重命名</DialogTitle>
          </DialogHeader>
          <form
            className='space-y-4'
            onSubmit={(event) => {
              event.preventDefault()
              if (!renameRow) return
              void onRenameFile({ fromPath: renameRow.file.path, toPath: renamePath }).then(() => setRenameRow(null))
            }}
          >
            <div className='grid gap-2'>
              <Label htmlFor='skill-repository-rename-path'>路径</Label>
              <Input id='skill-repository-rename-path' value={renamePath} onChange={(event) => setRenamePath(event.target.value)} />
            </div>
            <DialogFooter>
              <Button type='button' variant='outline' onClick={() => setRenameRow(null)}>取消</Button>
              <Button type='submit'>保存</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteRow)} onOpenChange={(open) => { if (!open) setDeleteRow(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除文件？</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteRow?.file.path}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!deleteRow) return
                void onDeleteFile({ path: deleteRow.file.path, expectedSha256: deleteRow.file.sha256 ?? null }).then(() => setDeleteRow(null))
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}

function FileActions({
  row,
  readonlyMode,
  onDownload,
  onReplace,
  onRename,
  onDelete,
}: {
  readonly row: FileBrowserFileRow
  readonly readonlyMode: boolean
  readonly onDownload: () => void
  readonly onReplace: () => void
  readonly onRename: () => void
  readonly onDelete: () => void
}) {
  const protectedFile = isProtectedSkillRepositoryPath(row.file.path)
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type='button' variant='ghost' size='icon' aria-label='文件操作'>
          <MoreHorizontal className='size-4' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuItem onClick={onDownload}>
          <Download data-icon='inline-start' />
          下载
        </DropdownMenuItem>
        {!readonlyMode ? <DropdownMenuItem onClick={onReplace}>替换</DropdownMenuItem> : null}
        {!readonlyMode && !protectedFile ? <DropdownMenuItem onClick={onRename}>重命名</DropdownMenuItem> : null}
        {!readonlyMode && !protectedFile ? <DropdownMenuItem onClick={onDelete}>删除</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function downloadFile(url: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.rel = 'noopener noreferrer'
  anchor.click()
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败。'))
    reader.readAsDataURL(file)
  })
}

function lastPathSegment(path: string | null): string | null {
  if (!path) return path
  const segments = path.split('/').filter(Boolean)
  return segments.length > 0 ? segments[segments.length - 1] : path
}
