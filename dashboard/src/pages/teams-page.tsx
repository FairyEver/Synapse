import { useCallback } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { PaginationFooter } from '@/components/pagination-footer';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { useAdminList } from '@/hooks/use-admin-list';
import { type AdminTeamRow, adminApi } from '@/lib/api';
import { formatDate, formatTeamRole } from '@/lib/format';

export function TeamsPage() {
  const loader = useCallback(
    (options: { page: number; pageSize: number }) =>
      adminApi.listTeams(options),
    [],
  );
  const { error, isLoading, page, pageSize, refresh, rows, setPage, total } =
    useAdminList(loader);

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error ? (
        <>
          <div className="flex min-w-0 flex-col gap-4">
            {rows.map((team: AdminTeamRow) => (
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
                    {team.memberships.map((membership) => (
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
                        </div>
                      </div>
                    ))}
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
    </main>
  );
}
