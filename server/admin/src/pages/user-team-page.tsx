import * as React from "react"
import { Copy, LogOutIcon, UserMinusIcon } from "lucide-react"
import { PageState } from "@/components/page-state"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { userDashboardApi, type MyTeam, type TeamMember } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { formatTeamRole } from "@/lib/team-role"

export function UserTeamPage() {
  const { data: membership, error, loading, reload } = useApiResource<MyTeam | null>(() => userDashboardApi.getMyTeam())
  const [teamName, setTeamName] = React.useState("")
  const [inviteUrl, setInviteUrl] = React.useState("")
  const [dialogOpen, setDialogOpen] = React.useState(false)
  const [actionError, setActionError] = React.useState<string | null>(null)
  const [copyError, setCopyError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)

  async function copyInviteUrl(value: string) {
    if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable")
    await navigator.clipboard.writeText(value)
  }

  async function createTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitting(true)
    setActionError(null)
    try {
      await userDashboardApi.createTeam({ name: teamName })
      setTeamName("")
      reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function createInvitation() {
    setSubmitting(true)
    setActionError(null)
    setCopyError(null)
    try {
      const invitation = await userDashboardApi.createInvitation()
      setInviteUrl(invitation.inviteUrl)
      setDialogOpen(true)
      try {
        await copyInviteUrl(invitation.inviteUrl)
      } catch {
        setCopyError("复制失败")
      }
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "创建失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function removeMember(member: TeamMember) {
    if (!window.confirm(`确定移除 ${member.user.email}？`)) return
    setSubmitting(true)
    setActionError(null)
    try {
      await userDashboardApi.removeMember(member.userId)
      reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "移除失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function leaveTeam() {
    const message = membership?.role === "owner" ? "退出后团队将被解散。继续退出？" : "确定退出团队？"
    if (!window.confirm(message)) return
    setSubmitting(true)
    setActionError(null)
    try {
      await userDashboardApi.leaveTeam()
      reload()
    } catch (caught) {
      setActionError(caught instanceof Error ? caught.message : "退出失败")
    } finally {
      setSubmitting(false)
    }
  }

  async function copyCurrentInviteUrl() {
    if (!inviteUrl) return
    setCopyError(null)
    try {
      await copyInviteUrl(inviteUrl)
    } catch {
      setCopyError("复制失败")
    }
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>

  if (!membership) {
    return (
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>创建团队</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-2" onSubmit={createTeam}>
            <Label htmlFor="team-name">团队名称</Label>
            <Input
              id="team-name"
              value={teamName}
              onChange={(event) => setTeamName(event.target.value)}
              required
            />
            {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
            <Button type="submit" disabled={submitting}>
              创建团队
            </Button>
          </form>
        </CardContent>
      </Card>
    )
  }

  const members = membership.team.memberships
  const isOwner = membership.role === "owner"

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium">{membership.team.name}</h2>
          <p className="text-sm text-muted-foreground">成员 {members.length}</p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner ? (
            <Button type="button" disabled={submitting} onClick={() => void createInvitation()}>
              创建团队邀请
            </Button>
          ) : null}
          <Button type="button" variant="outline" disabled={submitting} onClick={() => void leaveTeam()}>
            <LogOutIcon data-icon="inline-start" />
            退出团队
          </Button>
        </div>
      </div>
      {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>邮箱</TableHead>
            <TableHead>角色</TableHead>
            <TableHead>加入时间</TableHead>
            {isOwner ? <TableActionHead>操作</TableActionHead> : null}
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((member) => (
            <TableRow key={member.id}>
              <TableCell>{member.user.email}</TableCell>
              <TableCell>
                <Badge variant={member.role === "owner" ? "default" : "secondary"}>{formatTeamRole(member.role)}</Badge>
              </TableCell>
              <TableCell>{formatDate(member.createdAt)}</TableCell>
              {isOwner ? (
                <TableActionCell>
                  {member.role === "member" ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={submitting}
                      onClick={() => void removeMember(member)}
                    >
                      <UserMinusIcon data-icon="inline-start" />
                      移除
                    </Button>
                  ) : null}
                </TableActionCell>
              ) : null}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>团队邀请链接</DialogTitle>
          </DialogHeader>
          <Input aria-label="邀请链接" readOnly value={inviteUrl} className="font-mono text-xs" />
          {copyError ? <p className="text-sm text-destructive">{copyError}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" aria-label="复制邀请链接" onClick={() => void copyCurrentInviteUrl()}>
              <Copy data-icon="inline-start" />
              复制
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
