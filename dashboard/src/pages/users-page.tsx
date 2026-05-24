import { useCallback, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminList } from '@/hooks/use-admin-list';
import { type AdminUserRow, adminApi } from '@/lib/api';
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

function accessRoles(user: AdminUserRow) {
  return (
    user.memberships
      .flatMap((membership) =>
        membership.accessRoles.map((item) => item.role.name),
      )
      .join('、') || '-'
  );
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

  async function createInvitation() {
    setFeedback('');
    try {
      const result = await adminApi.createSignupInvitation();
      await navigator.clipboard.writeText(result.inviteUrl);
      setFeedback('邀请链接已复制');
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '创建失败');
    }
  }

  async function updateStatus(user: AdminUserRow) {
    const nextStatus = user.status === 'active' ? 'disabled' : 'active';
    setFeedback('');
    try {
      await adminApi.updateUserStatus(user.id, nextStatus);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '操作失败');
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{feedback}</p>
        <Button onClick={createInvitation}>创建邀请</Button>
      </div>
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
                <TableHead>访问角色</TableHead>
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
                  <TableCell>{accessRoles(user)}</TableCell>
                  <TableCell>{formatDate(user.createdAt)}</TableCell>
                  <TableCell>{formatDate(user.updatedAt)}</TableCell>
                  <TableCell className="sticky right-0 bg-background text-right">
                    <Button
                      variant="outline"
                      onClick={() => updateStatus(user)}
                    >
                      {user.status === 'active' ? '停用' : '启用'}
                    </Button>
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
    </main>
  );
}
