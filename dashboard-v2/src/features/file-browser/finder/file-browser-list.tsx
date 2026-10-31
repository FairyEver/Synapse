import { Table } from '@heroui/react'
import type { ReactNode } from 'react'
import { formatBytes } from '@synapse/shared'
import { File, FileText, Folder } from 'lucide-react'
import { RelativeTime } from '@/components/relative-time'
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
  readonly renderFileActions?: (
    row: Extract<
      FileBrowserRow,
      {
        type: 'file'
      }
    >
  ) => ReactNode
}) {
  if (rows.length === 0) {
    return (
      <div className='flex h-full min-h-72 items-center justify-center text-sm text-muted'>
        暂无文件
      </div>
    )
  }
  return (
    <div className={'h-full min-h-0' + ' overflow-y-auto min-h-0'}>
      <Table>
        <Table.ScrollContainer>
          <Table.Content aria-label='文件列表'>
            <Table.Header>
              <Table.Column isRowHeader>名称</Table.Column>
              <Table.Column className='w-28 text-right'>大小</Table.Column>
              <Table.Column className='w-40 text-right'>更新时间</Table.Column>
              {renderFileActions ? (
                <Table.Column className='w-12 text-right' aria-label='操作' />
              ) : null}
            </Table.Header>
            <Table.Body>
              {rows.map((row) => {
                const path = row.type === 'folder' ? row.path : row.file.path
                const selected = selectedPath === path
                return (
                  <Table.Row
                    id={`${row.type}:${path}`}
                    key={`${row.type}:${path}`}
                    textValue={row.name}
                    className={cn(
                      'cursor-pointer',
                      selected && 'bg-surface-secondary'
                    )}
                    onAction={() => {
                      if (row.type === 'folder') onOpenFolder(row.path)
                      else onOpenFile(row.file.path)
                    }}
                  >
                    <Table.Cell>
                      <div className='flex min-w-0 items-center gap-2'>
                        {row.type === 'folder' ? (
                          <Folder className='size-4 shrink-0 text-muted' />
                        ) : row.file.kind === 'text' ? (
                          <FileText className='size-4 shrink-0 text-muted' />
                        ) : (
                          <File className='size-4 shrink-0 text-muted' />
                        )}
                        <span className='min-w-0 truncate font-medium'>
                          {row.name}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell className='text-right tabular-nums text-muted'>
                      {row.type === 'folder' ? '-' : formatBytes(row.file.size)}
                    </Table.Cell>
                    <Table.Cell className='text-right tabular-nums text-muted'>
                      {row.type === 'folder' ? (
                        '-'
                      ) : (
                        <RelativeTime
                          value={row.file.updatedAt}
                          className='tabular-nums'
                        />
                      )}
                    </Table.Cell>
                    {renderFileActions ? (
                      <Table.Cell className='text-right'>
                        <div
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={(event) => event.stopPropagation()}
                        >
                          {row.type === 'file' ? renderFileActions(row) : null}
                        </div>
                      </Table.Cell>
                    ) : null}
                  </Table.Row>
                )
              })}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>
    </div>
  )
}
