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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { adminApi, type LogEntry, type LogFileInfo } from '@/lib/api';
import { formatBytes, formatDate } from '@/lib/format';
import { filterControlClass } from '@/lib/layout';

const levels = ['all', 'error', 'fatal', 'warn', 'info', 'debug'];

function logEntryKey(
  entry: LogEntry,
  occurrences: Map<string, number>,
) {
  const baseKey = `${entry.time}-${entry.level}-${entry.msg}`;
  const count = occurrences.get(baseKey) ?? 0;
  occurrences.set(baseKey, count + 1);
  return count === 0 ? baseKey : `${baseKey}-${count}`;
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [level, setLevel] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cleanupBefore, setCleanupBefore] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const latestRequestId = useRef(0);
  const cleaningUpRef = useRef(false);
  const downloadingRef = useRef(false);

  const refresh = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setError('');
    try {
      const [nextEntries, nextFiles] = await Promise.all([
        adminApi.fetchRecentLogs({
          from,
          level: level === 'all' ? undefined : level,
          limit: 200,
          to,
        }),
        adminApi.listLogFiles(),
      ]);
      if (requestId !== latestRequestId.current) return;
      setEntries(nextEntries);
      setFiles(nextFiles);
    } catch (nextError) {
      if (requestId !== latestRequestId.current) return;
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      if (requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [from, level, to]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function cleanupLogs() {
    if (!cleanupBefore) return;
    if (cleaningUpRef.current) return;
    cleaningUpRef.current = true;
    setFeedback(null);
    setIsCleaningUp(true);
    try {
      const result = await adminApi.cleanupLogs(cleanupBefore);
      setFeedback({ message: `已清理 ${result.deleted} 条`, tone: 'neutral' });
      await refresh();
    } catch (nextError) {
      setFeedback({
        message: nextError instanceof Error ? nextError.message : '清理失败',
        tone: 'error',
      });
    } finally {
      cleaningUpRef.current = false;
      setIsCleaningUp(false);
    }
  }

  async function downloadLogs(options: { from?: string; to?: string } = {}) {
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    setFeedback(null);
    setIsDownloading(true);
    try {
      await adminApi.downloadLogs(options);
    } catch (nextError) {
      setFeedback({
        message: nextError instanceof Error ? nextError.message : '下载失败',
        tone: 'error',
      });
    } finally {
      downloadingRef.current = false;
      setIsDownloading(false);
    }
  }

  const logEntryOccurrences = new Map<string, number>();

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={level} onValueChange={setLevel}>
          <SelectTrigger className={filterControlClass}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {levels.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === 'all' ? '全部' : item}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={refresh}>
          刷新
        </Button>
        <FeedbackMessage feedback={feedback} />
      </div>
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>时间</TableHead>
                <TableHead>级别</TableHead>
                <TableHead>消息</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={logEntryKey(entry, logEntryOccurrences)}>
                  <TableCell>{formatDate(entry.time)}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{entry.level}</Badge>
                  </TableCell>
                  <TableCell>{`${entry.req ? `${entry.req.method} ${entry.req.url} - ` : ''}${entry.msg}`}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {entries.length === 0 ? <EmptyState /> : null}

          <div className="flex flex-wrap items-center gap-2">
            <Input
              className={filterControlClass}
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
            <Input
              className={filterControlClass}
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={isDownloading}
              onClick={() => downloadLogs({ from, to })}
            >
              下载范围
            </Button>
            <Button disabled={isDownloading} onClick={() => downloadLogs()}>
              下载全部
            </Button>
            <Input
              className={filterControlClass}
              type="date"
              value={cleanupBefore}
              onChange={(event) => setCleanupBefore(event.target.value)}
            />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="outline"
                  disabled={!cleanupBefore || isCleaningUp}
                >
                  清理
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>清理日志</AlertDialogTitle>
                  <AlertDialogDescription>
                    {cleanupBefore}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction
                    variant="destructive"
                    onClick={cleanupLogs}
                  >
                    清理
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>文件名</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>修改时间</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {files.map((file) => (
                <TableRow key={file.name}>
                  <TableCell>{file.name}</TableCell>
                  <TableCell>{formatBytes(file.size)}</TableCell>
                  <TableCell>{formatDate(file.modifiedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {files.length === 0 ? <EmptyState /> : null}
        </>
      ) : null}
    </main>
  );
}
