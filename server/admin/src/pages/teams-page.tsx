import * as React from "react"
import { ShieldCheck } from "lucide-react"
import { PageState } from "@/components/page-state"
import { PaginationFooter } from "@/components/pagination-footer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { adminApi, type AdminTeamRow, type PaginatedResponse, type PermissionDefinition } from "@/lib/api"
import { formatDate } from "@/lib/format"
import { formatTeamRole } from "@/lib/team-role"

const permissionGroupLabels: Record<string, string> = {
  agent: "Agent",
  automation: "自动化",
  content: "内容",
  database: "数据",
  local: "本机",
  team: "团队",
  usage: "使用分析",
}

function formatPermissionGroup(group: string): string {
  return permissionGroupLabels[group] ?? group
}

function groupPermissions(permissions: readonly PermissionDefinition[]): Array<{
  readonly group: string
  readonly permissions: PermissionDefinition[]
}> {
  const grouped = new Map<string, PermissionDefinition[]>()
  for (const permission of permissions) {
    const group = formatPermissionGroup(permission.group)
    grouped.set(group, [...(grouped.get(group) ?? []), permission])
  }
  return [...grouped.entries()].map(([group, items]) => ({ group, permissions: items }))
}

export function TeamsPage() {
  const [page, setPage] = React.useState(1)
  const { data: result, error, loading } = useApiResource<PaginatedResponse<AdminTeamRow>>(
    () => adminApi.listTeams({ page }),
    [page],
  )
  const [editingTeam, setEditingTeam] = React.useState<AdminTeamRow | null>(null)
  const [permissions, setPermissions] = React.useState<PermissionDefinition[]>([])
  const [permissionKeys, setPermissionKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [permissionLoading, setPermissionLoading] = React.useState(false)
  const [permissionSaving, setPermissionSaving] = React.useState(false)
  const [permissionError, setPermissionError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!editingTeam) return
    let alive = true
    setPermissionLoading(true)
    setPermissionError(null)
    Promise.all([
      adminApi.listPermissions(),
      adminApi.listTeamEntitlements(editingTeam.id),
    ])
      .then(([nextPermissions, entitlements]) => {
        if (!alive) return
        setPermissions(nextPermissions)
        setPermissionKeys(new Set(entitlements.permissionKeys))
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setPermissionError(caught instanceof Error ? caught.message : "加载失败")
      })
      .finally(() => {
        if (alive) setPermissionLoading(false)
      })
    return () => {
      alive = false
    }
  }, [editingTeam])

  function updatePermissionKey(permissionKey: string, checked: boolean | "indeterminate") {
    setPermissionKeys((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(permissionKey)
      else next.delete(permissionKey)
      return next
    })
  }

  async function saveTeamPermissions() {
    if (!editingTeam) return
    setPermissionSaving(true)
    setPermissionError(null)
    try {
      const orderedKeys = permissions
        .filter((permission) => permissionKeys.has(permission.key))
        .map((permission) => permission.key)
      const result = await adminApi.replaceTeamEntitlements(editingTeam.id, orderedKeys)
      setPermissionKeys(new Set(result.permissionKeys))
      setEditingTeam(null)
    } catch (caught) {
      setPermissionError(caught instanceof Error ? caught.message : "保存失败")
    } finally {
      setPermissionSaving(false)
    }
  }

  function closePermissionsDialog(open: boolean) {
    if (open || permissionSaving) return
    setEditingTeam(null)
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!result || result.data.length === 0) return <PageState>暂无团队</PageState>

  const permissionGroups = groupPermissions(permissions)

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>所有者</TableHead>
            <TableHead>成员</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead>更新时间</TableHead>
            <TableActionHead>操作</TableActionHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((team) => (
            <TableRow key={team.id}>
              <TableCell>{team.name}</TableCell>
              <TableCell>{team.createdByUser.email}</TableCell>
              <TableCell className="min-w-64 whitespace-normal">
                <div className="flex flex-col gap-1">
                  {team.memberships.map((membership) => (
                    <div
                      key={`${membership.user.email}-${membership.role}-${membership.createdAt}`}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <span className="truncate">{membership.user.email}</span>
                      <Badge variant="outline" className="shrink-0">{formatTeamRole(membership.role)}</Badge>
                    </div>
                  ))}
                </div>
              </TableCell>
              <TableCell>{formatDate(team.createdAt)}</TableCell>
              <TableCell>{formatDate(team.updatedAt)}</TableCell>
              <TableActionCell>
                <Button size="sm" variant="outline" onClick={() => setEditingTeam(team)}>
                  <ShieldCheck data-icon="inline-start" />
                  权限
                </Button>
              </TableActionCell>
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
      <Dialog open={editingTeam !== null} onOpenChange={closePermissionsDialog}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingTeam ? `${editingTeam.name} 权限` : "团队权限"}</DialogTitle>
          </DialogHeader>
          {permissionLoading ? <PageState>加载中</PageState> : null}
          {permissionError ? <p className="text-sm text-destructive">{permissionError}</p> : null}
          {!permissionLoading && permissions.length === 0 ? <PageState>暂无权限</PageState> : null}
          {!permissionLoading && permissionGroups.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <div className="grid gap-4">
                {permissionGroups.map((group) => (
                  <section key={group.group} className="grid gap-2">
                    <h2 className="text-sm font-medium">{group.group}</h2>
                    <div className="grid gap-2">
                      {group.permissions.map((permission) => (
                        <Label
                          key={permission.key}
                          className="flex items-start gap-3 rounded-md border p-3"
                          htmlFor={`team-permission-${permission.key}`}
                        >
                          <Checkbox
                            id={`team-permission-${permission.key}`}
                            aria-label={`开通 ${permission.label}`}
                            checked={permissionKeys.has(permission.key)}
                            disabled={permissionSaving}
                            onCheckedChange={(checked) => updatePermissionKey(permission.key, checked)}
                          />
                          <span className="grid gap-1">
                            <span>{permission.label}</span>
                            <span className="text-xs font-normal text-muted-foreground">{permission.key}</span>
                          </span>
                        </Label>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={permissionSaving} onClick={() => setEditingTeam(null)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={permissionLoading || permissionSaving || permissions.length === 0}
              onClick={() => void saveTeamPermissions()}
            >
              {permissionSaving ? "保存中" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
