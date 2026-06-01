import { useState } from 'react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { adminApi, type AdminInvitationRow } from '@/lib/api'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

export default function InvitationsPage() {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const [createdInviteUrl, setCreatedInviteUrl] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'createdAt', desc: true },
  ])
  const queryClient = useQueryClient()
  const sortQuery = getServerTableSortQuery(sorting)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-invitations', page, pageSize, sortQuery],
    queryFn: () => adminApi.listInvitations({ page, pageSize, ...sortQuery }),
  })

  const { data: teams } = useQuery({
    queryKey: ['admin-teams', 'invitation-create'],
    queryFn: () => adminApi.listTeams({ page: 1, pageSize: 100, sortBy: 'name', sortOrder: 'asc' }),
  })

  const createMutation = useMutation({
    mutationFn: adminApi.createInvitation,
    onSuccess: (result) => {
      setCreatedInviteUrl(result.inviteUrl)
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] })
      toast.success('邀请已创建')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  const deleteMutation = useMutation({
    mutationFn: adminApi.deleteInvitation,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-invitations'] })
      toast.success('邀请已删除')
    },
    onError: (err: Error) => toast.error(err.message),
  })

  async function copyInviteUrl(inviteUrl: string) {
    try {
      await navigator.clipboard.writeText(inviteUrl)
      toast.success('已复制')
    } catch {
      toast.error('复制失败')
    }
  }

  function handleCreateOpenChange(open: boolean) {
    setIsCreateOpen(open)
    if (!open) {
      setSelectedTeamId('')
      setCreatedInviteUrl('')
      createMutation.reset()
    }
  }

  const columns: ColumnDef<AdminInvitationRow>[] = [
    {
      accessorKey: 'type',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='类型' />
      ),
    },
    {
      id: 'team',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='团队' />
      ),
      cell: ({ row }) => row.original.team?.name ?? '-',
      enableSorting: false,
    },
    {
      id: 'createdBy',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='创建者' />
      ),
      cell: ({ row }) =>
        row.original.createdByAdmin?.email ??
        row.original.createdByUser?.email ??
        '-',
      enableSorting: false,
    },
    {
      id: 'status',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='状态' />
      ),
      cell: ({ row }) => {
        if (row.original.usedAt) return <Badge variant='default'>已使用</Badge>
        if (new Date(row.original.expiresAt) < new Date()) {
          return <Badge variant='secondary'>已过期</Badge>
        }
        return <Badge variant='outline'>有效</Badge>
      },
      enableSorting: false,
    },
    {
      accessorKey: 'expiresAt',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title='过期时间' />
      ),
      cell: ({ row }) =>
        new Date(row.original.expiresAt).toLocaleString('zh-CN'),
    },
    {
      id: 'actions',
      cell: ({ row }) => {
        const inviteUrl = row.original.inviteUrl
        return (
          <div className='flex justify-end gap-1'>
            {inviteUrl ? (
              <Button
                variant='ghost'
                className='h-8 w-8 p-0'
                onClick={() => void copyInviteUrl(inviteUrl)}
              >
                <Copy data-icon='inline-start' />
                <span className='sr-only'>复制</span>
              </Button>
            ) : null}
            <Button
              variant='ghost'
              className='h-8 w-8 p-0'
              onClick={() => deleteMutation.mutate(row.original.id)}
            >
              <Trash2 data-icon='inline-start' />
              <span className='sr-only'>删除</span>
            </Button>
          </div>
        )
      },
      enableSorting: false,
      enableHiding: false,
    },
  ]

  return (
    <>
      <Header>
        <div className='flex flex-1 items-center justify-between gap-3'>
          <h1 className='text-lg font-semibold'>邀请管理</h1>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus />
            创建邀请
          </Button>
        </div>
      </Header>
      <Main>
        {isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={data?.total ?? 0}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
          />
        )}
      </Main>
      <Dialog open={isCreateOpen} onOpenChange={handleCreateOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>创建邀请</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='team-id'>团队</Label>
              <Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
                <SelectTrigger id='team-id' className='w-full'>
                  <SelectValue placeholder='选择团队' />
                </SelectTrigger>
                <SelectContent>
                  {(teams?.data ?? []).map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {createdInviteUrl ? (
              <div className='space-y-2'>
                <Label htmlFor='invite-url'>邀请链接</Label>
                <div className='flex gap-2'>
                  <Input id='invite-url' readOnly value={createdInviteUrl} />
                  <Button
                    type='button'
                    variant='outline'
                    onClick={() => void copyInviteUrl(createdInviteUrl)}
                  >
                    <Copy />
                    复制
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => handleCreateOpenChange(false)}>
              关闭
            </Button>
            <Button
              disabled={!selectedTeamId || createMutation.isPending}
              onClick={() => createMutation.mutate({ teamId: selectedTeamId })}
            >
              {createMutation.isPending ? <Loader2 className='animate-spin' /> : null}
              生成
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
