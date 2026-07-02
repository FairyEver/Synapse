import type { ReactNode } from 'react'
import { File, FileText, Folder } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { FileBrowserRow } from './file-browser-model'

export function FileBrowserList({
  rows,
  selectedPath = null,
  onOpenFolder,
  onOpenFile,
  renderFileActions,
}: {
  readonly rows: readonly FileBrowserRow[]
  readonly selectedPath?: string | null
  readonly onOpenFolder: (path: string) => void
  readonly onOpenFile: (path: string) => void
  readonly renderFileActions?: (row: Extract<FileBrowserRow, { type: 'file' }>) => ReactNode
}) {
  if (rows.length === 0) {
    return (
      <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted-foreground'>
        暂无文件
      </div>
    )
  }

  return (
    <ScrollArea className='h-full min-h-0'>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead className='w-28 text-right'>大小</TableHead>
            <TableHead className='w-40'>更新时间</TableHead>
            {renderFileActions ? <TableHead className='w-12' /> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const path = row.type === 'folder' ? row.path : row.file.path
            const selected = selectedPath === path
            return (
              <TableRow
                key={`${row.type}:${path}`}
                role='button'
                tabIndex={0}
                aria-current={selected ? 'page' : undefined}
                className={cn('cursor-pointer', selected && 'bg-muted')}
                onClick={() => {
                  if (row.type === 'folder') onOpenFolder(row.path)
                  else onOpenFile(row.file.path)
                }}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  if (row.type === 'folder') onOpenFolder(row.path)
                  else onOpenFile(row.file.path)
                }}
              >
                <TableCell>
                  <div className='flex min-w-0 items-center gap-2'>
                    {row.type === 'folder' ? (
                      <Folder className='size-4 shrink-0 text-muted-foreground' />
                    ) : row.file.kind === 'text' ? (
                      <FileText className='size-4 shrink-0 text-muted-foreground' />
                    ) : (
                      <File className='size-4 shrink-0 text-muted-foreground' />
                    )}
                    <span className='min-w-0 truncate font-medium'>{row.name}</span>
                  </div>
                </TableCell>
                <TableCell className='text-right text-muted-foreground'>
                  {row.type === 'folder' ? '-' : formatBytes(row.file.size)}
                </TableCell>
                <TableCell className='text-muted-foreground'>
                  {row.type === 'folder' ? '-' : <RelativeTime value={row.file.updatedAt} />}
                </TableCell>
                {renderFileActions ? (
                  <TableCell
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                  >
                    {row.type === 'file' ? renderFileActions(row) : null}
                  </TableCell>
                ) : null}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
