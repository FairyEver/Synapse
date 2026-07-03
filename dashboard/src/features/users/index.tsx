import { useEffect, useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Pencil, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminUserRow, type LiveClientRow } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  getLiveClientSummary,
  mergeLiveClientSnapshot,
  upsertLiveClient,
} from './live-client-utils'
import {
  getUsersLiveClientStatusError,
  getUsersTableError,
  getUsersTableLoading,
} from './users-page-error'

export default function UsersPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [liveClients, setLiveClients] = useState<LiveClientRow[]>([])
  const [statusTarget, setStatusTarget] = useState<{
    user: AdminUserRow
    status: AdminUserRow['status']
  } | null>(null)
  const [noteTarget, setNoteTarget] = useState<AdminUserRow | null>(null)
  const [adminNoteDraft, setAdminNoteDraft] = useState('')
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, error, isError, isLoading, refetch } = useQuery({
    queryKey: ['admin-users', page, pageSize, sortQuery],
    queryFn: () => adminApi.listUsers({ page, pageSize, ...sortQuery }),
  })

  const {
    data: liveClientSnapshot,
    error: liveClientsError,
    isError: isLiveClientsError,
    refetch: refetchLiveClients,
  } = useQuery({
    queryKey: ['admin-live-clients'],
    queryFn: () => adminApi.listLiveClients(),
  })

  useEffect(() => {
    if (liveClientSnapshot) {
      setLiveClients((current) =>
        mergeLiveClientSnapshot(current, liveClientSnapshot)
      )
    }
  }, [liveClientSnapshot])

  useEffect(() => {
    return adminApi.subscribeLiveClients(
      (event) => {
        setLiveClients((current) => upsertLiveClient(current, event))
      },
      () => {
        void queryClient.invalidateQueries({ queryKey: ['admin-live-clients'] })
      }
    )
  }, [queryClient])

  const isTableLoading = getUsersTableLoading({
    isUsersError: isError,
    isUsersLoading: isLoading,
  })
  const tableError = getUsersTableError(isError, error)
  const liveClientStatusError = getUsersLiveClientStatusError(
    isLiveClientsError,
    liveClientsError
  )
  const retryTable = () => {
    void refetch()
    void refetchLiveClients()
  }

  const toggleStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      adminApi.updateUserStatus(id, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setStatusTarget(null)
      toast.success('用户状态已更新')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const updateAdminNote = useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote: string | null }) =>
      adminApi.updateUserAdminNote(id, adminNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setNoteTarget(null)
      setAdminNoteDraft('')
      toast.success('备注已保存')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  function handleToggle(user: AdminUserRow) {
    const newStatus = user.status === 'active' ? 'disabled' : 'active'
    setStatusTarget({ user, status: newStatus })
  }

  function openAdminNoteDialog(user: AdminUserRow) {
    setNoteTarget(user)
    setAdminNoteDraft(user.adminNote ?? '')
  }

  function confirmStatusChange() {
    if (!statusTarget) return
    toggleStatus.mutate({
      id: statusTarget.user.id,
      status: statusTarget.status,
    })
  }

  function saveAdminNote() {
    if (!noteTarget) return
    const trimmedAdminNote = adminNoteDraft.trim()
    updateAdminNote.mutate({
      id: noteTarget.id,
      adminNote: trimmedAdminNote ? trimmedAdminNote : null,
    })
  }

  const columns: ColumnDef<AdminUserRow>[] = [
    {
      accessorKey: 'email',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='邮箱' />
      ),
      cell: ({ row }) => (
        <span className='font-medium'>{row.original.email}</span>
      ),
    },
    {
      accessorKey: 'handle',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='用户名' />
      ),
      cell: ({ row }) => row.original.handle || '-',
    },
    {
      accessorKey: 'adminNote',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='备注' />
      ),
      cell: ({ row }) => {
        const adminNote = row.original.adminNote?.trim()
        return adminNote ? (
          <span
            className='block max-w-xs truncate text-muted-foreground'
            title={adminNote}
          >
            {adminNote}
          </span>
        ) : (
          <span className='text-muted-foreground'>-</span>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => (
        <Badge
          variant={row.original.status === 'active' ? 'default' : 'secondary'}
        >
          {row.original.status === 'active' ? '正常' : '禁用'}
        </Badge>
      ),
    },
    {
      id: 'teams',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='团队' />
      ),
      cell: ({ row }) =>
        row.original.memberships.map((m) => m.team.name).join(', ') || '-',
      enableSorting: false,
    },
    {
      id: 'liveClients',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='客户端' />
      ),
      cell: ({ row }) => {
        const summary = getLiveClientSummary(row.original.id, liveClients, {
          isSnapshotUnavailable: Boolean(liveClientStatusError),
        })

        return (
          <div className='flex flex-wrap items-center gap-2'>
            <Badge
              variant={
                summary.onlineCount > 0
                  ? 'default'
                  : summary.isUnknown
                    ? 'secondary'
                    : 'outline'
              }
            >
              {summary.label}
            </Badge>
            {summary.hasStale ? (
              <Badge variant='secondary'>不稳定</Badge>
            ) : null}
          </div>
        )
      },
      enableSorting: false,
    },
    {
      accessorKey: 'createdAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建时间' />
      ),
      cell: ({ row }) => <RelativeTime value={row.original.createdAt} />,
    },
    {
      id: 'actions',
      cell: ({ row }) => (
        <div className='flex justify-end gap-2'>
          <Button
            variant='ghost'
            className='h-8 px-2'
            onClick={() => openAdminNoteDialog(row.original)}
          >
            <Pencil className='size-4' />
            备注
          </Button>
          <Button
            variant='ghost'
            className='h-8 px-2'
            disabled={
              toggleStatus.isPending &&
              statusTarget?.user.id === row.original.id
            }
            onClick={() => handleToggle(row.original)}
          >
            {row.original.status === 'active' ? '禁用' : '启用'}
          </Button>
        </div>
      ),
      meta: {
        thClassName: 'text-right',
        tdClassName: 'text-right',
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]
  const liveClientToolbar = liveClientStatusError ? (
    <div className='flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm'>
      <span className='text-muted-foreground'>客户端状态未知</span>
      <Button variant='outline' size='sm' onClick={retryTable}>
        <RefreshCw className='size-4' />
        重试
      </Button>
    </div>
  ) : null
  const isAdminNoteUnchanged = noteTarget
    ? adminNoteDraft.trim() === (noteTarget.adminNote ?? '').trim()
    : true

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>用户管理</h1>
      </Header>
      <Main>
        {isTableLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            toolbar={liveClientToolbar}
            error={tableError}
            onRetry={retryTable}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
        <ConfirmDialog
          open={Boolean(statusTarget)}
          onOpenChange={(open) => {
            if (!open) setStatusTarget(null)
          }}
          title={statusTarget?.status === 'disabled' ? '禁用用户' : '启用用户'}
          desc={
            statusTarget
              ? statusTarget.status === 'disabled'
                ? `${statusTarget.user.email} 将被禁用，并断开桌面连接。`
                : `${statusTarget.user.email} 将恢复登录。`
              : ''
          }
          cancelBtnText='取消'
          confirmText={statusTarget?.status === 'disabled' ? '禁用' : '启用'}
          destructive={statusTarget?.status === 'disabled'}
          isLoading={toggleStatus.isPending}
          handleConfirm={confirmStatusChange}
        />
        <Dialog
          open={Boolean(noteTarget)}
          onOpenChange={(open) => {
            if (!open) {
              setNoteTarget(null)
              setAdminNoteDraft('')
            }
          }}
        >
          <DialogContent className='sm:max-w-md'>
            <DialogHeader>
              <DialogTitle>编辑备注</DialogTitle>
              <DialogDescription className='sr-only'>
                编辑用户备注。
              </DialogDescription>
            </DialogHeader>
            <div className='grid gap-2'>
              <Label htmlFor='admin-note'>备注</Label>
              <Textarea
                id='admin-note'
                value={adminNoteDraft}
                maxLength={500}
                rows={5}
                onChange={(event) => setAdminNoteDraft(event.target.value)}
              />
              <div className='text-xs text-muted-foreground'>
                {adminNoteDraft.length}/500
              </div>
            </div>
            <DialogFooter>
              <Button
                variant='outline'
                onClick={() => {
                  setNoteTarget(null)
                  setAdminNoteDraft('')
                }}
              >
                取消
              </Button>
              <Button
                disabled={updateAdminNote.isPending || isAdminNoteUnchanged}
                onClick={saveAdminNote}
              >
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Main>
    </>
  )
}
