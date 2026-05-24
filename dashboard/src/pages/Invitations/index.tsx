import { CopyOutlined, DeleteOutlined } from '@ant-design/icons';
import { PageContainer, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { App, Button, Popconfirm, Space, Tag } from 'antd';
import React from 'react';

import { SignupInvitationAction } from '@/components/SignupInvitationAction';
import { adminApi, type AdminInvitationRow } from '@/services/synapse/api';
import { formatDate } from '@/utils/format';

function formatInvitationType(type: AdminInvitationRow['type']): string {
  return type === 'team_join' ? '团队加入' : '用户注册';
}

function formatCreator(invitation: AdminInvitationRow): string {
  return invitation.createdByAdmin?.email ?? invitation.createdByUser?.email ?? '-';
}

function invitationStatus(invitation: AdminInvitationRow): string {
  if (invitation.usedAt) return '已使用';
  if (new Date(invitation.expiresAt).getTime() <= Date.now()) return '已过期';
  return '可用';
}

export default function InvitationsPage() {
  const { message } = App.useApp();
  const actionRef = React.useRef<ActionType>(null);
  const [selectedIds, setSelectedIds] = React.useState<React.Key[]>([]);

  const columns: ProColumns<AdminInvitationRow>[] = [
    { title: '邀请 ID', dataIndex: 'id', ellipsis: true },
    { title: '类型', render: (_, invitation) => formatInvitationType(invitation.type) },
    {
      title: '状态',
      render: (_, invitation) => {
        const status = invitationStatus(invitation);
        return <Tag color={status === '可用' ? 'success' : 'default'}>{status}</Tag>;
      },
    },
    { title: '关联团队', render: (_, invitation) => invitation.team?.name ?? '-' },
    { title: '创建人', render: (_, invitation) => formatCreator(invitation) },
    { title: '使用人', render: (_, invitation) => invitation.acceptedByUser?.email ?? '-' },
    { title: '使用时间', render: (_, invitation) => formatDate(invitation.usedAt) },
    { title: '过期时间', render: (_, invitation) => formatDate(invitation.expiresAt) },
    { title: '创建时间', render: (_, invitation) => formatDate(invitation.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      render: (_, invitation) => (
        <Space>
          <Button
            size="small"
            icon={<CopyOutlined />}
            disabled={!invitation.inviteUrl}
            onClick={async () => {
              if (!invitation.inviteUrl) return;
              try {
                await navigator.clipboard.writeText(invitation.inviteUrl);
                message.success('已复制');
              } catch {
                message.error('复制失败');
              }
            }}
          >
            复制
          </Button>
          <Popconfirm
            title="删除邀请"
            onConfirm={async () => {
              try {
                await adminApi.deleteInvitation(invitation.id);
                actionRef.current?.reload?.();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '删除失败');
              }
            }}
          >
            <Button size="small" danger icon={<DeleteOutlined />}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <PageContainer title="邀请">
      <ProTable<AdminInvitationRow>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        columns={columns}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: setSelectedIds }}
        toolBarRender={() => [
          <SignupInvitationAction key="invite" onCreated={() => actionRef.current?.reload?.()} />,
          <Popconfirm
            key="delete"
            title={`删除所选 ${selectedIds.length} 个邀请`}
            disabled={selectedIds.length === 0}
            onConfirm={async () => {
              try {
                await adminApi.deleteInvitations(selectedIds.map(String));
                setSelectedIds([]);
                actionRef.current?.reload?.();
              } catch (error) {
                message.error(error instanceof Error ? error.message : '删除失败');
              }
            }}
          >
            <Button danger disabled={selectedIds.length === 0} icon={<DeleteOutlined />}>
              删除所选
            </Button>
          </Popconfirm>,
        ]}
        request={async (params) => {
          const result = await adminApi.listInvitations({ page: params.current, pageSize: params.pageSize });
          return { data: result.data, total: result.total, success: true };
        }}
      />
    </PageContainer>
  );
}
