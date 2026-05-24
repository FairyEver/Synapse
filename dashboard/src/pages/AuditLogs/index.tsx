import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { App, Button, DatePicker, Modal, Select, Space } from 'antd';
import React from 'react';

import { adminApi, type AuditLog } from '@/services/synapse/api';
import { formatDate } from '@/utils/format';

const actionOptions = [
  'admin.login.success',
  'admin.auth.verify.failed',
  'dashboard.login.failure',
  'admin.invitation.create',
  'admin.invitation.delete',
  'admin.audit_logs.export',
  'admin.logout',
  'admin.user.status_update',
  'admin.team_permissions.update',
  'user.register.success',
  'user.dashboard_login.success',
  'team.create',
  'team.invitation.create',
  'team.join',
  'backup.post',
  'logs.download',
].map((value) => ({ label: value, value }));

export default function AuditLogsPage() {
  const { message } = App.useApp();
  const actionRef = React.useRef<ActionType>(null);
  const [action, setAction] = React.useState<string>();
  const [from, setFrom] = React.useState<string>();
  const [to, setTo] = React.useState<string>();

  const columns: ProColumns<AuditLog>[] = [
    { title: '时间', render: (_, log) => formatDate(log.createdAt) },
    { title: '操作者', dataIndex: 'adminEmail' },
    { title: '操作', dataIndex: 'action', ellipsis: true },
    { title: '目标类型', dataIndex: 'targetType' },
    { title: '目标 ID', dataIndex: 'targetId', ellipsis: true },
    { title: 'IP', dataIndex: 'ipAddress' },
    {
      title: '详情',
      valueType: 'option',
      render: (_, log) => (
        <Button
          size="small"
          onClick={() => {
            Modal.info({
              title: log.action,
              content: <pre>{JSON.stringify(log.detail, null, 2)}</pre>,
              width: 720,
            });
          }}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <PageContainer title="审计日志">
      <ProTable<AuditLog>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        columns={columns}
        toolBarRender={() => [
          <Space key="filters">
            <Select
              allowClear
              value={action}
              options={actionOptions}
              placeholder="操作"
              onChange={(value) => {
                setAction(value);
                actionRef.current?.reload?.();
              }}
            />
            <DatePicker
              value={undefined}
              placeholder="开始日期"
              onChange={(_, value) => {
                setFrom(typeof value === 'string' ? value : undefined);
                actionRef.current?.reload?.();
              }}
            />
            <DatePicker
              value={undefined}
              placeholder="结束日期"
              onChange={(_, value) => {
                setTo(typeof value === 'string' ? value : undefined);
                actionRef.current?.reload?.();
              }}
            />
            <Button
              onClick={async () => {
                try {
                  await adminApi.exportAuditLogs({ action, from, to });
                } catch (error) {
                  message.error(error instanceof Error ? error.message : '导出失败');
                }
              }}
            >
              导出 CSV
            </Button>
          </Space>,
        ]}
        request={async (params) => {
          const result = await adminApi.listAuditLogs({
            action,
            from,
            to,
            page: params.current,
            pageSize: params.pageSize,
          });
          return { data: result.data, total: result.total, success: true };
        }}
      />
    </PageContainer>
  );
}
