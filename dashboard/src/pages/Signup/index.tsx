import { history } from '@umijs/max';
import { App, Card, Result } from 'antd';
import { ProForm, ProFormText } from '@ant-design/pro-components';

import { adminApi, userAuthApi } from '@/services/synapse/api';

function readInviteToken(): string {
  const query = new URLSearchParams(window.location.search);
  return (query.get('invite') ?? query.get('token'))?.trim() ?? '';
}

export default function SignupPage() {
  const { message } = App.useApp();
  const inviteToken = readInviteToken();

  if (!inviteToken) {
    return <Result status="warning" title="邀请链接无效" />;
  }

  return (
    <Card>
      <ProForm
        layout="vertical"
        submitter={{ searchConfig: { submitText: '注册' } }}
        onFinish={async (values: { email?: string; password?: string }) => {
          try {
            await userAuthApi.register({
              invitationToken: inviteToken,
              email: values.email ?? '',
              password: values.password ?? '',
            });
            try {
              await adminApi.login({ email: values.email ?? '', password: values.password ?? '' });
              history.replace('/teams');
            } catch {
              history.replace('/login');
            }
          } catch (error) {
            message.error(error instanceof Error ? error.message : '注册失败');
          }
        }}
      >
        <ProFormText
          name="email"
          label="邮箱"
          fieldProps={{ autoComplete: 'email' }}
          rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式无效' }]}
        />
        <ProFormText.Password
          name="password"
          label="密码"
          fieldProps={{ autoComplete: 'new-password' }}
          rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '密码至少 8 位' }]}
        />
      </ProForm>
    </Card>
  );
}
