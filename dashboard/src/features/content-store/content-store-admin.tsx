import { useMemo, useState } from 'react'
import type {
  ContentStoreItemDto,
  ContentStoreModerationStatus,
  ContentStoreType,
  ContentStoreVisibility,
} from '@synapse/shared'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { type ColumnDef, type SortingState } from '@tanstack/react-table'
import { toast } from 'sonner'
import { adminApi } from '@/lib/api'
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  getContentStoreOwnerName,
  getContentStoreTypeLabel,
} from './content-store-display'
import { ContentStoreDetailView } from './content-store-detail'
import { parseContentStoreSearch } from './content-store-search'

type ContentStoreAdminPageProps = {
  search?: Record<string, unknown>
}

const allTypesValue = 'all'
const allVisibilityValue = 'all'
const allModerationValue = 'all'

export default function ContentStoreAdminPage({
  search = {},
}: ContentStoreAdminPageProps) {
  const parsedSearch = parseContentStoreSearch(search)
  const queryClient = useQueryClient()
  const [page, setPage] = useState(parsedSearch.page)
  const [pageSize, setPageSize] = useState(parsedSearch.pageSize)
  const [type, setType] = useState<ContentStoreType | ''>(
    parsedSearch.type ?? ''
  )
  const [visibility, setVisibility] = useState<ContentStoreVisibility | ''>(
    search.visibility === 'public' || search.visibility === 'private'
      ? search.visibility
      : ''
  )
  const [moderationStatus, setModerationStatus] = useState<
    ContentStoreModerationStatus | ''
  >(
    search.moderationStatus === 'normal' ||
      search.moderationStatus === 'removed'
      ? search.moderationStatus
      : ''
  )
  const [query, setQuery] = useState(parsedSearch.query)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [removeTarget, setRemoveTarget] = useState<ContentStoreItemDto | null>(null)
  const [sorting, setSorting] = useState<SortingState>(
    parsedSearch.sortBy
      ? [{ id: parsedSearch.sortBy, desc: parsedSearch.sortOrder !== 'asc' }]
      : [{ id: 'updatedAt', desc: true }]
  )
  const sortQuery = getServerTableSortQuery(sorting)
  const listQuery = {
    page,
    pageSize,
    type: type || undefined,
    visibility: visibility || undefined,
    moderationStatus: moderationStatus || undefined,
    query: query.trim() || undefined,
    ...sortQuery,
  }

  const itemsQuery = useQuery({
    queryKey: ['admin-content-store-items', listQuery],
    queryFn: () => adminApi.listContentStoreItems(listQuery),
  })

  const detailQuery = useQuery({
    queryKey: ['admin-content-store-detail', detailId],
    queryFn: () => adminApi.getContentStoreDetail(detailId ?? ''),
    enabled: Boolean(detailId),
  })

  const featuredMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      adminApi.setContentStoreFeatured(id, value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin-content-store-items'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-content-store-detail'] })
      toast.success('已更新')
    },
    onError: (error) => toast.error(getErrorMessage(error, '更新失败')),
  })

  const removedMutation = useMutation({
    mutationFn: ({ id, value }: { id: string; value: boolean }) =>
      adminApi.setContentStoreRemoved(id, value),
    onSuccess: () => {
      setRemoveTarget(null)
      void queryClient.invalidateQueries({ queryKey: ['admin-content-store-items'] })
      void queryClient.invalidateQueries({ queryKey: ['admin-content-store-detail'] })
      toast.success('已更新')
    },
    onError: (error) => toast.error(getErrorMessage(error, '更新失败')),
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
        id: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='作者' />
        ),
        cell: ({ row }) => getContentStoreOwnerName(row.original.owner),
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
        accessorKey: 'moderationStatus',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='治理状态' />
        ),
        cell: ({ row }) => (
          <Badge
            variant={
              row.original.moderationStatus === 'normal'
                ? 'secondary'
                : 'destructive'
            }
          >
            {row.original.moderationStatus === 'normal' ? '正常' : '已下架'}
          </Badge>
        ),
      },
      {
        accessorKey: 'featured',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title='精选' />
        ),
        cell: ({ row }) => (row.original.featured ? '是' : '否'),
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
            <Button
              variant='ghost'
              className='h-8 px-2'
              onClick={(event) => {
                event.stopPropagation()
                setDetailId(row.original.id)
              }}
            >
              详情
            </Button>
            <Button
              variant='ghost'
              className='h-8 px-2'
              disabled={featuredMutation.isPending}
              onClick={(event) => {
                event.stopPropagation()
                featuredMutation.mutate({
                  id: row.original.id,
                  value: !row.original.featured,
                })
              }}
            >
              {row.original.featured ? '取消精选' : '精选'}
            </Button>
            <Button
              variant='ghost'
              className='h-8 px-2'
              disabled={removedMutation.isPending}
              onClick={(event) => {
                event.stopPropagation()
                if (row.original.moderationStatus === 'removed') {
                  removedMutation.mutate({ id: row.original.id, value: false })
                  return
                }
                setRemoveTarget(row.original)
              }}
            >
              {row.original.moderationStatus === 'removed' ? '恢复' : '下架'}
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
    [featuredMutation, removedMutation]
  )

  return (
    <>
      <Header fixed>
        <h1 className='text-lg font-semibold'>Legacy Content Store</h1>
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
              onClick: () => setDetailId(row.original.id),
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
                <Select
                  value={visibility || allVisibilityValue}
                  onValueChange={(value) => {
                    setVisibility(
                      value === allVisibilityValue
                        ? ''
                        : (value as ContentStoreVisibility)
                    )
                    setPage(1)
                  }}
                >
                  <SelectTrigger size='sm' className='w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allVisibilityValue}>全部可见性</SelectItem>
                      <SelectItem value='public'>公开</SelectItem>
                      <SelectItem value='private'>私有</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Select
                  value={moderationStatus || allModerationValue}
                  onValueChange={(value) => {
                    setModerationStatus(
                      value === allModerationValue
                        ? ''
                        : (value as ContentStoreModerationStatus)
                    )
                    setPage(1)
                  }}
                >
                  <SelectTrigger size='sm' className='w-32'>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value={allModerationValue}>全部状态</SelectItem>
                      <SelectItem value='normal'>正常</SelectItem>
                      <SelectItem value='removed'>已下架</SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            }
          />
        )}
        <Sheet
          open={Boolean(detailId)}
          onOpenChange={(open) => {
            if (!open) setDetailId(null)
          }}
        >
          <SheetContent className='w-full overflow-auto sm:max-w-3xl'>
            <SheetHeader>
              <SheetTitle>内容详情</SheetTitle>
            </SheetHeader>
            <div className='mt-4'>
              {detailQuery.isLoading ? (
                <div className='text-muted-foreground'>加载中...</div>
              ) : detailQuery.data ? (
                <ContentStoreDetailView detail={detailQuery.data} mode='admin' />
              ) : (
                <div className='text-muted-foreground'>内容不可用</div>
              )}
            </div>
          </SheetContent>
        </Sheet>
        <ConfirmDialog
          open={Boolean(removeTarget)}
          onOpenChange={(open) => {
            if (!open) setRemoveTarget(null)
          }}
          title='下架内容'
          desc={removeTarget ? `${removeTarget.title} 将从公开内容商店移除。` : ''}
          cancelBtnText='取消'
          confirmText='下架'
          destructive
          isLoading={removedMutation.isPending}
          handleConfirm={() => {
            if (removeTarget) {
              removedMutation.mutate({ id: removeTarget.id, value: true })
            }
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
