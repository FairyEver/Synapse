import { type HTMLAttributes, type ReactNode, useEffect } from 'react'
import {
  type ColumnDef,
  type Row,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { cn } from '@/lib/utils'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTablePagination } from './pagination'
import { DataTableViewOptions } from './view-options'

type ServerDataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  toolbar?: ReactNode
  error?: unknown
  onRetry?: () => void
  className?: string
  getRowProps?: (row: Row<TData>) => HTMLAttributes<HTMLTableRowElement>
  showPagination?: boolean
  isLoading?: boolean
  loadingRowCount?: number
  emptyMessage?: ReactNode
  showPageSize?: boolean
  clampPage?: boolean
}

export function getServerDataTableErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  if (typeof error === 'string' && error.trim()) {
    return error
  }
  return '列表加载失败'
}

export function getServerTableSortQuery(sorting: SortingState) {
  const sort = sorting[0]
  if (!sort) return {}
  return {
    sortBy: sort.id,
    sortOrder: sort.desc ? 'desc' : 'asc',
  } as const
}

export function getServerDataTablePageCount(total: number, pageSize: number) {
  const safePageSize = Number.isFinite(pageSize) && pageSize > 0
    ? Math.floor(pageSize)
    : 1
  return Math.max(1, Math.ceil(total / safePageSize))
}

export function getServerDataTableBoundedPage(
  page: number,
  total: number,
  pageSize: number
) {
  const pageCount = getServerDataTablePageCount(total, pageSize)
  const safePage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1
  return Math.min(safePage, pageCount)
}

export function getServerDataTablePinnedColumnClass(
  columnId: string,
  options: { interactiveRow?: boolean } = {}
) {
  if (columnId !== 'actions') return ''

  return cn(
    'sticky right-0 z-10 bg-background',
    options.interactiveRow && 'group-hover/row:bg-muted/50'
  )
}

export function ServerDataTable<TData, TValue>({
  columns,
  data,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  sorting = [],
  onSortingChange,
  toolbar,
  error,
  onRetry,
  className,
  getRowProps,
  showPagination = true,
  isLoading = false,
  loadingRowCount = 8,
  emptyMessage = '暂无数据',
  showPageSize = true,
  clampPage = true,
}: ServerDataTableProps<TData, TValue>) {
  const pageCount = getServerDataTablePageCount(total, pageSize)
  const boundedPage = getServerDataTableBoundedPage(page, total, pageSize)
  const pagination = {
    pageIndex: (clampPage ? boundedPage : page) - 1,
    pageSize,
  }

  useEffect(() => {
    if (clampPage && page !== boundedPage) {
      onPageChange(boundedPage)
    }
  }, [boundedPage, clampPage, onPageChange, page])

  const table = useReactTable({
    data,
    columns,
    pageCount,
    state: {
      pagination,
      sorting,
    },
    manualPagination: true,
    manualSorting: Boolean(onSortingChange),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function' ? updater(pagination) : updater

      if (next.pageSize !== pageSize) {
        onPageSizeChange(next.pageSize)
        onPageChange(1)
        return
      }

      onPageChange(next.pageIndex + 1)
    },
    onSortingChange: (updater) => {
      if (!onSortingChange) return
      const next = typeof updater === 'function' ? updater(sorting) : updater
      onSortingChange(next)
      onPageChange(1)
    },
  })
  const errorMessage = error ? getServerDataTableErrorMessage(error) : null
  const canToggleColumns = table
    .getAllLeafColumns()
    .some((column) => column.getCanHide())

  return (
    <div className={cn('flex flex-1 flex-col gap-4', className)}>
      {toolbar || canToggleColumns ? (
        <div className='flex items-center justify-between gap-2'>
          <div className='min-w-0 flex-1'>{toolbar}</div>
          {canToggleColumns ? <DataTableViewOptions table={table} /> : null}
        </div>
      ) : null}
      <div className='overflow-hidden rounded-md border'>
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={cn(
                      header.column.columnDef.meta?.className,
                      header.column.columnDef.meta?.thClassName,
                      getServerDataTablePinnedColumnClass(header.column.id)
                    )}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: loadingRowCount }).map((_, rowIndex) => (
                <TableRow key={rowIndex} className='group/row'>
                  {columns.map((column, columnIndex) => (
                    <TableCell
                      key={column.id ?? columnIndex}
                      className={cn(
                        column.meta?.className,
                        column.meta?.tdClassName,
                        getServerDataTablePinnedColumnClass(column.id ?? '', {
                          interactiveRow: true,
                        })
                      )}
                    >
                      <Skeleton className='h-4 w-full' />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : errorMessage ? (
              <TableRow>
                <TableCell colSpan={columns.length} className='h-24 text-center'>
                  <div className='flex flex-col items-center gap-2'>
                    <span className='font-medium'>加载失败</span>
                    <span className='text-muted-foreground'>{errorMessage}</span>
                    {onRetry ? (
                      <Button variant='outline' size='sm' onClick={onRetry}>
                        重试
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const rowProps = getRowProps?.(row)

                return (
                  <TableRow
                    key={row.id}
                    {...rowProps}
                    className={cn('group/row', rowProps?.className)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.columnDef.meta?.className,
                          cell.column.columnDef.meta?.tdClassName,
                          getServerDataTablePinnedColumnClass(cell.column.id, {
                            interactiveRow: true,
                          })
                        )}
                      >
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                )
              })
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className='h-24 text-center'>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {isLoading || errorMessage || !showPagination ? null : (
        <DataTablePagination
          table={table}
          className='mt-auto'
          showPageSize={showPageSize}
        />
      )}
    </div>
  )
}
