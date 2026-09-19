import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from '@tanstack/react-router'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { ArrowLeft, MoreHorizontal, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { adminApi, type AdminTeamMemberRow } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DEFAULT_DASHBOARD_PAGE_SIZE,
  ServerDataTable,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { LongText } from '@/components/long-text'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AddMembersDialog } from './add-members-dialog'
import { TeamNameDialog } from './team-dialogs'

export default function TeamDetailPage() {
  const { teamId } = useParams({ from: '/_authenticated/teams/$teamId' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting] = useState<SortingState>([])
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addMembersOpen, setAddMembersOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<AdminTeamMemberRow | null>(null)

  const teamQuery = useQuery({
    queryKey: ['admin-team', teamId],
    queryFn: () => adminApi.getTeam(teamId),
  })

  const membersQuery = useQuery({
    queryKey: ['admin-team-members', teamId, page, pageSize],
    queryFn: () => adminApi.listTeamMembers(teamId, { page, pageSize }),
  })

  const renameTeam = useMutation({
    mutationFn: (name: string) => adminApi.renameTeam(teamId, name),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-team', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setRenameOpen(false)
      toast.success('已保存')
    },
  })

  const deleteTeam = useMutation({
    mutationFn: () => adminApi.deleteTeam(teamId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      toast.success('已删除团队')
      void navigate({ to: '/teams' })
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const removeMember = useMutation({
    mutationFn: (userId: string) => adminApi.removeTeamMember(teamId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-team-members', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-team', teamId] })
      void queryClient.invalidateQueries({ queryKey: ['admin-teams'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
      setRemoveTarget(null)
      toast.success('已移出团队')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const columns = useMemo<ColumnDef<AdminTeamMemberRow>[]>(
    () => [
      {
        accessorKey: 'email',
        header: '邮箱',
        cell: ({ row }) => (
          <LongText className='font-medium'>{row.original.email}</LongText>
        ),
        meta: { className: 'max-w-0 w-1/3' },
      },
      {
        accessorKey: 'handle',
        header: '用户名',
        cell: ({ row }) => <LongText>{row.original.handle || '-'}</LongText>,
        meta: { className: 'max-w-0 w-1/5' },
      },
      {
        accessorKey: 'status',
        header: '状态',
        cell: ({ row }) => (
          <Badge
            variant={row.original.status === 'active' ? 'default' : 'secondary'}
          >
            {row.original.status === 'active' ? '正常' : '已禁用'}
          </Badge>
        ),
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'joinedAt',
        header: '加入时间',
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.joinedAt} />
        ),
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end'>
            <Button
              variant='ghost'
              size='sm'
              disabled={removeMember.isPending}
              onClick={() => setRemoveTarget(row.original)}
            >
              移除
            </Button>
          </div>
        ),
        meta: {
          className: 'w-20',
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
        enableSorting: false,
        enableHiding: false,
      },
    ],
    [removeMember.isPending]
  )

  const team = teamQuery.data

  return (
    <>
      <Header fixed>
        <Button
          variant='ghost'
          size='icon'
          className='size-8'
          aria-label='返回团队列表'
          onClick={() => void navigate({ to: '/teams' })}
        >
          <ArrowLeft />
        </Button>
        <h1 className='text-lg font-semibold'>{team?.name ?? '团队'}</h1>
        {team ? (
          <span className='text-sm text-muted-foreground'>
            {team.memberCount} 名成员 · 创建于{' '}
            <RelativeTime className='tabular-nums' value={team.createdAt} />
          </span>
        ) : null}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              className='ms-auto size-8'
              aria-label='团队操作'
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end'>
            <DropdownMenuItem onSelect={() => setRenameOpen(true)}>
              重命名
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant='destructive'
              onSelect={() => setDeleteOpen(true)}
            >
              删除团队
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </Header>
      <Main>
        <div className='flex items-center justify-between pb-2'>
          <h2 className='font-medium'>成员</h2>
          <Button
            variant='outline'
            size='sm'
            disabled={!team}
            onClick={() => setAddMembersOpen(true)}
          >
            <Plus />
            添加成员
          </Button>
        </div>
        <ServerDataTable
          columns={columns}
          data={membersQuery.data?.data ?? []}
          page={page}
          pageSize={pageSize}
          total={membersQuery.data?.total ?? 0}
          error={membersQuery.isError ? membersQuery.error : null}
          isLoading={membersQuery.isLoading}
          loadingRowCount={Math.min(pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)}
          onRetry={() => void membersQuery.refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sorting={sorting}
          emptyMessage={
            <div className='flex flex-col items-center gap-2 py-2'>
              <p className='font-medium'>这个团队还没有成员</p>
              <p className='text-sm text-muted-foreground'>
                添加成员后，他们会出现在这里。
              </p>
              <Button size='sm' onClick={() => setAddMembersOpen(true)}>
                <Plus />
                添加成员
              </Button>
            </div>
          }
        />
        <AddMembersDialog
          open={addMembersOpen}
          teamId={teamId}
          onOpenChange={setAddMembersOpen}
        />
        <TeamNameDialog
          open={renameOpen}
          title='重命名团队'
          initialName={team?.name ?? ''}
          submitText='保存'
          isPending={renameTeam.isPending}
          error={renameTeam.error instanceof Error ? renameTeam.error.message : null}
          onOpenChange={(open) => {
            setRenameOpen(open)
            if (!open) renameTeam.reset()
          }}
          onSubmit={(name) => renameTeam.mutate(name)}
        />
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={team ? `删除团队「${team.name}」？` : ''}
          desc={
            team
              ? team.memberCount > 0
                ? `${team.memberCount} 名成员不会因此被删除，只是不再属于这个团队。此操作无法撤销。`
                : '这个团队还没有成员。此操作无法撤销。'
              : ''
          }
          cancelBtnText='取消'
          confirmText='删除'
          destructive
          isLoading={deleteTeam.isPending}
          handleConfirm={() => deleteTeam.mutate()}
        />
        <ConfirmDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
          title={removeTarget ? `把 ${removeTarget.email} 移出团队？` : ''}
          desc={
            removeTarget
              ? `${removeTarget.handle} 的账号不受影响，其他团队的成员关系也不变。`
              : ''
          }
          cancelBtnText='取消'
          confirmText='移除'
          isLoading={removeMember.isPending}
          handleConfirm={() => {
            if (removeTarget) removeMember.mutate(removeTarget.userId)
          }}
        />
      </Main>
    </>
  )
}
