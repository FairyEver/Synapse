import { history } from '@umijs/max';
import { App, Button, Card, Result } from 'antd';

import { userDashboardApi } from '@/services/synapse/api';

function readInviteToken(): string {
  const query = new URLSearchParams(window.location.search);
  return (query.get('token') ?? query.get('invite'))?.trim() ?? '';
}

export default function TeamInvitePage() {
  const { message } = App.useApp();
  const token = readInviteToken();

  if (!token) {
    return <Result status="warning" title="邀请链接无效" />;
  }

  async function joinTeam() {
    try {
      await userDashboardApi.joinTeam(token);
      history.replace('/teams');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加入失败');
    }
  }

  return (
    <Card>
      <Result
        title="加入团队"
        extra={
          <Button type="primary" onClick={() => void joinTeam()}>
            加入团队
          </Button>
        }
      />
    </Card>
  );
}
