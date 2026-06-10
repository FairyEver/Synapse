import { useMemo, useState } from 'react'
import type { ContentStoreItemDto, ContentStoreType } from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Plus } from 'lucide-react'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import {
  DataTableColumnHeader,
  ServerDataTable,
  getServerTableSortQuery,
} from '@/components/data-table'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
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
import { canDeleteMyContent } from './content-store-actions'
import {
  formatContentStoreDate,
  getContentStoreTypeLabel,
} from './content-store-display'
import { buildContentStoreSearch, parseContentStoreSearch } from './content-store-search'

type MyContentListPageProps = {
  search?: Record<string, unknown>
}

const allTypesValue = 'all'

export default function MyContentListPage({
  search = {},
}: MyContentListPageProps) {
  const parsedSearch = parseContentStoreSearch(search)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [page, setPage] = useState(parsedSearch.page)
  const [pageSize, setPageSize] = useState(parsedSearch.pageSize)
  const [type, setType] = useState<ContentStoreType | ''>(
    parsedSearch.type ?? ''
  )
  const [query, setQuery] = useState(parsedSearch.query)
  const [deleteTarget, setDeleteTarget] = useState<ContentStoreItemDto | null>(
    null
  )
  const [sorting, setSorting] = useState<SortingState>(
    parsedSearch.sortBy
      ? [{ id: parsedSearch.sortBy, desc: parsedSearch.sortOrder !== 'asc' }]
      : []
  )
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = buildContentStoreSearch({
    page,
    pageSize,
    type,
    query,
    ...sortQuery,
  })

  const itemsQuery = useQuery({
    queryKey: ['my-content-store-items', listQuery],
    queryFn: () => dashboardApi.listMyContentStoreItems(listQuery),
  })

  const visibilityMutation = useMutation({
    mutationFn: ({
      id,
      visibility,
    }: {
      id: string
      visibility: 'private' | 'public'
    }) => dashboardApi.setContentStoreVisibility(id, visibility),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['my-content-store-items'] })
      toast.success('已更新')
    },
    onError: (error) => toast.error(getErrorMessage(error, '更新失败')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.deleteContentStoreItem(id),
    onSuccess: () => {
      setDeleteTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['my-content-store-items'] })
      toast.success('已删除')
    },
    onError: (error) => toast.error(getErrorMessage(error, '删除失败')),
  })

  const columns = useMemo<ColumnDef<ContentStoreItemDto>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='标题' />
        ),
        cell: ({ row }) => (
          <span className='font-medium'>{row.original.title}</span>
        ),
      },
      {
        accessorKey: 'type',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='类型' />
        ),
        cell: ({ row }) => getContentStoreTypeLabel(row.original.type),
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
        id: 'version',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='版本' />
        ),
        cell: ({ row }) =>
          row.original.latestVersionNumber
            ? `v${row.original.latestVersionNumber}`
            : '-',
        enableSorting: false,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='更新时间' />
        ),
        cell: ({ row }) => formatContentStoreDate(row.original.updatedAt),
      },
      {
        accessorKey: 'installCount',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='安装量' />
        ),
        cell: ({ row }) => row.original.installCount,
        meta: {
          thClassName: 'text-right',
          tdClassName: 'text-right',
        },
      },
      {
        id: 'actions',
        cell: ({ row }) => (
          <div className='flex justify-end gap-2'>
            <Button
              variant='ghost'
              className='h-8 px-2'
              onClick={(event) => {
                event.stopPropagation()
                void navigate({
                  to: '/my-content/$contentId',
                  params: { contentId: row.original.id },
                })
              }}
            >
              打开
            </Button>
            <Button
              variant='ghost'
              className='h-8 px-2'
              onClick={(event) => {
                event.stopPropagation()
                void navigate({
                  to: '/my-content/$contentId/edit',
                  params: { contentId: row.original.id },
                })
              }}
            >
              编辑
            </Button>
            <Button
              variant='ghost'
              className='h-8 px-2'
              disabled={visibilityMutation.isPending}
              onClick={(event) => {
                event.stopPropagation()
                visibilityMutation.mutate({
                  id: row.original.id,
                  visibility:
                    row.original.visibility === 'public' ? 'private' : 'public',
                })
              }}
            >
              {row.original.visibility === 'public' ? '取消公开' : '公开'}
            </Button>
            {canDeleteMyContent(row.original) ? (
              <Button
                variant='ghost'
                className='h-8 px-2'
                onClick={(event) => {
                  event.stopPropagation()
                  setDeleteTarget(row.original)
                }}
              >
                删除
              </Button>
            ) : null}
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
    [navigate, visibilityMutation]
  )

  return (
    <>
      <Header fixed>
        <div className='flex items-center justify-between gap-3'>
          <h1 className='text-lg font-semibold'>我的内容</h1>
          <Button asChild>
            <Link to='/my-content/new'>
              <Plus data-icon='inline-start' />
              新建
            </Link>
          </Button>
        </div>
      </Header>
      <Main>
        {itemsQuery.isLoading ? (
          <div className='text-muted-foreground'>加载中...</div>
        ) : (
          <ServerDataTable
            columns={columns}
            data={itemsQuery.data?.data ?? []}
            page={page}
            pageSize={pageSize}
            total={itemsQuery.data?.total ?? 0}
            error={itemsQuery.isError ? itemsQuery.error : null}
            onRetry={() => void itemsQuery.refetch()}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
            sorting={sorting}
            onSortingChange={setSorting}
            getRowProps={(row) => ({
              className: 'cursor-pointer',
              onClick: () => {
                void navigate({
                  to: '/my-content/$contentId',
                  params: { contentId: row.original.id },
                })
              },
            })}
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
                  value={type || allTypesValue}
                  onValueChange={(value) => {
                    setType(value === allTypesValue ? '' : (value as ContentStoreType))
                    setPage(1)
                  }}
                >
                  <SelectTrigger size='sm' className='w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allTypesValue}>全部类型</SelectItem>
                      <SelectItem value='skill'>Skill</SelectItem>
                      <SelectItem value='rule'>Rule</SelectItem>
                      <SelectItem value='prompt'>Prompt</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            }
          />
        )}
        <ConfirmDialog
          open={Boolean(deleteTarget)}
          onOpenChange={(open) => {
            if (!open) setDeleteTarget(null)
          }}
          title='删除内容'
          desc='删除后不可恢复。'
          confirmText='删除'
          cancelBtnText='取消'
          destructive
          isLoading={deleteMutation.isPending}
          handleConfirm={() => {
            if (deleteTarget) deleteMutation.mutate(deleteTarget.id)
          }}
        />
      </Main>
    </>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
