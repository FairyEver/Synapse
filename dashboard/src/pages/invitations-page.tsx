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
import { type AdminInvitationRow, adminApi } from '@/lib/api';
import { formatDate } from '@/lib/format';

function invitationType(type: AdminInvitationRow['type']) {
  return type === 'team_join' ? '团队加入' : '用户注册';
}

function invitationStatus(invitation: AdminInvitationRow) {
  if (invitation.usedAt) return '已使用';
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return '已过期';
  return '可用';
}

function creator(invitation: AdminInvitationRow) {
  return (
    invitation.createdByAdmin?.email ?? invitation.createdByUser?.email ?? '-'
  );
}

export function InvitationsPage() {
  const loader = useCallback(
    (options: { page: number; pageSize: number }) =>
      adminApi.listInvitations(options),
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
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '创建失败');
    }
  }

  async function copyInvitation(invitation: AdminInvitationRow) {
    if (!invitation.inviteUrl) return;
    await navigator.clipboard.writeText(invitation.inviteUrl);
    setFeedback('邀请链接已复制');
  }

  async function deleteInvitation(invitation: AdminInvitationRow) {
    setFeedback('');
    try {
      await adminApi.deleteInvitation(invitation.id);
      await refresh();
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '删除失败');
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
                <TableHead>邀请 ID</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>团队</TableHead>
                <TableHead>创建人</TableHead>
                <TableHead>使用人</TableHead>
                <TableHead>过期时间</TableHead>
                <TableHead>创建时间</TableHead>
                <TableHead className="sticky right-0 bg-background text-right">
                  操作
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((invitation) => (
                <TableRow key={invitation.id}>
                  <TableCell>{invitation.id}</TableCell>
                  <TableCell>{invitationType(invitation.type)}</TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        invitationStatus(invitation) === '可用'
                          ? 'secondary'
                          : 'outline'
                      }
                    >
                      {invitationStatus(invitation)}
                    </Badge>
                  </TableCell>
                  <TableCell>{invitation.team?.name ?? '-'}</TableCell>
                  <TableCell>{creator(invitation)}</TableCell>
                  <TableCell>
                    {invitation.acceptedByUser?.email ?? '-'}
                  </TableCell>
                  <TableCell>{formatDate(invitation.expiresAt)}</TableCell>
                  <TableCell>{formatDate(invitation.createdAt)}</TableCell>
                  <TableCell className="sticky right-0 bg-background text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        disabled={!invitation.inviteUrl}
                        onClick={() => copyInvitation(invitation)}
                      >
                        复制
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => deleteInvitation(invitation)}
                      >
                        删除
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
    </main>
  );
}
