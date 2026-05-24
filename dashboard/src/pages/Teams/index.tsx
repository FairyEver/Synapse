import { EditOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { ModalForm, PageContainer, ProFormCheckbox, ProTable, type ActionType, type ProColumns } from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { App, Button, Space, Tag } from 'antd';
import React from 'react';

import {
  adminApi,
  type AdminTeamRow,
  type TeamAccessRoleRow,
} from '@/services/synapse/api';
import { formatDate, formatTeamRole } from '@/utils/format';
import UserTeamPage from '@/pages/UserTeam';

type EditingMemberRoles = {
  readonly team: AdminTeamRow;
  readonly membership: AdminTeamRow['memberships'][number];
};

export default function TeamsPage() {
  const { message } = App.useApp();
  const { initialState } = useModel('@@initialState');
  const actionRef = React.useRef<ActionType>(null);
  const [editing, setEditing] = React.useState<EditingMemberRoles | null>(null);
  const [roleOptions, setRoleOptions] = React.useState<TeamAccessRoleRow[]>([]);
  const [roleIds, setRoleIds] = React.useState<string[]>([]);

  const columns: ProColumns<AdminTeamRow>[] = [
    { title: '名称', dataIndex: 'name' },
    { title: '所有者', render: (_, team) => team.createdByUser.email },
    {
      title: '成员',
      render: (_, team) => (
        <Space direction="vertical">
          {team.memberships.map((membership) => (
            <Space key={membership.id} wrap>
              <span>{membership.user.email}</span>
              <Tag>{formatTeamRole(membership.role)}</Tag>
              {membership.accessRoles.map((item) => <Tag key={item.role.id}>{item.role.name}</Tag>)}
              <Button size="small" icon={<EditOutlined />} onClick={() => setEditing({ team, membership })}>
                角色
              </Button>
            </Space>
          ))}
        </Space>
      ),
    },
    { title: '创建时间', dataIndex: 'createdAt', render: (_, team) => formatDate(team.createdAt) },
    { title: '更新时间', dataIndex: 'updatedAt', render: (_, team) => formatDate(team.updatedAt) },
    {
      title: '操作',
      valueType: 'option',
      render: (_, team) => (
        <Button
          size="small"
          icon={<SafetyCertificateOutlined />}
          onClick={() => history.push(`/teams/${encodeURIComponent(team.id)}/permissions?name=${encodeURIComponent(team.name)}`)}
        >
          权限
        </Button>
      ),
    },
  ];

  React.useEffect(() => {
    if (!editing) return;
    let alive = true;
    Promise.all([
      adminApi.listTeamAccessRoles(editing.team.id),
      adminApi.listMemberAccessRoles(editing.team.id, editing.membership.id),
    ])
      .then(([roles, current]) => {
        if (!alive) return;
        setRoleOptions(roles);
        setRoleIds(current.roles.map((role) => role.id));
      })
      .catch((error) => message.error(error instanceof Error ? error.message : '加载失败'));
    return () => {
      alive = false;
    };
  }, [editing]);

  if (initialState?.currentUser?.role === 'user') {
    return <UserTeamPage />;
  }

  return (
    <PageContainer title="团队">
      <ProTable<AdminTeamRow>
        rowKey="id"
        actionRef={actionRef}
        search={false}
        columns={columns}
        request={async (params) => {
          const result = await adminApi.listTeams({ page: params.current, pageSize: params.pageSize });
          return { data: result.data, total: result.total, success: true };
        }}
        tableAlertRender={false}
        tableAlertOptionRender={false}
      />
      <ModalForm
        title={editing?.membership.user.email ?? '成员角色'}
        open={Boolean(editing)}
        modalProps={{ destroyOnHidden: true, onCancel: () => setEditing(null) }}
        initialValues={{ roleIds }}
        onFinish={async (values: { roleIds?: string[] }) => {
          if (!editing) return true;
          try {
            await adminApi.replaceMemberAccessRoles(editing.team.id, editing.membership.id, values.roleIds ?? []);
            message.success('已保存');
            setEditing(null);
            actionRef.current?.reload?.();
            return true;
          } catch (error) {
            message.error(error instanceof Error ? error.message : '保存失败');
            return false;
          }
        }}
      >
        <ProFormCheckbox.Group
          name="roleIds"
          options={roleOptions.map((role) => ({
            label: role.description ? `${role.name}：${role.description}` : role.name,
            value: role.id,
          }))}
        />
      </ModalForm>
    </PageContainer>
  );
}
