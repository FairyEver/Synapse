import { PageState } from "@/components/page-state"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type AdminInvitationRow, type PaginatedResponse } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { SignupInvitationAction } from "./signup-invitation-action"

function formatInvitationType(type: AdminInvitationRow["type"]): string {
  if (type === "team_join") return "团队加入"
  return "用户注册"
}

function formatCreator(invitation: AdminInvitationRow): string {
  return invitation.createdByAdmin?.email ?? invitation.createdByUser?.email ?? "-"
}

export function InvitationsPage() {
  const { data: result, error, loading, reload } = useApiResource<PaginatedResponse<AdminInvitationRow>>(
    () => adminApi.listInvitations(),
  )

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>

  return (
    <div className="space-y-4">
      <SignupInvitationAction onCreated={reload} />
      {!result || result.data.length === 0 ? (
        <PageState>暂无邀请</PageState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邀请 ID</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>关联团队</TableHead>
              <TableHead>创建人</TableHead>
              <TableHead>使用人</TableHead>
              <TableHead>使用时间</TableHead>
              <TableHead>过期时间</TableHead>
              <TableHead>创建时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.data.map((invitation) => {
              const expired = !invitation.usedAt && new Date(invitation.expiresAt).getTime() <= Date.now()
              const status = invitation.usedAt ? "已使用" : expired ? "已过期" : "可用"
              return (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.id}</TableCell>
                  <TableCell>{formatInvitationType(invitation.type)}</TableCell>
                  <TableCell>
                    <Badge variant={status === "可用" ? "default" : "secondary"}>{status}</Badge>
                  </TableCell>
                  <TableCell>{invitation.team?.name ?? "-"}</TableCell>
                  <TableCell>{formatCreator(invitation)}</TableCell>
                  <TableCell>{invitation.acceptedByUser?.email ?? "-"}</TableCell>
                  <TableCell>{formatDate(invitation.usedAt)}</TableCell>
                  <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                  <TableCell>{formatDate(invitation.createdAt)}</TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
