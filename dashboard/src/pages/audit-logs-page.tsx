import { useCallback, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminList } from '@/hooks/use-admin-list';
import { type AuditLog, adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { filterControlClass } from '@/lib/layout';

export function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [feedback, setFeedback] = useState('');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  const loader = useCallback(
    (options: { page: number; pageSize: number }) =>
      adminApi.listAuditLogs({ ...options, action, from, to }),
    [action, from, to],
  );
  const { error, isLoading, page, pageSize, refresh, rows, setPage, total } =
    useAdminList(loader);

  function updateAction(value: string) {
    setPage(1);
    setAction(value);
  }

  function updateFrom(value: string) {
    setPage(1);
    setFrom(value);
  }

  function updateTo(value: string) {
    setPage(1);
    setTo(value);
  }

  async function exportLogs() {
    setFeedback('');
    try {
      await adminApi.exportAuditLogs({ action, from, to });
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '导出失败');
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className={filterControlClass}
          value={action}
          placeholder="操作"
          onChange={(event) => updateAction(event.target.value)}
        />
        <Input
          className={filterControlClass}
          type="date"
          value={from}
          onChange={(event) => updateFrom(event.target.value)}
        />
        <Input
          className={filterControlClass}
          type="date"
          value={to}
          onChange={(event) => updateTo(event.target.value)}
        />
        <Button variant="outline" onClick={refresh}>
          查询
        </Button>
        <Button onClick={exportLogs}>导出 CSV</Button>
        <p className="text-sm text-muted-foreground">{feedback}</p>
      </div>
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>操作者</TableHead>
                <TableHead>操作</TableHead>
                <TableHead>目标类型</TableHead>
                <TableHead>目标 ID</TableHead>
                <TableHead>IP</TableHead>
                <TableHead className="sticky right-0 bg-background">
                  详情
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((log) => (
                <TableRow key={log.id}>
                  <TableCell>{formatDate(log.createdAt)}</TableCell>
                  <TableCell>{log.adminEmail}</TableCell>
                  <TableCell>{log.action}</TableCell>
                  <TableCell>{log.targetType}</TableCell>
                  <TableCell>{log.targetId}</TableCell>
                  <TableCell>{log.ipAddress}</TableCell>
                  <TableCell className="sticky right-0 bg-background">
                    <Button
                      variant="outline"
                      onClick={() => setSelectedLog(log)}
                    >
                      详情
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? <EmptyState /> : null}
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        </>
      ) : null}
      <Sheet
        open={selectedLog !== null}
        onOpenChange={(open) => !open && setSelectedLog(null)}
      >
        <SheetContent aria-describedby={undefined}>
          <SheetHeader>
            <SheetTitle>{selectedLog?.action ?? '详情'}</SheetTitle>
          </SheetHeader>
          <pre className="overflow-auto p-4 text-xs whitespace-pre-wrap break-all">
            {JSON.stringify(selectedLog?.detail ?? {}, null, 2)}
          </pre>
        </SheetContent>
      </Sheet>
    </main>
  );
}
