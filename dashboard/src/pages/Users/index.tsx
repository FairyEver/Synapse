import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { App, Button, Popconfirm, Space, Tag } from 'antd';
import React from 'react';

import { SignupInvitationAction } from '@/components/SignupInvitationAction';
import { adminApi, type AdminUserRow } from '@/services/synapse/api';
import { formatDate, formatTeamRole } from '@/utils/format';

function accessRoles(membership: AdminUserRow['memberships'][number]): string {
  return membership.accessRoles.map((item) => item.role.name).join('、') || '-';
}

export default function UsersPage() {
  const { message } = App.useApp();
  const actionRef = React.useRef<ActionType>(null);

  const columns: ProColumns<AdminUserRow>[] = [
    { title: '邮箱', dataIndex: 'email' },
    {
      title: '状态',
      dataIndex: 'status',
      render: (_, user) => <Tag color={user.status === 'active' ? 'success' : 'default'}>{user.status === 'active' ? '启用' : '停用'}</Tag>,
    },
    {
      title: '团队',
      render: (_, user) => user.memberships.map((membership) => membership.team.name).join('、') || '-',
    },
    {
      title: '身份',
      render: (_, user) => user.memberships.map((membership) => formatTeamRole(membership.role)).join('、') || '-',
    },
    {
      title: '访问角色',
      render: (_, user) => user.memberships.map(accessRoles).join('、') || '-',
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      render: (_, user) => formatDate(user.createdAt),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      render: (_, user) => formatDate(user.updatedAt),
    },
    {
      title: '操作',
      valueType: 'option',
      render: (_, user) => {
        const nextStatus = user.status === 'active' ? 'disabled' : 'active';
        return (
          <Popconfirm
            title={nextStatus === 'disabled' ? '停用用户' : '启用用户'}
            onConfirm={async () => {
              try {
                await adminApi.updateUserStatus(user.id, nextStatus);
                actionRef.current?.reload?.();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '操作失败');
              }
            }}
          >
            <Button size="small">{nextStatus === 'disabled' ? '停用' : '启用'}</Button>
          </Popconfirm>
        );
      },
    },
  ];

  return (
    <PageContainer title="用户">
      <ProTable<AdminUserRow>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        columns={columns}
        toolBarRender={() => [
          <SignupInvitationAction key="invite" onCreated={() => actionRef.current?.reload?.()} />,
        ]}
        request={async (params) => {
          const result = await adminApi.listUsers({ page: params.current, pageSize: params.pageSize });
          return { data: result.data, total: result.total, success: true };
        }}
        tableAlertRender={false}
        tableAlertOptionRender={false}
        expandable={{
          expandedRowRender: (user) => (
            <Space wrap>
              {user.memberships.map((membership) => (
                <Tag key={`${user.id}-${membership.team.id}`}>{`${membership.team.name} / ${formatTeamRole(membership.role)} / ${accessRoles(membership)}`}</Tag>
              ))}
            </Space>
          ),
        }}
      />
    </PageContainer>
  );
}
