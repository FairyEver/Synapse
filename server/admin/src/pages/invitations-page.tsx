import * as React from "react"
import { Copy, Trash2 } from "lucide-react"
import { PageState } from "@/components/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
  const [selectedIds, setSelectedIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [copyError, setCopyError] = React.useState<string | null>(null)
  const invitations = result?.data ?? []
  const selectedCount = selectedIds.size
  const allVisibleSelected = invitations.length > 0 && invitations.every((invitation) => selectedIds.has(invitation.id))
  const someVisibleSelected = invitations.some((invitation) => selectedIds.has(invitation.id))

  React.useEffect(() => {
    const visibleIds = new Set(invitations.map((invitation) => invitation.id))
    setSelectedIds((previous) => {
      const next = new Set([...previous].filter((id) => visibleIds.has(id)))
      return next.size === previous.size ? previous : next
    })
  }, [invitations])

  function toggleInvitation(id: string, checked: boolean | "indeterminate") {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(id)
      else next.delete(id)
      return next
    })
  }

  function toggleVisibleInvitations(checked: boolean | "indeterminate") {
    setSelectedIds((previous) => {
      const next = new Set(previous)
      for (const invitation of invitations) {
        if (checked === true) next.add(invitation.id)
        else next.delete(invitation.id)
      }
      return next
    })
  }

  async function deleteInvitation(invitation: AdminInvitationRow) {
    await adminApi.deleteInvitation(invitation.id)
    reload()
  }

  async function deleteSelectedInvitations() {
    const ids = invitations.map((invitation) => invitation.id).filter((id) => selectedIds.has(id))
    if (ids.length === 0) return
    await adminApi.deleteInvitations(ids)
    setSelectedIds(new Set())
    reload()
  }

  async function copyInvitationLink(inviteUrl: string) {
    setCopyError(null)
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
      await navigator.clipboard.writeText(inviteUrl)
    } catch {
      setCopyError("复制失败")
    }
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <SignupInvitationAction onCreated={reload} />
        <Button
          disabled={selectedCount === 0}
          variant="destructive"
          onClick={() => void deleteSelectedInvitations()}
        >
          <Trash2 data-icon="inline-start" />
          删除所选
        </Button>
      </div>
      {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}
      {!result || invitations.length === 0 ? (
        <PageState>暂无邀请</PageState>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Checkbox
                  aria-label="选择全部邀请"
                  checked={allVisibleSelected ? true : someVisibleSelected ? "indeterminate" : false}
                  onCheckedChange={toggleVisibleInvitations}
                />
              </TableHead>
              <TableHead>邀请 ID</TableHead>
              <TableHead>邀请链接</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>关联团队</TableHead>
              <TableHead>创建人</TableHead>
              <TableHead>使用人</TableHead>
              <TableHead>使用时间</TableHead>
              <TableHead>过期时间</TableHead>
              <TableHead>创建时间</TableHead>
              <TableActionHead>操作</TableActionHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invitations.map((invitation) => {
              const expired = !invitation.usedAt && new Date(invitation.expiresAt).getTime() <= Date.now()
              const status = invitation.usedAt ? "已使用" : expired ? "已过期" : "可用"
              const inviteUrl = invitation.inviteUrl
              return (
                <TableRow key={invitation.id}>
                  <TableCell>
                    <Checkbox
                      aria-label={`选择邀请 ${invitation.id}`}
                      checked={selectedIds.has(invitation.id)}
                      onCheckedChange={(checked) => toggleInvitation(invitation.id, checked)}
                    />
                  </TableCell>
                  <TableCell>{invitation.id}</TableCell>
                  <TableCell>
                    {inviteUrl ? (
                      <Button
                        aria-label={`复制邀请链接 ${invitation.id}`}
                        size="sm"
                        variant="outline"
                        onClick={() => void copyInvitationLink(inviteUrl)}
                      >
                        <Copy data-icon="inline-start" />
                        复制
                      </Button>
                    ) : (
                      "-"
                    )}
                  </TableCell>
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
                  <TableActionCell>
                    <Button
                      aria-label={`删除邀请 ${invitation.id}`}
                      size="icon-sm"
                      variant="destructive"
                      onClick={() => void deleteInvitation(invitation)}
                    >
                      <Trash2 />
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
