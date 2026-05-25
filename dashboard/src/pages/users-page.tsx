import { useCallback, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminList } from '@/hooks/use-admin-list';
import {
  type AdminUserRow,
  type ModulePermissionDefinition,
  adminApi,
} from '@/lib/api';
import { formatDate, formatTeamRole } from '@/lib/format';

function userTeams(user: AdminUserRow) {
  return (
    user.memberships.map((membership) => membership.team.name).join('、') || '-'
  );
}

function userRoles(user: AdminUserRow) {
  return (
    user.memberships
      .map((membership) => formatTeamRole(membership.role))
      .join('、') || '-'
  );
}

function moduleKeys(user: AdminUserRow) {
  return (
    user.modulePermissions.map((item) => item.permissionKey).join('、') || '-'
  );
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

export function UsersPage() {
  const loader = useCallback(
    (options: { page: number; pageSize: number }) =>
      adminApi.listUsers(options),
    [],
  );
  const { error, isLoading, page, pageSize, refresh, rows, setPage, total } =
    useAdminList(loader);
  const [feedback, setFeedback] = useState('');
  const [submittingIds, setSubmittingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [selectedUser, setSelectedUser] = useState<AdminUserRow | null>(null);
  const [definitions, setDefinitions] = useState<ModulePermissionDefinition[]>(
    [],
  );
  const [permissionKeys, setPermissionKeys] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [permissionError, setPermissionError] = useState('');
  const [permissionFeedback, setPermissionFeedback] = useState('');
  const [isPermissionLoading, setIsPermissionLoading] = useState(false);
  const [isPermissionSaving, setIsPermissionSaving] = useState(false);

  async function updateStatus(user: AdminUserRow) {
    if (submittingIds.has(user.id)) return;
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    setFeedback('');
    setSubmittingIds((current) => new Set(current).add(user.id));
    try {
      await adminApi.updateUserStatus(user.id, nextStatus);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '操作失败');
    } finally {
      setSubmittingIds((current) => {
        const next = new Set(current);
        next.delete(user.id);
        return next;
      });
    }
  }

  async function openPermissions(user: AdminUserRow) {
    setSelectedUser(user);
    setPermissionError('');
    setPermissionFeedback('');
    setIsPermissionLoading(true);
    try {
      const [nextDefinitions, permissions] = await Promise.all([
        adminApi.listModulePermissions(),
        adminApi.listUserModulePermissions(user.id),
      ]);
      setDefinitions(nextDefinitions);
      setPermissionKeys(new Set(permissions.permissionKeys));
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '加载失败',
      );
    } finally {
      setIsPermissionLoading(false);
    }
  }

  async function savePermissions() {
    if (!selectedUser) return;
    setPermissionError('');
    setPermissionFeedback('');
    setIsPermissionSaving(true);
    try {
      const result = await adminApi.replaceUserModulePermissions(
        selectedUser.id,
        [...permissionKeys],
      );
      setPermissionKeys(new Set(result.permissionKeys));
      setPermissionFeedback('模块权限已保存');
      await refresh();
    } catch (nextError) {
      setPermissionError(
        nextError instanceof Error ? nextError.message : '保存失败',
      );
    } finally {
      setIsPermissionSaving(false);
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>邮箱</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>团队</TableHead>
                <TableHead>身份</TableHead>
                <TableHead>模块</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead className="sticky right-0 bg-background text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        user.status === 'active' ? 'secondary' : 'outline'
                      }
                    >
                      {user.status === 'active' ? '启用' : '停用'}
                    </Badge>
                  </TableCell>
                  <TableCell>{userTeams(user)}</TableCell>
                  <TableCell>{userRoles(user)}</TableCell>
                  <TableCell>{moduleKeys(user)}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{formatDate(user.updatedAt)}</TableCell>
                  <TableCell className="sticky right-0 bg-background">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={submittingIds.has(user.id)}
                        onClick={() => updateStatus(user)}
                      >
                        {user.status === 'active' ? '停用' : '启用'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => openPermissions(user)}
                      >
                        模块权限
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
        open={selectedUser !== null}
        onOpenChange={(open) => !open && setSelectedUser(null)}
      >
        <SheetContent className="overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{selectedUser?.email ?? '模块权限'}</SheetTitle>
          </SheetHeader>
          <div className="flex flex-col gap-4 px-4 pb-4">
            {isPermissionLoading ? <LoadingState /> : null}
            {permissionError ? (
              <ErrorState
                message={permissionError}
                onRetry={() => selectedUser && openPermissions(selectedUser)}
              />
            ) : null}
            {permissionFeedback ? (
              <p className="text-sm text-muted-foreground">
                {permissionFeedback}
              </p>
            ) : null}
            {!isPermissionLoading ? (
              <>
                <div className="grid gap-2">
                  {definitions.map((definition) => (
                    <label
                      key={definition.key}
                      className="flex items-center gap-2 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={permissionKeys.has(definition.key)}
                        onChange={(event) =>
                          setPermissionKeys((current) =>
                            toggleSetValue(
                              current,
                              definition.key,
                              event.target.checked,
                            ),
                          )
                        }
                      />
                      <span>{definition.label}</span>
                    </label>
                  ))}
                </div>
                <Button disabled={isPermissionSaving} onClick={savePermissions}>
                  保存
                </Button>
              </>
            ) : null}
          </div>
        </SheetContent>
      </Sheet>
    </main>
  );
}
