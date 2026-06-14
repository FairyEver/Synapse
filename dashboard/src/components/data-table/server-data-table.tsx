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
import { DataTablePagination } from './pagination'

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
}: ServerDataTableProps<TData, TValue>) {
  const pageCount = getServerDataTablePageCount(total, pageSize)
  const boundedPage = getServerDataTableBoundedPage(page, total, pageSize)
  const pagination = {
    pageIndex: boundedPage - 1,
    pageSize,
  }

  useEffect(() => {
    if (page !== boundedPage) {
      onPageChange(boundedPage)
    }
  }, [boundedPage, onPageChange, page])

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

  return (
    <div className={cn('flex flex-1 flex-col gap-4', className)}>
      {toolbar}
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
                      header.column.columnDef.meta?.thClassName
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
            {errorMessage ? (
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
                    className={cn(rowProps?.className)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell
                        key={cell.id}
                        className={cn(
                          cell.column.columnDef.meta?.className,
                          cell.column.columnDef.meta?.tdClassName
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
                  暂无数据
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      {errorMessage || !showPagination ? null : (
        <DataTablePagination table={table} className='mt-auto' />
      )}
    </div>
  )
}
