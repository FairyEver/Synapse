import { PageState } from "@/components/page-state"
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
  const { data: result, error, loading, reload } = useApiResource<PaginatedResponse<AdminUserRow>>(
    () => adminApi.listUsers(),
  )

  async function toggleStatus(user: AdminUserRow) {
    await adminApi.updateUserStatus(user.id, user.status === "active" ? "disabled" : "active")
    reload()
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!result) return <PageState>暂无用户</PageState>

  return (
    <div className="space-y-4">
      <SignupInvitationAction onCreated={reload} />
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
            {result.data.map((user) => {
              const membership = user.memberships[0]
              return (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge variant={user.status === "active" ? "default" : "secondary"}>
                      {user.status === "active" ? "启用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell>{membership ? `${membership.team.name} / ${membership.role}` : "-"}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableActionCell>
                    <Button variant="outline" size="sm" onClick={() => void toggleStatus(user)}>
                      {user.status === "active" ? "停用" : "启用"}
                    </Button>
                  </TableActionCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
