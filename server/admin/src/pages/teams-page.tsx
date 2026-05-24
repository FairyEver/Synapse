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
import {
  adminApi,
  type AdminTeamRow,
  type PaginatedResponse,
  type PermissionDefinition,
  type TeamAccessRoleRow,
} from "@/lib/api"
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

function accessRoleNames(membership: AdminTeamRow["memberships"][number]): string[] {
  return membership.accessRoles.map((item) => item.role.name)
}

interface EditingMemberRoles {
  readonly team: AdminTeamRow
  readonly membership: AdminTeamRow["memberships"][number]
}

export function TeamsPage() {
  const [page, setPage] = React.useState(1)
  const { data: result, error, loading, reload } = useApiResource<PaginatedResponse<AdminTeamRow>>(
    () => adminApi.listTeams({ page }),
    [page],
  )
  const [editingTeam, setEditingTeam] = React.useState<AdminTeamRow | null>(null)
  const [permissions, setPermissions] = React.useState<PermissionDefinition[]>([])
  const [permissionKeys, setPermissionKeys] = React.useState<ReadonlySet<string>>(() => new Set())
  const [accessRoles, setAccessRoles] = React.useState<TeamAccessRoleRow[]>([])
  const [rolePermissionKeys, setRolePermissionKeys] = React.useState<Record<string, ReadonlySet<string>>>({})
  const [permissionLoading, setPermissionLoading] = React.useState(false)
  const [permissionReloadToken, setPermissionReloadToken] = React.useState(0)
  const [permissionSaving, setPermissionSaving] = React.useState(false)
  const [permissionError, setPermissionError] = React.useState<string | null>(null)
  const [editingMemberRoles, setEditingMemberRoles] = React.useState<EditingMemberRoles | null>(null)
  const [memberRoleOptions, setMemberRoleOptions] = React.useState<TeamAccessRoleRow[]>([])
  const [memberRoleIds, setMemberRoleIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [initialMemberRoleIds, setInitialMemberRoleIds] = React.useState<ReadonlySet<string>>(() => new Set())
  const [memberRoleLoading, setMemberRoleLoading] = React.useState(false)
  const [memberRoleSaving, setMemberRoleSaving] = React.useState(false)
  const [memberRoleError, setMemberRoleError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!editingTeam) return
    let alive = true
    setPermissionLoading(true)
    setPermissionError(null)
    Promise.all([
      adminApi.listPermissions(),
      adminApi.listTeamEntitlements(editingTeam.id),
      adminApi.listTeamAccessRoles(editingTeam.id),
    ])
      .then(([nextPermissions, entitlements, roles]) => {
        if (!alive) return
        setPermissions(nextPermissions)
        setPermissionKeys(new Set(entitlements.permissionKeys))
        setAccessRoles(roles)
        setRolePermissionKeys(Object.fromEntries(
          roles.map((role) => [role.id, new Set(role.permissionKeys)]),
        ))
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
  }, [editingTeam, permissionReloadToken])

  React.useEffect(() => {
    if (!editingMemberRoles) return
    let alive = true
    setMemberRoleLoading(true)
    setMemberRoleError(null)
    Promise.all([
      adminApi.listTeamAccessRoles(editingMemberRoles.team.id),
      adminApi.listMemberAccessRoles(editingMemberRoles.team.id, editingMemberRoles.membership.id),
    ])
      .then(([roles, current]) => {
        if (!alive) return
        const roleIds = new Set(current.roles.map((role) => role.id))
        setMemberRoleOptions(roles)
        setMemberRoleIds(roleIds)
        setInitialMemberRoleIds(new Set(roleIds))
      })
      .catch((caught: unknown) => {
        if (!alive) return
        setMemberRoleError(caught instanceof Error ? caught.message : "加载失败")
      })
      .finally(() => {
        if (alive) setMemberRoleLoading(false)
      })
    return () => {
      alive = false
    }
  }, [editingMemberRoles])

  function updatePermissionKey(permissionKey: string, checked: boolean | "indeterminate") {
    if (checked !== true) {
      setRolePermissionKeys((previousRoles) => Object.fromEntries(
        Object.entries(previousRoles).map(([roleId, keys]) => {
          const nextKeys = new Set(keys)
          nextKeys.delete(permissionKey)
          return [roleId, nextKeys]
        }),
      ))
    }
    setPermissionKeys((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(permissionKey)
      else next.delete(permissionKey)
      return next
    })
  }

  function updateRolePermissionKey(roleId: string, permissionKey: string, checked: boolean | "indeterminate") {
    setRolePermissionKeys((previous) => {
      const nextKeys = new Set(previous[roleId] ?? [])
      if (checked === true) nextKeys.add(permissionKey)
      else nextKeys.delete(permissionKey)
      return { ...previous, [roleId]: nextKeys }
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
      const entitlementSet = new Set(orderedKeys)
      const result = await adminApi.replaceTeamPermissions(editingTeam.id, {
        permissionKeys: orderedKeys,
        rolePermissions: accessRoles
          .filter((role) => !role.locked)
          .map((role) => ({
            roleId: role.id,
            permissionKeys: permissions
              .filter((permission) => entitlementSet.has(permission.key))
              .filter((permission) => rolePermissionKeys[role.id]?.has(permission.key))
              .map((permission) => permission.key),
          })),
      })
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

  function retryLoadPermissions() {
    setPermissionReloadToken((value) => value + 1)
  }

  function updateMemberRole(roleId: string, checked: boolean | "indeterminate") {
    setMemberRoleIds((previous) => {
      const next = new Set(previous)
      if (checked === true) next.add(roleId)
      else next.delete(roleId)
      return next
    })
  }

  async function saveMemberRoles() {
    if (!editingMemberRoles) return
    setMemberRoleSaving(true)
    setMemberRoleError(null)
    try {
      const next = await adminApi.replaceMemberAccessRoles(
        editingMemberRoles.team.id,
        editingMemberRoles.membership.id,
        Array.from(memberRoleIds),
      )
      setInitialMemberRoleIds(new Set(next.roles.map((role) => role.id)))
      setMemberRoleIds(new Set(next.roles.map((role) => role.id)))
      reload()
      setEditingMemberRoles(null)
    } catch (caught) {
      setMemberRoleError(caught instanceof Error ? caught.message : "保存失败")
    } finally {
      setMemberRoleSaving(false)
    }
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!result) return <PageState>暂无团队</PageState>

  const permissionGroups = groupPermissions(permissions)
  const editableRoleCount = accessRoles.filter((role) => !role.locked).length

  return (
    <div className="flex flex-col gap-4">
      {result.data.length === 0 ? (
        <PageState>暂无团队</PageState>
      ) : (
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
                        {accessRoleNames(membership).map((roleName) => (
                          <Badge key={roleName} variant="secondary" className="shrink-0">{roleName}</Badge>
                        ))}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="shrink-0"
                          onClick={() => setEditingMemberRoles({ team, membership })}
                        >
                          角色
                        </Button>
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
      )}
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
          {permissionError ? (
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-destructive">{permissionError}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={permissionLoading}
                onClick={retryLoadPermissions}
              >
                重试
              </Button>
            </div>
          ) : null}
          {!permissionError && !permissionLoading && permissions.length === 0 ? <PageState>暂无权限</PageState> : null}
          {!permissionLoading && permissionGroups.length > 0 ? (
            <div className="max-h-96 overflow-y-auto">
              <div className="grid gap-5">
                <section className="grid gap-3">
                  <h2 className="text-sm font-medium">团队开通权限</h2>
                  <div className="grid gap-4">
                    {permissionGroups.map((group) => (
                      <section key={group.group} className="grid gap-2">
                        <h3 className="text-sm font-medium">{group.group}</h3>
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
                </section>
                {accessRoles.length > 0 ? (
                  <section className="grid gap-3">
                    <div className="flex items-center justify-between gap-3">
                      <h2 className="text-sm font-medium">角色权限</h2>
                      {editableRoleCount === 0 ? <Badge variant="outline">只读</Badge> : null}
                    </div>
                    <div className="grid gap-3">
                      {accessRoles.map((role) => (
                        <section key={role.id} className="grid gap-2">
                          <div className="flex items-center gap-2">
                            <h3 className="text-sm font-medium">{role.name}</h3>
                            {role.locked ? <Badge variant="secondary">系统</Badge> : null}
                          </div>
                          <div className="grid gap-2">
                            {permissions.map((permission) => {
                              const enabledByTeam = permissionKeys.has(permission.key)
                              return (
                                <Label
                                  key={`${role.id}-${permission.key}`}
                                  className="flex items-start gap-3 rounded-md border p-3"
                                  htmlFor={`role-permission-${role.id}-${permission.key}`}
                                >
                                  <Checkbox
                                    id={`role-permission-${role.id}-${permission.key}`}
                                    aria-label={`角色 ${role.name} 权限 ${permission.label}`}
                                    checked={Boolean(enabledByTeam && rolePermissionKeys[role.id]?.has(permission.key))}
                                    disabled={permissionSaving || role.locked || !enabledByTeam}
                                    onCheckedChange={(checked) => {
                                      updateRolePermissionKey(role.id, permission.key, checked)
                                    }}
                                  />
                                  <span className="grid gap-1">
                                    <span>{permission.label}</span>
                                    <span className="text-xs font-normal text-muted-foreground">{permission.key}</span>
                                  </span>
                                </Label>
                              )
                            })}
                          </div>
                        </section>
                      ))}
                    </div>
                  </section>
                ) : null}
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
      <Dialog open={editingMemberRoles !== null} onOpenChange={(open) => {
        if (open || memberRoleSaving) return
        setEditingMemberRoles(null)
      }}>
        <DialogContent aria-describedby={undefined} className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingMemberRoles?.membership.user.email ?? "成员角色"}</DialogTitle>
          </DialogHeader>
          {memberRoleLoading ? <PageState>加载中</PageState> : null}
          {memberRoleError ? <p className="text-sm text-destructive">{memberRoleError}</p> : null}
          {!memberRoleError && !memberRoleLoading && memberRoleOptions.length === 0 ? <PageState>暂无角色</PageState> : null}
          {!memberRoleLoading && memberRoleOptions.length > 0 ? (
            <div className="grid gap-2">
              {memberRoleOptions.map((role) => (
                <Label
                  key={role.id}
                  className="flex items-start gap-3 rounded-md border p-3"
                  htmlFor={`member-role-${role.id}`}
                >
                  <Checkbox
                    id={`member-role-${role.id}`}
                    aria-label={`分配角色 ${role.name}`}
                    checked={memberRoleIds.has(role.id)}
                    disabled={memberRoleSaving}
                    onCheckedChange={(checked) => updateMemberRole(role.id, checked)}
                  />
                  <span className="grid gap-1">
                    <span>{role.name}</span>
                    {role.description ? (
                      <span className="text-xs font-normal text-muted-foreground">{role.description}</span>
                    ) : null}
                  </span>
                </Label>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={memberRoleSaving}
              onClick={() => setEditingMemberRoles(null)}
            >
              取消
            </Button>
            <Button
              type="button"
              disabled={memberRoleLoading || memberRoleSaving || memberRoleOptions.length === 0}
              onClick={() => void saveMemberRoles()}
            >
              {memberRoleSaving ? "保存中" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
