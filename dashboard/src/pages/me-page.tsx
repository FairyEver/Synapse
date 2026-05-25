import { useCallback } from 'react';

import { EmptyState, ErrorState, LoadingState } from '@/components/page-state';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useAdminList } from '@/hooks/use-admin-list';
import { dashboardApi, type DashboardMe } from '@/lib/api';
import { formatTeamRole } from '@/lib/format';

export function MePage() {
  const loader = useCallback(async () => {
    const profile = await dashboardApi.getMe();
    return {
      data: [profile],
      total: 1,
      page: 1,
      pageSize: 1,
    };
  }, []);
  const { error, isLoading, refresh, rows } = useAdminList<DashboardMe>(
    loader,
    1,
  );
  const profile = rows[0];

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      {isLoading ? <LoadingState /> : null}
      {error ? <ErrorState message={error} onRetry={refresh} /> : null}
      {!isLoading && !error && profile ? (
        <>
          <section className="grid gap-2">
            <h2 className="text-base font-medium">账号</h2>
            <div className="text-sm">{profile.user.email}</div>
          </section>
          <section className="grid gap-2">
            <h2 className="text-base font-medium">团队</h2>
            {profile.teams.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>名称</TableHead>
                    <TableHead>身份</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {profile.teams.map((team) => (
                    <TableRow key={team.id}>
                      <TableCell>{team.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {formatTeamRole(team.membershipRole)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState />
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
