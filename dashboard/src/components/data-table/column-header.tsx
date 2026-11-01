import type { Column } from '@tanstack/react-table';
import type { HTMLAttributes } from 'react';
import { Button, Dropdown, Label } from '@heroui/react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
export function DataTableColumnHeader<TData, TValue>({ column, title, className }: HTMLAttributes<HTMLDivElement> & {
    column: Column<TData, TValue>;
    title: string;
}) {
    if (!column.getCanSort())
        return <span className={className}>{title}</span>;
    const Icon = column.getIsSorted() === 'asc' ? ArrowUp : column.getIsSorted() === 'desc' ? ArrowDown : ArrowUpDown;
    return <Dropdown><Button variant="ghost" size='sm' className={className} aria-label={`${title}排序`}>{title}<Icon className='size-3'/></Button><Dropdown.Popover><Dropdown.Menu aria-label={`${title}排序`}><Dropdown.Item id='asc' textValue='升序' onAction={() => column.toggleSorting(false)}><Label>升序</Label></Dropdown.Item><Dropdown.Item id='desc' textValue='降序' onAction={() => column.toggleSorting(true)}><Label>降序</Label></Dropdown.Item><Dropdown.Item id='clear' textValue='清除排序' onAction={() => column.clearSorting()}><Label>清除排序</Label></Dropdown.Item></Dropdown.Menu></Dropdown.Popover></Dropdown>;
}
