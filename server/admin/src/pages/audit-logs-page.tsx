import * as React from "react"
import { adminApi, type AuditLog, type PaginatedResponse } from "@/lib/api"
import { useApiResource } from "@/hooks/use-api-resource"
import { formatDate } from "@/lib/format"
import { PageState } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

export function AuditLogsPage() {
  const [action, setAction] = React.useState<string>("all")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [page, setPage] = React.useState(1)

  const actionFilter = action === "all" ? undefined : action
  const { data: result, loading, error } = useApiResource<PaginatedResponse<AuditLog>>(
    () => adminApi.listAuditLogs({ action: actionFilter, from: from || undefined, to: to || undefined, page }),
    [action, from, to, page],
  )

  if (loading) return <PageState>加载中…</PageState>
  if (error) return <PageState>{`加载失败：${error}`}</PageState>
  if (!result) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={action} onValueChange={setAction}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部操作</SelectItem>
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
        <Button variant="outline" onClick={() => adminApi.exportAuditLogs({ action: actionFilter, from: from || undefined, to: to || undefined })}>
          导出 CSV
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>操作者</TableHead>
            <TableHead>操作</TableHead>
            <TableHead>目标类型</TableHead>
            <TableHead>目标 ID</TableHead>
            <TableHead>IP</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((log) => (
            <TableRow key={log.id}>
              <TableCell>{formatDate(log.createdAt)}</TableCell>
              <TableCell>{log.adminEmail}</TableCell>
              <TableCell>{log.action}</TableCell>
              <TableCell>{log.targetType}</TableCell>
              <TableCell className="font-mono text-xs">{log.targetId}</TableCell>
              <TableCell>{log.ipAddress}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>共 {result.total} 条</span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            上一页
          </Button>
          <Button variant="outline" size="sm" disabled={page * 20 >= result.total} onClick={() => setPage(page + 1)}>
            下一页
          </Button>
        </div>
      </div>
    </div>
  )
}
