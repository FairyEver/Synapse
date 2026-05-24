import { CopyOutlined, LogoutOutlined, UserDeleteOutlined } from '@ant-design/icons';
import { ModalForm, PageContainer, ProCard, ProFormText, ProTable, type ProColumns } from '@ant-design/pro-components';
import { App, Button, Input, Popconfirm, Space, Tag } from 'antd';
import React from 'react';

import { userDashboardApi, type MyTeam, type TeamMember, type UserMe } from '@/services/synapse/api';
import { formatDate, formatTeamRole } from '@/utils/format';

type UserTeamPageData = {
  readonly membership: MyTeam | null;
  readonly me: UserMe;
};

export default function UserTeamPage() {
  const { message } = App.useApp();
  const [data, setData] = React.useState<UserTeamPageData | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [inviteUrl, setInviteUrl] = React.useState('');

  async function loadData() {
    setLoading(true);
    try {
      const [membership, me] = await Promise.all([userDashboardApi.getMyTeam(), userDashboardApi.getMe()]);
      setData({ membership, me });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    void loadData();
  }, []);

  const membership = data?.membership ?? null;
  const currentTeam = membership ? data?.me.teams.find((team) => team.membershipId === membership.id) : null;
  const effectivePermissions = currentTeam?.effectivePermissions ?? [];
  const canCreateInvitation = effectivePermissions.includes('team.invitation.manage');
  const canManageMembers = effectivePermissions.includes('team.member.manage');

  const columns: ProColumns<TeamMember>[] = [
    { title: '邮箱', render: (_, member) => member.user.email },
    {
      title: '角色',
      render: (_, member) => (
        <Space wrap>
          <Tag>{formatTeamRole(member.role)}</Tag>
          {member.accessRoles.map((item) => <Tag key={item.role.id}>{item.role.name}</Tag>)}
        </Space>
      ),
    },
    { title: '加入时间', render: (_, member) => formatDate(member.createdAt) },
    {
      title: '操作',
      valueType: 'option',
      hideInTable: !canManageMembers,
      render: (_, member) => member.role === 'member' && member.userId !== membership?.userId ? (
        <Popconfirm
          title="移除成员"
          onConfirm={async () => {
            try {
              await userDashboardApi.removeMember(member.userId);
              await loadData();
            } catch (error) {
              message.error(error instanceof Error ? error.message : '移除失败');
            }
          }}
        >
          <Button size="small" icon={<UserDeleteOutlined />}>
            移除
          </Button>
        </Popconfirm>
      ) : null,
    },
  ];

  if (!membership) {
    return (
      <PageContainer title="团队">
        <ProCard loading={loading}>
          <ModalForm
            title="创建团队"
            trigger={<Button type="primary">创建团队</Button>}
            onFinish={async (values: { name?: string }) => {
              try {
                await userDashboardApi.createTeam({ name: values.name ?? '' });
                await loadData();
                return true;
              } catch (error) {
                message.error(error instanceof Error ? error.message : '创建失败');
                return false;
              }
            }}
          >
            <ProFormText name="name" label="团队名称" rules={[{ required: true, message: '请输入团队名称' }]} />
          </ModalForm>
        </ProCard>
      </PageContainer>
    );
  }

  return (
    <PageContainer
      title={membership.team.name}
      extra={[
        canCreateInvitation ? (
          <Button
            key="invite"
            type="primary"
            onClick={async () => {
              try {
                const invitation = await userDashboardApi.createInvitation();
                setInviteUrl(invitation.inviteUrl);
                await navigator.clipboard.writeText(invitation.inviteUrl);
                message.success('已复制');
              } catch (error) {
                message.error(error instanceof Error ? error.message : '创建失败');
              }
            }}
          >
            创建团队邀请
          </Button>
        ) : null,
        <Popconfirm
          key="leave"
          title={membership.role === 'owner' ? '退出后团队将被解散' : '退出团队'}
          onConfirm={async () => {
            try {
              await userDashboardApi.leaveTeam();
              await loadData();
            } catch (error) {
              message.error(error instanceof Error ? error.message : '退出失败');
            }
          }}
        >
          <Button icon={<LogoutOutlined />}>退出团队</Button>
        </Popconfirm>,
      ]}
    >
      <Space direction="vertical" size="large">
        <Space wrap>
          <Tag>{formatTeamRole(membership.role)}</Tag>
          {currentTeam?.roles.map((role) => <Tag key={role.id}>{role.name}</Tag>)}
          {effectivePermissions.map((permission) => <Tag key={permission}>{permission}</Tag>)}
        </Space>
        {inviteUrl ? (
          <Space.Compact block>
            <Input value={inviteUrl} readOnly />
            <Button icon={<CopyOutlined />} onClick={() => void navigator.clipboard.writeText(inviteUrl)}>
              复制
            </Button>
          </Space.Compact>
        ) : null}
        <ProTable<TeamMember>
          rowKey="id"
          loading={loading}
          search={false}
          pagination={false}
          columns={columns}
          dataSource={membership.team.memberships}
        />
      </Space>
    </PageContainer>
  );
}
