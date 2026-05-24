import { useCallback, useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { adminApi, type SystemOverview } from '@/lib/api';
import { formatCount, formatDate } from '@/lib/format';

const countRows = [
  { label: '审计日志', key: 'auditLogs' },
  { label: '用户', key: 'users' },
  { label: '团队', key: 'teams' },
  { label: '邀请', key: 'invitations' },
  { label: '团队许可', key: 'teamEntitlements' },
  { label: '访问角色', key: 'teamAccessRoles' },
  { label: '角色权限', key: 'teamAccessRolePermissions' },
  { label: '成员角色', key: 'teamMemberAccessRoles' },
] as const;

export function SystemPage() {
  const [data, setData] = useState<SystemOverview | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      setData(await adminApi.getSystemOverview());
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (isLoading) {
    return (
      <main className="min-w-0 overflow-x-hidden overflow-y-auto p-4 pt-0 text-sm text-muted-foreground">
        加载中
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-w-0 overflow-x-hidden overflow-y-auto p-4 pt-0">
        <Card>
          <CardContent className="flex items-center justify-between gap-4">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={refresh}>
              重试
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <div className="grid gap-4 md:grid-cols-4">
        {data
          ? countRows.map((row) => (
              <Card key={row.key}>
                <CardHeader>
                  <CardTitle>{row.label}</CardTitle>
                </CardHeader>
                <CardContent className="text-2xl font-semibold">
                  {formatCount(data.counts[row.key])}
                </CardContent>
              </Card>
            ))
          : null}
      </div>
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            服务器时间：{formatDate(data?.serverTime)}
          </span>
          <Button variant="outline" onClick={refresh}>
            刷新
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
