import * as React from "react"
import { adminApi, type AuditLog, type PaginatedResponse } from "@/lib/api"
import { useApiResource } from "@/hooks/use-api-resource"
import { formatDate } from "@/lib/format"
import { PageState } from "@/components/page-state"
import { PaginationFooter } from "@/components/pagination-footer"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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

export const AUDIT_ACTION_FILTER_OPTIONS = [
  { value: "all", label: "全部操作" },
  { value: "admin.login.success", label: "admin.login.success" },
  { value: "dashboard.login.failure", label: "dashboard.login.failure" },
  { value: "dashboard.login.disabled", label: "dashboard.login.disabled" },
  { value: "user.dashboard_login.success", label: "user.dashboard_login.success" },
  { value: "user.dashboard_login.disabled", label: "user.dashboard_login.disabled" },
  { value: "admin.invitation.create", label: "admin.invitation.create" },
  { value: "admin.invitation.delete", label: "admin.invitation.delete" },
  { value: "admin.invitation.delete_many", label: "admin.invitation.delete_many" },
  { value: "admin.invitation.delete.not_found", label: "admin.invitation.delete.not_found" },
  { value: "admin.audit_logs.export", label: "admin.audit_logs.export" },
  { value: "admin.logout", label: "admin.logout" },
  { value: "admin.user.status_update", label: "admin.user.status_update" },
  { value: "admin.team_entitlements.update", label: "admin.team_entitlements.update" },
  { value: "admin.team_permissions.update", label: "admin.team_permissions.update" },
  { value: "admin.team_role_permissions.update", label: "admin.team_role_permissions.update" },
  { value: "admin.team_member_access_roles.replace", label: "admin.team_member_access_roles.replace" },
  { value: "admin.team_member_access_role.assign", label: "admin.team_member_access_role.assign" },
  { value: "admin.team_member_access_role.remove", label: "admin.team_member_access_role.remove" },
  { value: "user.register.success", label: "user.register.success" },
  { value: "user.login.success", label: "user.login.success" },
  { value: "user.login.failure", label: "user.login.failure" },
  { value: "user.login.disabled", label: "user.login.disabled" },
  { value: "user.logout.success", label: "user.logout.success" },
  { value: "user.dashboard_logout", label: "user.dashboard_logout" },
  { value: "team.create", label: "team.create" },
  { value: "team.invitation.create", label: "team.invitation.create" },
  { value: "team.join", label: "team.join" },
  { value: "team.member.remove", label: "team.member.remove" },
  { value: "team.leave", label: "team.leave" },
  { value: "backup.list", label: "backup.list" },
  { value: "backup.download", label: "backup.download" },
  { value: "backup.post", label: "backup.post" },
  { value: "backup.post.failed", label: "backup.post.failed" },
  { value: "backup.delete", label: "backup.delete" },
  { value: "backup.delete.failed", label: "backup.delete.failed" },
  { value: "backup.scheduled", label: "backup.scheduled" },
  { value: "backup.cleanup.delete", label: "backup.cleanup.delete" },
  { value: "backup.cleanup.failed", label: "backup.cleanup.failed" },
  { value: "logs.download", label: "logs.download" },
  { value: "logs.cleanup", label: "logs.cleanup" },
] as const

export function AuditLogsPage() {
  const [action, setAction] = React.useState<string>("all")
  const [from, setFrom] = React.useState("")
  const [to, setTo] = React.useState("")
  const [page, setPage] = React.useState(1)
  const [exporting, setExporting] = React.useState(false)
  const [exportError, setExportError] = React.useState<string | null>(null)

  const actionFilter = action === "all" ? undefined : action
  const { data: result, loading, error } = useApiResource<PaginatedResponse<AuditLog>>(
    () => adminApi.listAuditLogs({ action: actionFilter, from: from || undefined, to: to || undefined, page }),
    [action, from, to, page],
  )

  function handleActionChange(value: string) {
    setAction(value)
    setPage(1)
  }

  function handleFromChange(value: string) {
    setFrom(value)
    setPage(1)
  }

  function handleToChange(value: string) {
    setTo(value)
    setPage(1)
  }

  async function handleExport() {
    setExporting(true)
    setExportError(null)
    try {
      await adminApi.exportAuditLogs({ action: actionFilter, from: from || undefined, to: to || undefined })
    } catch (caught: unknown) {
      setExportError(caught instanceof Error ? caught.message : "导出失败")
    } finally {
      setExporting(false)
    }
  }

  if (loading) return <PageState>加载中…</PageState>
  if (error) return <PageState>{`加载失败：${error}`}</PageState>
  if (!result) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Select value={action} onValueChange={handleActionChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            {AUDIT_ACTION_FILTER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input type="date" value={from} onChange={(e) => handleFromChange(e.target.value)} className="w-40" />
        <Input type="date" value={to} onChange={(e) => handleToChange(e.target.value)} className="w-40" />
        <Button variant="outline" disabled={exporting} onClick={() => void handleExport()}>
          {exporting ? "导出中…" : "导出 CSV"}
        </Button>
      </div>
      {exportError ? <PageState>{exportError}</PageState> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>时间</TableHead>
            <TableHead>操作者</TableHead>
            <TableHead>操作</TableHead>
            <TableHead>目标类型</TableHead>
            <TableHead>目标 ID</TableHead>
            <TableHead>详情</TableHead>
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
              <TableCell>
                <AuditDetailCell log={log} />
              </TableCell>
              <TableCell>{log.ipAddress}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <PaginationFooter
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        onPageChange={setPage}
      />
    </div>
  )
}

function AuditDetailCell({ log }: { readonly log: AuditLog }) {
  if (!hasAuditDetail(log.detail)) return <span className="text-muted-foreground">-</span>

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm">详情</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>审计详情</DialogTitle>
          <DialogDescription>{log.action}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 font-mono text-xs">
          {formatAuditDetail(log.detail)}
        </pre>
      </DialogContent>
    </Dialog>
  )
}

function hasAuditDetail(detail: unknown): boolean {
  return detail !== null && detail !== undefined
}

function formatAuditDetail(detail: unknown): string {
  if (typeof detail === "string") return detail

  try {
    return JSON.stringify(detail, null, 2) ?? String(detail)
  } catch {
    return "无法显示详情"
  }
}
