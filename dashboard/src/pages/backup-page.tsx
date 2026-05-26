import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  EmptyState,
  ErrorState,
  FeedbackMessage,
  type FeedbackState,
  LoadingState,
} from '@/components/page-state';
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
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [downloadingFilenames, setDownloadingFilenames] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [deletingFilenames, setDeletingFilenames] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const latestRequestId = useRef(0);
  const backingUpRef = useRef(false);
  const downloadingFilenamesRef = useRef(new Set<string>());
  const deletingFilenamesRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setError('');
    try {
      const nextRows = await adminApi.listBackups();
      if (requestId !== latestRequestId.current) return;
      setRows(nextRows);
    } catch (nextError) {
      if (requestId !== latestRequestId.current) return;
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function triggerBackup() {
    if (backingUpRef.current) return;
    backingUpRef.current = true;
    setFeedback(null);
    setIsBackingUp(true);
    try {
      const result = await adminApi.triggerBackup();
      setFeedback({ message: `已备份 ${result.filename}`, tone: 'neutral' });
      await refresh();
    } catch (nextError) {
      setFeedback({
        message: nextError instanceof Error ? nextError.message : '备份失败',
        tone: 'error',
      });
    } finally {
      backingUpRef.current = false;
      setIsBackingUp(false);
    }
  }

  async function deleteBackup(filename: string) {
    if (deletingFilenamesRef.current.has(filename)) return;
    deletingFilenamesRef.current.add(filename);
    setFeedback(null);
    setDeletingFilenames((current) => new Set(current).add(filename));
    try {
      await adminApi.deleteBackup(filename);
      await refresh();
    } catch (nextError) {
      setFeedback({
        message: nextError instanceof Error ? nextError.message : '删除失败',
        tone: 'error',
      });
    } finally {
      deletingFilenamesRef.current.delete(filename);
      setDeletingFilenames((current) => {
        const next = new Set(current);
        next.delete(filename);
        return next;
      });
    }
  }

  async function downloadBackup(filename: string) {
    if (downloadingFilenamesRef.current.has(filename)) return;
    downloadingFilenamesRef.current.add(filename);
    setFeedback(null);
    setDownloadingFilenames((current) => new Set(current).add(filename));
    try {
      await adminApi.downloadBackup(filename);
    } catch (nextError) {
      setFeedback({
        message: nextError instanceof Error ? nextError.message : '下载失败',
        tone: 'error',
      });
    } finally {
      downloadingFilenamesRef.current.delete(filename);
      setDownloadingFilenames((current) => {
        const next = new Set(current);
        next.delete(filename);
        return next;
      });
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="flex items-center justify-between gap-4">
        <FeedbackMessage feedback={feedback} />
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
                        disabled={downloadingFilenames.has(file.filename)}
                        onClick={() => downloadBackup(file.filename)}
                      >
                        下载
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="outline"
                            disabled={deletingFilenames.has(file.filename)}
                          >
                            删除
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除备份</AlertDialogTitle>
                            <AlertDialogDescription>
                              {file.filename}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction
                              variant="destructive"
                              onClick={() => deleteBackup(file.filename)}
                            >
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
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
