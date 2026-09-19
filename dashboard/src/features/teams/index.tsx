import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminTeamRow } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TeamNameDialog } from './team-dialogs'

export default function TeamsPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const [createOpen, setCreateOpen] = useState(false)
  const [renameTarget, setRenameTarget] = useState<AdminTeamRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminTeamRow | null>(null)
  const sortQuery = getServerTableSortQuery(sorting)

  const teamsQuery = useQuery({
    queryKey: ['admin-teams', page, pageSize, sortQuery],
    queryFn: () => adminApi.listTeams({ page, pageSize, ...sortQuery }),
  })

  const createTeam = useMutation({
    mutationFn: (name: string) => adminApi.createTeam(name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setCreateOpen(false)
      toast.success('已创建团队')
    },
  })

  const renameTeam = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      adminApi.renameTeam(id, name),
    onSuccess: (_team, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-team', variables.id] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setRenameTarget(null)
      toast.success('已保存')
    },
  })

  const deleteTeam = useMutation({
    mutationFn: (id: string) => adminApi.deleteTeam(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setDeleteTarget(null)
      toast.success('已删除团队')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const columns = useMemo<ColumnDef<AdminTeamRow>[]>(
    () => [
      {
        accessorKey: 'name',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='团队名称' />
        ),
        cell: ({ row }) => (
          <LongText className='font-medium'>{row.original.name}</LongText>
        ),
        meta: { className: 'max-w-0 w-1/3' },
      },
      {
        accessorKey: 'memberCount',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='成员' />
        ),
        cell: ({ row }) => `${row.original.memberCount} 人`,
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='创建时间' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.createdAt} />
        ),
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div
            className='flex justify-end'
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant='ghost'
                  size='icon'
                  className='size-8'
                  aria-label={`${row.original.name} 的团队操作`}
                >
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='end'>
                <DropdownMenuItem onSelect={() => setRenameTarget(row.original)}>
                  重命名
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant='destructive'
                  onSelect={() => setDeleteTarget(row.original)}
                >
                  删除团队
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ),
        meta: {
          className: 'w-16',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    []
  )

  function openTeam(team: AdminTeamRow) {
    void navigate({ to: '/teams/$teamId', params: { teamId: team.id } })
  }

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>团队</h1>
        {(teamsQuery.data?.total ?? 0) > 0 ? (
          <span className='text-sm text-muted-foreground'>
            共 {teamsQuery.data?.total} 个
          </span>
        ) : null}
      </Header>
      <Main>
        <ServerDataTable
          columns={columns}
          data={teamsQuery.data?.data ?? []}
          page={page}
          pageSize={pageSize}
          total={teamsQuery.data?.total ?? 0}
          error={teamsQuery.isError ? teamsQuery.error : null}
          isLoading={teamsQuery.isLoading}
          loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
          onRetry={() => void teamsQuery.refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sorting={sorting}
          onSortingChange={setSorting}
          getRowProps={(row) => ({
            className: 'cursor-pointer',
            onClick: () => openTeam(row.original),
          })}
          emptyMessage={
            <div className='flex flex-col items-center gap-2 py-2'>
              <p className='font-medium'>还没有团队</p>
              <p className='text-sm text-muted-foreground'>
                创建一个团队，然后把用户加进来。
              </p>
              <Button size='sm' onClick={() => setCreateOpen(true)}>
                <Plus />
                新建团队
              </Button>
            </div>
          }
          toolbar={
            (teamsQuery.data?.total ?? 0) > 0 ? (
              <Button size='sm' onClick={() => setCreateOpen(true)}>
                <Plus />
                新建团队
              </Button>
            ) : null
          }
        />
        <TeamNameDialog
          open={createOpen}
          title='新建团队'
          initialName=''
          submitText='创建'
          isPending={createTeam.isPending}
          error={createTeam.error instanceof Error ? createTeam.error.message : null}
          onOpenChange={(open) => {
            setCreateOpen(open)
            if (!open) createTeam.reset()
          }}
          onSubmit={(name) => createTeam.mutate(name)}
        />
        <TeamNameDialog
          open={Boolean(renameTarget)}
          title='重命名团队'
          initialName={renameTarget?.name ?? ''}
          submitText='保存'
          isPending={renameTeam.isPending}
          error={renameTeam.error instanceof Error ? renameTeam.error.message : null}
          onOpenChange={(open) => {
            if (!open) {
              setRenameTarget(null)
              renameTeam.reset()
            }
          }}
          onSubmit={(name) => {
            if (renameTarget) renameTeam.mutate({ id: renameTarget.id, name })
          }}
        />
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          title={deleteTarget ? `删除团队「${deleteTarget.name}」？` : ''}
          desc={
            deleteTarget
              ? deleteTarget.memberCount > 0
                ? `${deleteTarget.memberCount} 名成员不会因此被删除，只是不再属于这个团队。此操作无法撤销。`
                : '这个团队还没有成员。此操作无法撤销。'
              : ''
          }
          cancelBtnText='取消'
          confirmText='删除'
          destructive
          isLoading={deleteTeam.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteTeam.mutate(deleteTarget.id)
          }}
        />
      </Main>
    </>
  )
}
