import { PageContainer, ProCard, ProDescriptions } from '@ant-design/pro-components';
import { Button, Result, Spin } from 'antd';
import React from 'react';

import { adminApi, type SystemOverview } from '@/services/synapse/api';
import { formatCount, formatDate } from '@/utils/format';

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

export default function SystemPage() {
  const [data, setData] = React.useState<SystemOverview | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState(true);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setData(await adminApi.getSystemOverview());
    } catch (caught) {
      setError(caught instanceof Error ? caught : new Error('加载失败'));
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void refresh();
  }, []);

  if (loading) return <Spin />;
  if (error) return <Result status="error" title={error.message} />;
  if (!data) return <Result title="暂无数据" />;

  return (
    <PageContainer title="系统">
      <ProCard>
        <ProDescriptions
          column={2}
          dataSource={data}
          columns={[
            ...countRows.map((row) => ({
              title: row.label,
              render: () => formatCount(data.counts[row.key]),
            })),
            {
              title: '服务器时间',
              render: () => formatDate(data.serverTime),
            },
          ]}
        />
        <Button onClick={refresh}>刷新</Button>
      </ProCard>
    </PageContainer>
  );
}
