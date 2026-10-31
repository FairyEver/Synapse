import { Button, Chip, Input, Link, ListBox, Select, toast } from '@heroui/react'
import { useMemo, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import type { SkillRepositoryStatus } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import {
  adminApi,
  type AdminSkillRepositoryRow,
} from '@/lib/api'
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
import { useDebouncedValue } from '@/hooks/use-debounced-value'

type SkillRepositoryAdminPageProps = {
  search?: Record<string, unknown>
}

export default function SkillRepositoryAdminPage({
  search = {},
}: SkillRepositoryAdminPageProps) {
  const queryClient = useQueryClient()
  const [page, setPage] = useState(readPositiveNumber(search.page, 1))
  const [pageSize, setPageSize] = useState(
    readPositiveNumber(search.pageSize, DEFAULT_DASHBOARD_PAGE_SIZE)
  )
  const [status, setStatus] = useState<SkillRepositoryStatus>(
    search.status === 'active' || search.status === 'removed'
      ? search.status
      : 'active'
  )
  const [query, setQuery] = useState(typeof search.query === 'string' ? search.query : '')
  const debouncedQuery = useDebouncedValue(query)
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
    query: debouncedQuery.trim() || undefined,
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
    onError: (error) => toast.danger(getErrorMessage(error, '更新失败')),
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
            <div className='truncate text-muted'>{row.original.name}</div>
          </div>
        ),
        meta: { className: 'max-w-0 w-1/3' },
      },
      {
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='作者' />
        ),
        cell: ({ row }) => (
          <div className='truncate'>{getOwnerLabel(row.original.owner)}</div>
        ),
        enableSorting: false,
        meta: { className: 'max-w-0 w-1/4' },
      },
      {
        accessorKey: 'visibility',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='可见性' />
        ),
        cell: ({ row }) => (
          <Chip color={row.original.visibility === 'public' ? "accent" : "default"}>
            {row.original.visibility === 'public' ? '公开' : '私有'}
          </Chip>
        ),
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='状态' />
        ),
        cell: ({ row }) => (
          <Chip color={row.original.status === 'removed' ? "danger" : "default"}>
            {row.original.status === 'removed' ? '已移除' : '正常'}
          </Chip>
        ),
        meta: { className: 'w-24' },
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='更新时间' />
        ),
        cell: ({ row }) => (
          <RelativeTime className='tabular-nums' value={row.original.updatedAt} />
        ),
        meta: { className: 'w-32' },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            {row.original.owner.handle ? (
              <Link href={`/console/skills/${encodeURIComponent(row.original.owner.handle)}/${encodeURIComponent(row.original.name)}`} target='_blank' rel='noreferrer' aria-label={`打开 ${row.original.title}`}>
                <ExternalLink className='size-4' />打开
              </Link>
            ) : null}
            <Button
              variant='ghost'
              size='sm'
              isDisabled={moderationMutation.isPending}
              onPress={() => {
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
          className: 'w-40',
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
                placeholder='按仓库筛选...'
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setPage(1)
                }}
                className='w-45 lg:w-62.5'
              />
              <Select aria-label="正常"
                value={status}
                onChange={(key) => ((value) => {
                  setStatus(value as SkillRepositoryStatus)
                  setPage(1)
                })(String(key ?? ''))}
              >
                <Select.Trigger  className='w-32'>
                  <Select.Value />
                <Select.Indicator /></Select.Trigger>
                <Select.Popover><ListBox>

                    <ListBox.Item id='active'>正常<ListBox.ItemIndicator /></ListBox.Item>
                    <ListBox.Item id='removed'>已移除<ListBox.ItemIndicator /></ListBox.Item>

                </ListBox></Select.Popover>
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
  return owner.handle || owner.id
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
