import { useCallback, useEffect, useRef, useState } from "react";
import { adminApi, type LogEntry, type LogFileInfo } from "../lib/api";
import { PageState } from "../components/page-state";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";

const LEVEL_VARIANTS: Record<string, "destructive" | "outline" | "default" | "secondary"> = {
  error: "destructive",
  warn: "outline",
  info: "default",
  debug: "secondary",
  fatal: "destructive",
};

export const LOG_LEVEL_FILTER_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "error", label: "Error" },
  { value: "fatal", label: "Fatal" },
  { value: "warn", label: "Warn" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFileInfo[]>([]);
  const [level, setLevel] = useState<string>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entriesError, setEntriesError] = useState<string | null>(null);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cleanupBefore, setCleanupBefore] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [downloading, setDownloading] = useState<"range" | "all" | null>(null);
  const fetchRequestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    const requestId = fetchRequestIdRef.current + 1;
    fetchRequestIdRef.current = requestId;
    setLoading(true);
    setError(null);
    setEntriesError(null);
    setFilesError(null);

    const [logEntries, logFiles] = await Promise.allSettled([
      adminApi.fetchRecentLogs({
        level: level === "all" ? undefined : level,
        limit: 200,
      }),
      adminApi.listLogFiles(),
    ]);

    if (requestId !== fetchRequestIdRef.current) return;

    if (logEntries.status === "fulfilled") {
      setEntries(logEntries.value);
    } else {
      setEntriesError(logEntries.reason instanceof Error ? logEntries.reason.message : "加载失败");
    }
    if (logFiles.status === "fulfilled") {
      setFiles(logFiles.value);
    } else {
      setFilesError(logFiles.reason instanceof Error ? logFiles.reason.message : "加载失败");
    }
    setLoading(false);
  }, [level]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleCleanup = async () => {
    if (!cleanupBefore || !window.confirm(`确定清理 ${cleanupBefore} 之前的日志？`)) return;
    setCleaning(true);
    setError(null);
    try {
      await adminApi.cleanupLogs(cleanupBefore);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "清理失败");
    } finally {
      setCleaning(false);
    }
  };

  const handleDownload = async (mode: "range" | "all") => {
    setDownloading(mode);
    setError(null);
    try {
      await adminApi.downloadLogs(
        mode === "range" ? { from: from || undefined, to: to || undefined } : undefined,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "下载失败");
    } finally {
      setDownloading(null);
    }
  };

  return (
    <div className="space-y-8">
      {error ? <PageState>{error}</PageState> : null}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">最近日志</h2>
          <div className="flex items-center gap-2">
            <Select value={level} onValueChange={setLevel}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVEL_FILTER_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={fetchData}>
              刷新
            </Button>
          </div>
        </div>

        {loading ? (
          <PageState>加载中</PageState>
        ) : entriesError ? (
          <PageState>{`最近日志加载失败：${entriesError}`}</PageState>
        ) : (
          <div className="border rounded-md max-h-[400px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-44">时间</TableHead>
                  <TableHead className="w-20">级别</TableHead>
                  <TableHead>消息</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono text-xs">
                      {new Date(entry.time).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant={LEVEL_VARIANTS[entry.level] ?? "default"}>
                        {entry.level}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs truncate max-w-md">
                      {entry.req ? `${entry.req.method} ${entry.req.url} — ` : ""}
                      {entry.msg}
                    </TableCell>
                  </TableRow>
                ))}
                {entries.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      暂无日志
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">日志文件</h2>
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-36"
              placeholder="起始日期"
            />
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-36"
              placeholder="结束日期"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDownload("range")}
              disabled={Boolean(downloading) || (!from && !to)}
            >
              {downloading === "range" ? "下载中…" : "按范围下载"}
            </Button>
            <Button size="sm" onClick={() => void handleDownload("all")} disabled={Boolean(downloading)}>
              {downloading === "all" ? "下载中…" : "下载全部"}
            </Button>
            <Input
              type="date"
              value={cleanupBefore}
              onChange={(e) => setCleanupBefore(e.target.value)}
              className="w-36"
              aria-label="清理日期"
            />
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleCleanup()}
              disabled={!cleanupBefore || cleaning}
            >
              {cleaning ? "清理中…" : "清理早于日期"}
            </Button>
          </div>
        </div>

        {filesError ? (
          <PageState>{`日志文件加载失败：${filesError}`}</PageState>
        ) : (
          <div className="border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>文件名</TableHead>
                  <TableHead className="w-24">大小</TableHead>
                  <TableHead className="w-44">修改时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.map((file) => (
                  <TableRow key={file.name}>
                    <TableCell className="font-mono text-sm">{file.name}</TableCell>
                    <TableCell>{formatBytes(file.size)}</TableCell>
                    <TableCell className="text-xs">
                      {new Date(file.modifiedAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))}
                {files.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center text-muted-foreground">
                      暂无日志文件
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
