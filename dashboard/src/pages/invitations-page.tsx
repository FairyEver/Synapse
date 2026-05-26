import { useCallback, useState } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  return type === 'team_join' ? '团队加入' : '-';
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

async function writeClipboardText(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.readOnly = true;
    textarea.className = 'fixed -left-full top-0 opacity-0';
    document.body.append(textarea);
    textarea.select();
    try {
      return document.execCommand('copy');
    } finally {
      textarea.remove();
    }
  }
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
  const [manualCopyUrl, setManualCopyUrl] = useState('');
  const [deletingIds, setDeletingIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  async function copyInvitation(invitation: AdminInvitationRow) {
    if (!invitation.inviteUrl) return;
    setManualCopyUrl('');
    if (await writeClipboardText(invitation.inviteUrl)) {
      setFeedback('邀请链接已复制');
      return;
    }
    setFeedback('复制失败');
    setManualCopyUrl(invitation.inviteUrl);
  }

  async function deleteInvitation(invitation: AdminInvitationRow) {
    if (deletingIds.has(invitation.id)) return;
    setFeedback('');
    setDeletingIds((current) => new Set(current).add(invitation.id));
    try {
      await adminApi.deleteInvitation(invitation.id);
      if (rows.length === 1 && page > 1) {
        setPage(page - 1);
      } else {
        await refresh();
      }
    } catch (nextError) {
      setFeedback(nextError instanceof Error ? nextError.message : '删除失败');
    } finally {
      setDeletingIds((current) => {
        const next = new Set(current);
        next.delete(invitation.id);
        return next;
      });
    }
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pt-0">
      {feedback ? <p className="text-sm text-muted-foreground">{feedback}</p> : null}
      {manualCopyUrl ? (
        <Input aria-label="邀请链接" readOnly value={manualCopyUrl} />
      ) : null}
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
                        disabled={deletingIds.has(invitation.id)}
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
