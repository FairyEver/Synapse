import { useCallback, useEffect, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminApi, type BackupFile } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';

export function BackupPage() {
  const [rows, setRows] = useState<BackupFile[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [deletingFilenames, setDeletingFilenames] = useState<
    ReadonlySet<string>
  >(() => new Set());

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setRows(await adminApi.listBackups());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function triggerBackup() {
    if (isBackingUp) return;
    setFeedback('');
    setIsBackingUp(true);
    try {
      const result = await adminApi.triggerBackup();
      setFeedback(`已备份 ${result.filename}`);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '备份失败');
    } finally {
      setIsBackingUp(false);
    }
  }

  async function deleteBackup(filename: string) {
    if (deletingFilenames.has(filename)) return;
    setFeedback('');
    setDeletingFilenames((current) => new Set(current).add(filename));
    try {
      await adminApi.deleteBackup(filename);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '删除失败');
    } finally {
      setDeletingFilenames((current) => {
        const next = new Set(current);
        next.delete(filename);
        return next;
      });
    }
  }

  async function downloadBackup(filename: string) {
    setFeedback('');
    try {
      await adminApi.downloadBackup(filename);
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '下载失败');
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{feedback}</p>
        <Button disabled={isBackingUp} onClick={triggerBackup}>
          {isBackingUp ? '备份中' : '立即备份'}
        </Button>
      </div>
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>备份时间</TableHead>
                <TableHead className="sticky right-0 bg-background text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((file) => (
                <TableRow key={file.filename}>
                  <TableCell>{file.filename}</TableCell>
                  <TableCell>{formatBytes(file.size)}</TableCell>
                  <TableCell>{formatDate(file.createdAt)}</TableCell>
                  <TableCell className="sticky right-0 bg-background text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => downloadBackup(file.filename)}
                      >
                        下载
                      </Button>
                      <Button
                        variant="outline"
                        disabled={deletingFilenames.has(file.filename)}
                        onClick={() => deleteBackup(file.filename)}
                      >
                        删除
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? <EmptyState /> : null}
        </>
      ) : null}
    </main>
  );
}
