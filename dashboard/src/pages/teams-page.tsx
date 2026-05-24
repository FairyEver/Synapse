import { useCallback, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { useAdminList } from '@/hooks/use-admin-list';
import {
  type AdminTeamRow,
  type PermissionDefinition,
  type TeamAccessRoleRow,
  adminApi,
} from '@/lib/api';
import { formatDate, formatTeamRole } from '@/lib/format';

function accessRoleNames(membership: AdminTeamRow['memberships'][number]) {
  return membership.accessRoles.map((item) => item.role.name);
}

function toggleSetValue(
  values: ReadonlySet<string>,
  value: string,
  checked: boolean,
) {
  const next = new Set(values);
  if (checked) {
    next.add(value);
  } else {
    next.delete(value);
  }
  return next;
}

function permissionLabel(definition: PermissionDefinition) {
  return `${definition.label} (${definition.key})`;
}

export function TeamsPage() {
  const loader = useCallback(
    (options: { page: number; pageSize: number }) =>
      adminApi.listTeams(options),
    [],
  );
  const { error, isLoading, page, pageSize, refresh, rows, setPage, total } =
    useAdminList(loader);
  const [selectedTeam, setSelectedTeam] = useState<AdminTeamRow | null>(null);
  const [definitions, setDefinitions] = useState<PermissionDefinition[]>([]);
  const [entitlementKeys, setEntitlementKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [accessRoles, setAccessRoles] = useState<TeamAccessRoleRow[]>([]);
  const [memberRoleIds, setMemberRoleIds] = useState<
    Record<string, ReadonlySet<string>>
  >({});
  const [permissionError, setPermissionError] = useState('');
  const [permissionFeedback, setPermissionFeedback] = useState('');
  const [isPermissionLoading, setIsPermissionLoading] = useState(false);
  const [savingTarget, setSavingTarget] = useState('');

  async function openPermissions(team: AdminTeamRow) {
    setSelectedTeam(team);
    setPermissionError('');
    setPermissionFeedback('');
    setIsPermissionLoading(true);

    try {
      const [nextDefinitions, entitlements, roles] = await Promise.all([
        adminApi.listPermissions(),
        adminApi.listTeamEntitlements(team.id),
        adminApi.listTeamAccessRoles(team.id),
      ]);
      setDefinitions(nextDefinitions);
      setEntitlementKeys(new Set(entitlements.permissionKeys));
      setAccessRoles(roles);
      setMemberRoleIds(
        Object.fromEntries(
          team.memberships.map((membership) => [
            membership.id,
            new Set(membership.accessRoles.map((item) => item.role.id)),
          ]),
        ),
      );
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '加载失败',
      );
    } finally {
      setIsPermissionLoading(false);
    }
  }

  async function saveEntitlements() {
    if (!selectedTeam) return;
    setPermissionFeedback('');
    setPermissionError('');
    setSavingTarget('entitlements');
    try {
      const result = await adminApi.replaceTeamEntitlements(selectedTeam.id, [
        ...entitlementKeys,
      ]);
      setEntitlementKeys(new Set(result.permissionKeys));
      setPermissionFeedback('团队权限已保存');
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '保存失败',
      );
    } finally {
      setSavingTarget('');
    }
  }

  async function saveRolePermissions(role: TeamAccessRoleRow) {
    if (!selectedTeam) return;
    setPermissionFeedback('');
    setPermissionError('');
    setSavingTarget(`role:${role.id}`);
    try {
      const result = await adminApi.replaceRolePermissions(
        selectedTeam.id,
        role.id,
        role.permissionKeys,
      );
      setAccessRoles((current) =>
        current.map((item) =>
          item.id === role.id
            ? { ...item, permissionKeys: result.permissionKeys }
            : item,
        ),
      );
      setPermissionFeedback('角色权限已保存');
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '保存失败',
      );
    } finally {
      setSavingTarget('');
    }
  }

  async function saveMemberRoles(membershipId: string) {
    if (!selectedTeam) return;
    setPermissionFeedback('');
    setPermissionError('');
    setSavingTarget(`member:${membershipId}`);
    try {
      await adminApi.replaceMemberAccessRoles(selectedTeam.id, membershipId, [
        ...(memberRoleIds[membershipId] ?? new Set<string>()),
      ]);
      await refresh();
      setPermissionFeedback('成员角色已保存');
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '保存失败',
      );
    } finally {
      setSavingTarget('');
    }
  }

  function updateRolePermission(
    roleId: string,
    permissionKey: string,
    checked: boolean,
  ) {
    setAccessRoles((current) =>
      current.map((role) =>
        role.id === roleId
          ? {
              ...role,
              permissionKeys: [
                ...toggleSetValue(
                  new Set(role.permissionKeys),
                  permissionKey,
                  checked,
                ),
              ].sort(),
            }
          : role,
      ),
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <div className="flex min-w-0 flex-col gap-4">
            {rows.map((team) => (
              <Card key={team.id}>
                <CardContent className="grid min-w-0 gap-6 md:grid-cols-[minmax(260px,360px)_1fr]">
                  <div className="flex min-w-0 flex-col gap-4">
                    <div className="flex min-w-0 items-center justify-between gap-3">
                      <h2 className="truncate text-lg font-semibold">
                        {team.name}
                      </h2>
                      <Badge variant="secondary">
                        {team.memberships.length} 人
                      </Badge>
                    </div>
                    <Button
                      className="w-fit"
                      variant="outline"
                      onClick={() => openPermissions(team)}
                    >
                      管理权限
                    </Button>
                    <div className="grid gap-3 text-sm">
                      <div className="min-w-0">
                        <p className="text-muted-foreground">所有者</p>
                        <p className="truncate font-medium">
                          {team.createdByUser.email}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">创建时间</p>
                        <p>{formatDate(team.createdAt)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">更新时间</p>
                        <p>{formatDate(team.updatedAt)}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-muted-foreground">团队 ID</p>
                        <p className="truncate">{team.id}</p>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    {team.memberships.map((membership) => {
                      const roleNames = accessRoleNames(membership);

                      return (
                        <div
                          key={membership.id}
                          className="grid min-w-0 gap-2 rounded-lg border border-border p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <span className="min-w-0 truncate">
                            {membership.user.email}
                          </span>
                          <div className="flex min-w-0 flex-wrap gap-2 sm:justify-end">
                            <Badge variant="outline">
                              {formatTeamRole(membership.role)}
                            </Badge>
                            {roleNames.map((roleName) => (
                              <Badge
                                key={`${membership.id}-${roleName}`}
                                variant="secondary"
                              >
                                {roleName}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {team.memberships.length === 0 ? (
                      <p className="text-sm text-muted-foreground">暂无成员</p>
                    ) : null}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          {rows.length === 0 ? <EmptyState /> : null}
          <PaginationFooter
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
          />
        </>
      ) : null}
      <Sheet
        open={selectedTeam !== null}
        onOpenChange={(open) => !open && setSelectedTeam(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selectedTeam?.name ?? '权限'}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-6 px-4 pb-4">
            {isPermissionLoading ? <LoadingState /> : null}
            {permissionError && selectedTeam ? (
              <ErrorState
                message={permissionError}
                onRetry={() => openPermissions(selectedTeam)}
              />
            ) : null}
            {permissionFeedback ? (
              <p className="text-sm text-muted-foreground">
                {permissionFeedback}
              </p>
            ) : null}
            {!isPermissionLoading && selectedTeam ? (
              <>
                <section className="grid gap-3">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="font-medium">团队权限</h3>
                    <Button
                      size="sm"
                      disabled={savingTarget === 'entitlements'}
                      onClick={saveEntitlements}
                    >
                      保存
                    </Button>
                  </div>
                  <div className="grid gap-2">
                    {definitions.map((definition) => (
                      <label
                        key={definition.key}
                        className="flex items-center gap-2 text-sm"
                      >
                        <input
                          type="checkbox"
                          checked={entitlementKeys.has(definition.key)}
                          onChange={(event) =>
                            setEntitlementKeys((current) =>
                              toggleSetValue(
                                current,
                                definition.key,
                                event.target.checked,
                              ),
                            )
                          }
                        />
                        <span>{permissionLabel(definition)}</span>
                      </label>
                    ))}
                  </div>
                </section>

                <section className="grid gap-3">
                  <h3 className="font-medium">访问角色</h3>
                  {accessRoles.map((role) => (
                    <div key={role.id} className="grid gap-3 border-t pt-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-medium">{role.name}</span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingTarget === `role:${role.id}`}
                          onClick={() => saveRolePermissions(role)}
                        >
                          保存
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        {definitions.map((definition) => (
                          <label
                            key={`${role.id}-${definition.key}`}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={role.permissionKeys.includes(
                                definition.key,
                              )}
                              onChange={(event) =>
                                updateRolePermission(
                                  role.id,
                                  definition.key,
                                  event.target.checked,
                                )
                              }
                            />
                            <span>{permissionLabel(definition)}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>

                <section className="grid gap-3">
                  <h3 className="font-medium">成员角色</h3>
                  {selectedTeam.memberships.map((membership) => (
                    <div
                      key={membership.id}
                      className="grid gap-3 border-t pt-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="min-w-0 truncate font-medium">
                          {membership.user.email}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={savingTarget === `member:${membership.id}`}
                          onClick={() => saveMemberRoles(membership.id)}
                        >
                          保存
                        </Button>
                      </div>
                      <div className="grid gap-2">
                        {accessRoles.map((role) => (
                          <label
                            key={`${membership.id}-${role.id}`}
                            className="flex items-center gap-2 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={(
                                memberRoleIds[membership.id] ??
                                new Set<string>()
                              ).has(role.id)}
                              onChange={(event) =>
                                setMemberRoleIds((current) => ({
                                  ...current,
                                  [membership.id]: toggleSetValue(
                                    current[membership.id] ??
                                      new Set<string>(),
                                    role.id,
                                    event.target.checked,
                                  ),
                                }))
                              }
                            />
                            <span>{role.name}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
