import { useEffect, type ComponentProps, type ReactNode } from 'react';
import { Button, Dropdown, Label, ListBox, Pagination, Select, Skeleton, Table } from '@heroui/react';
import { Columns3 } from 'lucide-react';
import { type ColumnDef, type Row, type SortingState, flexRender, getCoreRowModel, getSortedRowModel, useReactTable } from '@tanstack/react-table';
import { cn, getPageNumbers } from '@/lib/utils';
type RowActionProps = Pick<ComponentProps<typeof Table.Row>, 'onAction' | 'className'>;
type ServerDataTableProps<TData, TValue> = {
    columns: ColumnDef<TData, TValue>[];
    data: TData[];
    page: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    onPageSizeChange: (size: number) => void;
    sorting?: SortingState;
    onSortingChange?: (sorting: SortingState) => void;
    toolbar?: ReactNode;
    error?: unknown;
    onRetry?: () => void;
    className?: string;
    getRowProps?: (row: Row<TData>) => RowActionProps;
    showPagination?: boolean;
    isLoading?: boolean;
    loadingRowCount?: number;
    emptyMessage?: ReactNode;
    showPageSize?: boolean;
    clampPage?: boolean;
};
export function getServerDataTableErrorMessage(error: unknown) {
    return error instanceof Error && error.message.trim() ? error.message : typeof error === 'string' && error.trim() ? error : '列表加载失败';
}
export function getServerTableSortQuery(sorting: SortingState) {
    const sort = sorting[0];
    return sort ? { sortBy: sort.id, sortOrder: sort.desc ? 'desc' as const : 'asc' as const } : {};
}
export function getServerDataTablePageCount(total: number, pageSize: number) {
    return Math.max(1, Math.ceil(total / (Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 1)));
}
export function getServerDataTableBoundedPage(page: number, total: number, pageSize: number) {
    return Math.min(Number.isFinite(page) && page > 0 ? Math.floor(page) : 1, getServerDataTablePageCount(total, pageSize));
}
export function getServerDataTablePinnedColumnClass(columnId: string) {
    return columnId === 'actions' ? 'sticky right-0 z-10 bg-surface' : '';
}
/** Server pagination remains in the domain; HeroUI owns table interaction and presentation. */
export function ServerDataTable<TData, TValue>({ columns, data, page, pageSize, total, onPageChange, onPageSizeChange, sorting = [], onSortingChange, toolbar, error, onRetry, className, getRowProps, showPagination = true, isLoading = false, loadingRowCount = 8, emptyMessage = '暂无数据', showPageSize = true, clampPage = true }: ServerDataTableProps<TData, TValue>) {
    const pageCount = getServerDataTablePageCount(total, pageSize);
    const boundedPage = getServerDataTableBoundedPage(page, total, pageSize);
    useEffect(() => {
        if (clampPage && !isLoading && !error && page !== boundedPage)
            onPageChange(boundedPage);
    }, [boundedPage, clampPage, error, isLoading, onPageChange, page]);
    const table = useReactTable({ data, columns, pageCount, state: { sorting }, manualPagination: true, manualSorting: Boolean(onSortingChange), getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), onSortingChange: (updater) => {
            if (onSortingChange) {
                onSortingChange(typeof updater === 'function' ? updater(sorting) : updater);
                onPageChange(1);
            }
        } });
    const visibleColumns = table.getVisibleLeafColumns();
    const hideableColumns = table.getAllLeafColumns().filter((column) => column.getCanHide());
    const errorMessage = error ? getServerDataTableErrorMessage(error) : null;
    const paginationPage = clampPage ? boundedPage : page;
    return <div className={cn('flex min-w-0 flex-1 flex-col gap-4', className)}>
    {(toolbar || hideableColumns.length > 0) && <div className='flex flex-col gap-3 sm:flex-row sm:items-start'><div className='min-w-0 flex-1'>{toolbar}</div>{hideableColumns.length > 0 && <Dropdown><Button variant="secondary" className="self-end shrink-0"><Columns3 className='size-4'/>列</Button><Dropdown.Popover><Dropdown.Menu aria-label='显示列' selectionMode='multiple' disallowEmptySelection selectedKeys={new Set(hideableColumns.filter((column) => column.getIsVisible()).map((column) => column.id))} onSelectionChange={(keys) => { hideableColumns.forEach((column) => column.toggleVisibility(keys === 'all' || keys.has(column.id))); }}>{hideableColumns.map((column) => <Dropdown.Item key={column.id} id={column.id} textValue={column.columnDef.meta?.label ?? column.id}><Label>{column.columnDef.meta?.label ?? (typeof column.columnDef.header === 'string' ? column.columnDef.header : column.id)}</Label><Dropdown.ItemIndicator /></Dropdown.Item>)}</Dropdown.Menu></Dropdown.Popover></Dropdown>}</div>}
    <Table><Table.ScrollContainer><Table.Content aria-label='数据列表' className='w-full min-w-max'>
      <Table.Header>{table.getHeaderGroups()[0]?.headers.filter((header) => header.column.getIsVisible()).map((header, index) => <Table.Column id={header.id} key={header.id} isRowHeader={index === 0} textValue={header.id} className={cn('whitespace-nowrap', header.column.columnDef.meta?.className, header.column.columnDef.meta?.thClassName)}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</Table.Column>)}</Table.Header>
      <Table.Body renderEmptyState={() => null}>
        {isLoading ? Array.from({ length: loadingRowCount }, (_, index) => <Table.Row key={`loading-${index}`} id={`loading-${index}`}>{visibleColumns.map((column) => <Table.Cell key={column.id}><Skeleton className='h-5 w-full'/></Table.Cell>)}</Table.Row>) : errorMessage ? [] : table.getRowModel().rows.map((row) => <Table.Row key={row.id} id={row.id} {...getRowProps?.(row)}>{row.getVisibleCells().map((cell) => <Table.Cell key={cell.id} className={cn('whitespace-nowrap', cell.column.columnDef.meta?.className, cell.column.columnDef.meta?.tdClassName, getServerDataTablePinnedColumnClass(cell.column.id))}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</Table.Cell>)}</Table.Row>)}
      </Table.Body>
    </Table.Content></Table.ScrollContainer>
    {!isLoading && (errorMessage || data.length === 0) && <div role={errorMessage ? undefined : 'status'} className='flex min-h-36 flex-col items-center justify-center gap-3 p-6 text-center text-muted'>
      {errorMessage ? <><span role='alert'>{errorMessage}</span>{onRetry && <Button variant='secondary' onPress={onRetry}>重试</Button>}</> : emptyMessage}
    </div>}
    {!isLoading && !errorMessage && showPagination && <Table.Footer>
      <div className='flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between'>
        {showPageSize && <Select className='w-fit shrink-0' aria-label='每页行数' value={String(pageSize)} onChange={(value) => { onPageSizeChange(Number(value)); onPageChange(1); }}><Select.Trigger><Select.Value /><Select.Indicator /></Select.Trigger><Select.Popover><ListBox>{[10, 20, 30, 40, 50].map((size) => <ListBox.Item key={size} id={String(size)} textValue={`${size} 条 / 页`}>{size} 条 / 页<ListBox.ItemIndicator /></ListBox.Item>)}</ListBox></Select.Popover></Select>}
        <Pagination className='min-w-0 sm:flex-1'><Pagination.Summary>第 {paginationPage} / {pageCount} 页 · {total} 条</Pagination.Summary><Pagination.Content className='flex-wrap'><Pagination.Item><Pagination.Previous isDisabled={paginationPage <= 1} onPress={() => onPageChange(paginationPage - 1)} aria-label='上一页'><Pagination.PreviousIcon /></Pagination.Previous></Pagination.Item>{getPageNumbers(paginationPage, pageCount).map((n, index) => <Pagination.Item key={`${n}-${index}`}>{n === '...' ? <Pagination.Ellipsis /> : <Pagination.Link isActive={paginationPage === n} onPress={() => onPageChange(Number(n))} aria-label={`第 ${n} 页`}>{n}</Pagination.Link>}</Pagination.Item>)}<Pagination.Item><Pagination.Next isDisabled={paginationPage >= pageCount} onPress={() => onPageChange(paginationPage + 1)} aria-label='下一页'><Pagination.NextIcon /></Pagination.Next></Pagination.Item></Pagination.Content></Pagination>
      </div>
    </Table.Footer>}
    </Table>
  </div>;
}
