import * as React from "react"
import { PageState } from "@/components/page-state"
import { PaginationFooter } from "@/components/pagination-footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableActionCell,
  TableActionHead,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type AdminUserRow, type PaginatedResponse } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { SignupInvitationAction } from "./signup-invitation-action"

export function UsersPage() {
  const [page, setPage] = React.useState(1)
  const { data: result, error, loading, reload } = useApiResource<PaginatedResponse<AdminUserRow>>(
    () => adminApi.listUsers({ page }),
    [page],
  )
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [submittingIds, setSubmittingIds] = React.useState<ReadonlySet<string>>(() => new Set())

  async function toggleStatus(user: AdminUserRow) {
    if (submittingIds.has(user.id)) return
    const nextStatus = user.status === "active" ? "disabled" : "active"
    if (
      nextStatus === "disabled" &&
      user.memberships.some((membership) => membership.role === "owner") &&
      !window.confirm("停用团队所有者会使该团队无法继续邀请或管理成员。继续停用？")
    ) {
      return
    }
    setActionError(null)
    setSubmittingIds((previous) => new Set(previous).add(user.id))
    try {
      await adminApi.updateUserStatus(user.id, nextStatus)
      reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "操作失败")
    } finally {
      setSubmittingIds((previous) => {
        const next = new Set(previous)
        next.delete(user.id)
        return next
      })
    }
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!result) return <PageState>暂无用户</PageState>

  return (
    <div className="space-y-4">
      <SignupInvitationAction onCreated={reload} />
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      {result.data.length === 0 ? (
        <PageState>暂无用户</PageState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>团队</TableHead>
              <TableHead>创建时间</TableHead>
              <TableActionHead>操作</TableActionHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((user) => (
              <TableRow key={user.id}>
                <TableCell>{user.email}</TableCell>
                <TableCell>
                  <Badge variant={user.status === "active" ? "default" : "secondary"}>
                    {user.status === "active" ? "启用" : "停用"}
                  </Badge>
                </TableCell>
                <TableCell>
                  {user.memberships.length > 0 ? (
                    <div className="flex flex-col gap-1">
                      {user.memberships.map((membership) => (
                        <span key={membership.team.id}>{`${membership.team.name} / ${membership.role}`}</span>
                      ))}
                    </div>
                  ) : (
                    "-"
                  )}
                </TableCell>
                <TableCell>{formatDate(user.createdAt)}</TableCell>
                <TableActionCell>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={submittingIds.has(user.id)}
                    onClick={() => void toggleStatus(user)}
                  >
                    {user.status === "active" ? "停用" : "启用"}
                  </Button>
                </TableActionCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <PaginationFooter
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        onPageChange={setPage}
      />
    </div>
  )
}
