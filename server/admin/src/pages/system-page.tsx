import { PageState } from "@/components/page-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi } from "@/lib/api"
import { formatCount, formatDate } from "@/lib/format"
import { RefreshCw } from "lucide-react"

const systemCountRows = [
  { label: "审计日志", key: "auditLogs" },
  { label: "用户", key: "users" },
  { label: "团队", key: "teams" },
  { label: "邀请", key: "invitations" },
  { label: "团队许可", key: "teamEntitlements" },
  { label: "访问角色", key: "teamAccessRoles" },
  { label: "角色权限", key: "teamAccessRolePermissions" },
  { label: "成员角色", key: "teamMemberAccessRoles" },
] as const

export function SystemPage() {
  const { data, error, loading, reload } = useApiResource(adminApi.getSystemOverview)

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data) return <PageState>暂无数据</PageState>

  return (
    <div className="grid gap-2">
      <Table>
        <TableBody>
          {systemCountRows.map((row) => (
            <TableRow key={row.key}>
              <TableCell>{row.label}</TableCell>
              <TableCell className="text-right">{formatCount(data.counts[row.key])}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">服务器时间：{formatDate(data.serverTime)}</div>
        <Button type="button" variant="outline" size="sm" onClick={reload}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </div>
    </div>
  )
}
