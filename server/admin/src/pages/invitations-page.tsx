import * as React from "react"
import { PageState } from "@/components/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

export function InvitationsPage() {
  const [createdToken, setCreatedToken] = React.useState("")
  const { data: result, error, loading, reload } = useApiResource<PaginatedResponse<AdminInvitationRow>>(
    () => adminApi.listInvitations(),
  )

  async function createInvitation() {
    const invitation = await adminApi.createSignupInvitation()
    setCreatedToken(invitation.token)
    reload()
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Button onClick={() => void createInvitation()}>创建邀请</Button>
        {createdToken ? <Input readOnly value={createdToken} className="max-w-xl font-mono text-xs" /> : null}
      </div>
      {!result || result.data.length === 0 ? (
        <PageState>暂无邀请</PageState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>状态</TableHead>
              <TableHead>使用人</TableHead>
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
                  <TableCell>
                    <Badge variant={status === "可用" ? "default" : "secondary"}>{status}</Badge>
                  </TableCell>
                  <TableCell>{invitation.acceptedByUser?.email ?? "-"}</TableCell>
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
