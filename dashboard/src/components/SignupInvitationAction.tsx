import { CopyOutlined, PlusOutlined } from '@ant-design/icons';
import { ModalForm } from '@ant-design/pro-components';
import { App, Button, Input, Space } from 'antd';
import React from 'react';

import { adminApi } from '@/services/synapse/api';

type SignupInvitationActionProps = {
  readonly onCreated?: () => void;
};

export function SignupInvitationAction({ onCreated }: SignupInvitationActionProps) {
  const { message } = App.useApp();
  const [inviteUrl, setInviteUrl] = React.useState('');

  async function createInvitation() {
    try {
      const result = await adminApi.createSignupInvitation();
      setInviteUrl(result.inviteUrl);
      onCreated?.();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建失败');
    }
  }

  async function copyInviteUrl() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      message.success('已复制');
    } catch {
      message.error('复制失败');
    }
  }

  return (
    <ModalForm
      title="创建用户邀请"
      trigger={
        <Button type="primary" icon={<PlusOutlined />}>
          创建用户邀请
        </Button>
      }
      submitter={false}
      modalProps={{
        destroyOnHidden: true,
        afterOpenChange: (open) => {
          if (open) void createInvitation();
          else setInviteUrl('');
        },
      }}
    >
      <Space.Compact block>
        <Input value={inviteUrl} readOnly />
        <Button icon={<CopyOutlined />} disabled={!inviteUrl} onClick={() => void copyInviteUrl()}>
          复制
        </Button>
      </Space.Compact>
    </ModalForm>
  );
}
