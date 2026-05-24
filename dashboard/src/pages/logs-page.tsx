import { useCallback, useEffect, useRef, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
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

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [level, setLevel] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cleanupBefore, setCleanupBefore] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const latestRequestId = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setError('');
    try {
      const [nextEntries, nextFiles] = await Promise.all([
        adminApi.fetchRecentLogs({
          level: level === 'all' ? undefined : level,
          limit: 200,
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
  }, [level]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function cleanupLogs() {
    if (!cleanupBefore) return;
    setFeedback('');
    try {
      const result = await adminApi.cleanupLogs(cleanupBefore);
      setFeedback(`已清理 ${result.deleted} 条`);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '清理失败');
    }
  }

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
                <TableHead>级别</TableHead>
                <TableHead>消息</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={`${entry.time}-${entry.level}-${entry.msg}`}>
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
              onClick={() => adminApi.downloadLogs({ from, to })}
            >
              下载范围
            </Button>
            <Button onClick={() => adminApi.downloadLogs()}>下载全部</Button>
            <Input
              className={filterControlClass}
              type="date"
              value={cleanupBefore}
              onChange={(event) => setCleanupBefore(event.target.value)}
            />
            <Button
              variant="outline"
              disabled={!cleanupBefore}
              onClick={cleanupLogs}
            >
              清理
            </Button>
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
