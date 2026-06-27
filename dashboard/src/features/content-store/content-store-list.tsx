import { useMemo, useState } from 'react'
import type { ContentStoreItemDto, ContentStoreType } from '@synapse/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { dashboardApi } from '@/lib/api'
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
import { canCopyContent, canInstallContent } from './content-store-actions'
import {
  getContentStoreOwnerName,
  getContentStoreTypeLabel,
} from './content-store-display'
import { buildContentStoreSearch, parseContentStoreSearch } from './content-store-search'

type ContentStoreListPageProps = {
  search?: Record<string, unknown>
}

const allTypesValue = 'all'

export default function ContentStoreListPage({
  search = {},
}: ContentStoreListPageProps) {
  const parsedSearch = parseContentStoreSearch(search)
  const navigate = useNavigate()
  const [page, setPage] = useState(parsedSearch.page)
  const [pageSize, setPageSize] = useState(parsedSearch.pageSize)
  const [type, setType] = useState<ContentStoreType | ''>(
    parsedSearch.type ?? ''
  )
  const [query, setQuery] = useState(parsedSearch.query)
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
    queryKey: ['content-store-items', listQuery],
    queryFn: () => dashboardApi.listContentStoreItems(listQuery),
  })

  const installMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.createContentStoreInstallSession(id),
    onSuccess: (session) => {
      window.location.href = session.deepLinkUrl
      window.setTimeout(() => {
        void navigate({
          to: '/content-store/install',
          search: { session: session.id },
        })
      }, 250)
    },
    onError: (error) => toast.error(getErrorMessage(error, '安装失败')),
  })

  const copyMutation = useMutation({
    mutationFn: (id: string) => dashboardApi.copyContentStoreItem(id),
    onSuccess: (item) => {
      toast.success('已复制')
      void navigate({
        to: '/my-content/$contentId',
        params: { contentId: item.id },
      })
    },
    onError: (error) => toast.error(getErrorMessage(error, '复制失败')),
  })

  const columns = useMemo<ColumnDef<ContentStoreItemDto>[]>(
    () => [
      {
        accessorKey: 'title',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='标题' />
        ),
        cell: ({ row }) => (
          <div className='flex min-w-0 flex-col gap-1'>
            <span className='font-medium'>{row.original.title}</span>
            {row.original.featured ? (
              <Badge variant='secondary' className='w-fit'>
                精选
              </Badge>
            ) : null}
          </div>
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
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='作者' />
        ),
        cell: ({ row }) => getContentStoreOwnerName(row.original.owner),
        enableSorting: false,
      },
      {
        accessorKey: 'updatedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='更新时间' />
        ),
        cell: ({ row }) => <RelativeTime value={row.original.updatedAt} />,
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
            {canInstallContent(row.original) ? (
              <Button
                variant='ghost'
                className='h-8 px-2'
                disabled={installMutation.isPending}
                onClick={(event) => {
                  event.stopPropagation()
                  installMutation.mutate(row.original.id)
                }}
              >
                安装
              </Button>
            ) : null}
            {canCopyContent(row.original) ? (
              <Button
                variant='ghost'
                className='h-8 px-2'
                disabled={copyMutation.isPending}
                onClick={(event) => {
                  event.stopPropagation()
                  copyMutation.mutate(row.original.id)
                }}
              >
                复制
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
    [copyMutation, installMutation]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>内容商店</h1>
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
                  to: '/content-store/$contentId',
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
      </Main>
    </>
  )
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim()
    ? error.message
    : fallback
}
