import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { LoginForm, ProFormText } from '@ant-design/pro-components';
import { history, useModel } from '@umijs/max';
import { App, Card } from 'antd';
import React from 'react';

import { adminApi } from '@/services/synapse/api';

function readRedirect(): string {
  const redirect = new URLSearchParams(window.location.search).get('redirect');
  return redirect?.startsWith('/') ? redirect : '/system';
}

export default function LoginPage() {
  const { message } = App.useApp();
  const { setInitialState } = useModel('@@initialState');
  const [submitting, setSubmitting] = React.useState(false);

  async function handleSubmit(values: { email?: string; password?: string }) {
    setSubmitting(true);
    try {
      const session = await adminApi.login({
        email: values.email ?? '',
        password: values.password ?? '',
      });
      const name = session.email.split('@')[0] || session.email;
      setInitialState((state) => ({
        ...state,
        currentUser: { name, email: session.email, role: session.role },
      }));
      history.replace(readRedirect());
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main>
      <Card>
        <LoginForm title="Synapse" submitter={{ searchConfig: { submitText: '登录' }, submitButtonProps: { loading: submitting } }} onFinish={handleSubmit}>
          <ProFormText
            name="email"
            fieldProps={{ prefix: <UserOutlined />, autoComplete: 'email' }}
            placeholder="邮箱"
            rules={[{ required: true, message: '请输入邮箱' }, { type: 'email', message: '邮箱格式无效' }]}
          />
          <ProFormText.Password
            name="password"
            fieldProps={{ prefix: <LockOutlined />, autoComplete: 'current-password' }}
            placeholder="密码"
            rules={[{ required: true, message: '请输入密码' }]}
          />
        </LoginForm>
      </Card>
    </main>
  );
}
