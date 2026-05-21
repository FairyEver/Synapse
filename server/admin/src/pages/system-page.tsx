import { PageState } from "@/components/page-state"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi } from "@/lib/api"
import { formatCount, formatDate } from "@/lib/format"

export function SystemPage() {
  const { data, error, loading } = useApiResource(adminApi.getSystemOverview)

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data) return <PageState>暂无数据</PageState>

  return (
    <div className="grid gap-2">
      <Table>
        <TableBody>
          <TableRow>
            <TableCell>审计日志</TableCell>
            <TableCell className="text-right">{formatCount(data.counts.auditLogs)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>
      <div className="text-sm text-muted-foreground">服务器时间：{formatDate(data.serverTime)}</div>
    </div>
  )
}
