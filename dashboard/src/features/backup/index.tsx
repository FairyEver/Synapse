import { useState } from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Download, Trash2, Plus, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type BackupFile } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  ServerDataTable,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import { downloadBackupWithFeedback } from './backup-download'
import { getBackupListErrorMessage } from './backup-error'

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function noop() {}

export default function BackupPage() {
  const queryClient = useQueryClient()
  const [deleteTarget, setDeleteTarget] = useState<BackupFile | null>(null)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-backups'],
    queryFn: adminApi.listBackups,
  })

  const triggerBackup = useMutation({
    mutationFn: adminApi.triggerBackup,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      toast.success('备份已创建')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteBackup = useMutation({
    mutationFn: adminApi.deleteBackup,
    onSuccess: () => {
      setDeleteTarget(null)
      queryClient.invalidateQueries({ queryKey: ['admin-backups'] })
      toast.success('备份已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const backups = data ?? []
  const tableError = isError ? new Error(getBackupListErrorMessage(error)) : null
  const columns: ColumnDef<BackupFile>[] = [
    {
      accessorKey: 'filename',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='文件名' />
      ),
      cell: ({ row }) => (
        <LongText className='font-medium'>{row.original.filename}</LongText>
      ),
      enableSorting: false,
      meta: { className: 'max-w-0' },
    },
    {
      accessorKey: 'size',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='大小' />
      ),
      cell: ({ row }) => (
        <span className='tabular-nums'>{formatSize(row.original.size)}</span>
      ),
      meta: {
        className: 'w-28',
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) => (
        <RelativeTime className='tabular-nums' value={row.original.createdAt} />
      ),
      enableSorting: false,
      meta: { className: 'w-40' },
    },
    {
      id: 'actions',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='操作' />
      ),
      cell: ({ row }) => (
        <div className='flex justify-end gap-1'>
          <Button
            variant='ghost'
            size='icon'
            aria-label={`下载 ${row.original.filename}`}
            onClick={() => void downloadBackupWithFeedback(row.original.filename)}
          >
            <Download className='h-4 w-4' />
          </Button>
          <Button
            variant='ghost'
            size='icon'
            aria-label={`删除 ${row.original.filename}`}
            disabled={deleteBackup.isPending}
            onClick={() => setDeleteTarget(row.original)}
          >
            <Trash2 className='h-4 w-4' />
          </Button>
        </div>
      ),
      meta: {
        className: 'w-24',
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
  const toolbar = (
    <div className='flex justify-end'>
      <Button onClick={() => triggerBackup.mutate()} disabled={triggerBackup.isPending}>
        {triggerBackup.isPending ? <Loader2 className='mr-1 h-4 w-4 animate-spin' /> : <Plus className='mr-1 h-4 w-4' />}
        创建备份
      </Button>
    </div>
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>备份管理</h1>
      </Header>
      <Main>
        <ServerDataTable
          columns={columns}
          data={backups}
          page={1}
          pageSize={Math.max(backups.length, 1)}
          total={backups.length}
          toolbar={toolbar}
          error={tableError}
          isLoading={isLoading}
          loadingRowCount={3}
          onRetry={() => void refetch()}
          onPageChange={noop}
          onPageSizeChange={noop}
          showPagination={false}
        />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          title='删除备份'
          desc={deleteTarget ? `${deleteTarget.filename} 删除后不可恢复。` : ''}
          cancelBtnText='取消'
          confirmText='删除'
          destructive
          isLoading={deleteBackup.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteBackup.mutate(deleteTarget.filename)
          }}
        />
      </Main>
    </>
  )
}
