import { useEffect, useState } from "react";
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cleanupBefore, setCleanupBefore] = useState("");
  const [cleaning, setCleaning] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [logEntries, logFiles] = await Promise.all([
        adminApi.fetchRecentLogs({
          level: level === "all" ? undefined : level,
          limit: 200,
        }),
        adminApi.listLogFiles(),
      ]);
      setEntries(logEntries);
      setFiles(logFiles);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [level]);

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

  if (error) return <PageState>{error}</PageState>;

  return (
    <div className="space-y-8">
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
              onClick={() => adminApi.downloadLogs({ from: from || undefined, to: to || undefined })}
              disabled={!from && !to}
            >
              按范围下载
            </Button>
            <Button size="sm" onClick={() => adminApi.downloadLogs()}>
              下载全部
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
      </section>
    </div>
  );
}
