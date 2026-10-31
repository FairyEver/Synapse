import { Tooltip } from '@heroui/react';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { zhCN } from 'date-fns/locale';
import { cn } from '@/lib/utils';
type RelativeTimeProps = {
    readonly value?: string | number | Date | null;
    readonly fallback?: string;
    readonly className?: string;
    readonly mode?: 'relative' | 'absolute';
};
function parseTimeValue(value: RelativeTimeProps['value']): Date | null {
    if (value === null || value === undefined || value === '')
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function formatExactDateTime(date: Date): string {
    return format(date, 'yyyy-MM-dd HH:mm:ss');
}
function formatRelativeDateTime(date: Date): string {
    const diffMs = date.getTime() - Date.now();
    if (Math.abs(diffMs) < 60000)
        return diffMs >= 0 ? '即将' : '刚刚';
    return formatDistanceToNowStrict(date, {
        addSuffix: true,
        locale: zhCN,
    });
}
function RelativeTime({ value, fallback = '-', className, mode = 'relative', }: RelativeTimeProps) {
    const date = parseTimeValue(value);
    if (!date)
        return <span className={className}>{fallback}</span>;
    const exact = formatExactDateTime(date);
    const label = mode === 'absolute' ? exact : formatRelativeDateTime(date);
    return (<>
      <Tooltip>
        <>
          <time dateTime={date.toISOString()} aria-label={exact} className={cn('whitespace-nowrap', className)}>
            {label}
          </time>
        </>
        <Tooltip.Content>{exact}</Tooltip.Content>
      </Tooltip>
    </>);
}
export { RelativeTime, formatExactDateTime, formatRelativeDateTime };
export type { RelativeTimeProps };
