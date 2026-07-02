import { useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { ExternalLink } from 'lucide-react'
import type { SkillRepositoryStatus } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { toast } from 'sonner'
import {
  adminApi,
  type AdminSkillRepositoryRow,
} from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { RelativeTime } from '@/components/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type SkillRepositoryAdminPageProps = {
  search?: Record<string, unknown>
}

export default function SkillRepositoryAdminPage({
  search = {},
}: SkillRepositoryAdminPageProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(readPositiveNumber(search.page, 1))
  const [pageSize, setPageSize] = useState(readPositiveNumber(search.pageSize, 20))
  const [status, setStatus] = useState<SkillRepositoryStatus>(
    search.status === 'active' || search.status === 'removed'
      ? search.status
      : 'active'
  )
  const [query, setQuery] = useState(typeof search.query === 'string' ? search.query : '')
  const [removeTarget, setRemoveTarget] = useState<AdminSkillRepositoryRow | null>(null)
  const [sorting, setSorting] = useState<SortingState>(
    typeof search.sortBy === 'string'
      ? [{ id: search.sortBy, desc: search.sortOrder !== 'asc' }]
      : [{ id: 'updatedAt', desc: true }]
  )
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = {
    page,
    pageSize,
    status,
    query: query.trim() || undefined,
    ...sortQuery,
  }

  const repositoriesQuery = useQuery({
    queryKey: ['admin-skill-repositories', listQuery],
    queryFn: () => adminApi.listSkillRepositories(listQuery),
  })

  const moderationMutation = useMutation({
    mutationFn: ({ id, remove }: { id: string; remove: boolean }) =>
      remove
        ? adminApi.setSkillRepositoryRemoved(id)
        : adminApi.restoreSkillRepository(id),
    onSuccess: () => {
      setRemoveTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-skill-repositories'] })
      toast.success('已更新')
    },
    onError: (error) => toast.error(getErrorMessage(error, '更新失败')),
  })

  const columns = useMemo<ColumnDef<AdminSkillRepositoryRow>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='仓库' />
        ),
        cell: ({ row }) => (
          <div className='min-w-0'>
            <div className='truncate font-medium'>{row.original.title}</div>
            <div className='truncate text-muted-foreground'>{row.original.name}</div>
          </div>
        ),
      },
      {
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='作者' />
        ),
        cell: ({ row }) => getOwnerLabel(row.original.owner),
        enableSorting: false,
      },
      {
        accessorKey: 'visibility',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='可见性' />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.visibility === 'public' ? 'default' : 'outline'}>
            {row.original.visibility === 'public' ? '公开' : '私有'}
          </Badge>
        ),
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Badge variant={row.original.status === 'removed' ? 'destructive' : 'secondary'}>
            {row.original.status === 'removed' ? '已移除' : '正常'}
          </Badge>
        ),
      },
      {
        accessorKey: 'legacyInstallCount',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='旧安装量' />
        ),
        cell: ({ row }) => row.original.legacyInstallCount,
        meta: {
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='更新时间' />
        ),
        cell: ({ row }) => <RelativeTime value={row.original.updatedAt} />,
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            {row.original.owner.handle ? (
              <Button asChild variant='ghost' size='sm'>
                <Link
                  to='/skills/$ownerHandle/$repositoryName'
                  params={{
                    ownerHandle: row.original.owner.handle,
                    repositoryName: row.original.name,
                  }}
                >
                  <ExternalLink />
                  打开
                </Link>
              </Button>
            ) : null}
            <Button
              variant='ghost'
              size='sm'
              disabled={moderationMutation.isPending}
              onClick={(event) => {
                event.stopPropagation()
                if (row.original.status === 'removed') {
                  moderationMutation.mutate({ id: row.original.id, remove: false })
                  return
                }
                setRemoveTarget(row.original)
              }}
            >
              {row.original.status === 'removed' ? '恢复' : '移除'}
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
    ],
    [moderationMutation]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Skill 仓库</h1>
      </Header>
      <Main>
        <ServerDataTable
          columns={columns}
          data={repositoriesQuery.data?.data ?? []}
          page={page}
          pageSize={pageSize}
          total={repositoriesQuery.data?.total ?? 0}
          error={repositoriesQuery.isError ? repositoriesQuery.error : null}
          isLoading={repositoriesQuery.isLoading}
          onRetry={() => void repositoriesQuery.refetch()}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          sorting={sorting}
          onSortingChange={setSorting}
          toolbar={
            <div className='flex flex-wrap items-center gap-2'>
              <Input
                placeholder='搜索'
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
                className='h-8 w-45 lg:w-62.5'
              />
              <Select
                value={status}
                onValueChange={(value) => {
                  setStatus(value as SkillRepositoryStatus)
                  setPage(1)
                }}
              >
                <SelectTrigger size='sm' className='w-32'>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value='active'>正常</SelectItem>
                    <SelectItem value='removed'>已移除</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          }
        />
        <ConfirmDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
          title='移除仓库'
          desc={removeTarget ? `${removeTarget.title} 将从公开列表移除。` : ''}
          cancelBtnText='取消'
          confirmText='移除'
          destructive
          isLoading={moderationMutation.isPending}
          handleConfirm={() => {
            if (removeTarget) {
              moderationMutation.mutate({ id: removeTarget.id, remove: true })
            }
          }}
        />
      </Main>
    </>
  )
}

function readPositiveNumber(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return fallback
  return Math.floor(value)
}

function getOwnerLabel(owner: AdminSkillRepositoryRow['owner']): string {
  return owner.handle || owner.displayName || owner.id
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
