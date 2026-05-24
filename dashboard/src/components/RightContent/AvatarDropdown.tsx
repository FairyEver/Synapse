import { LogoutOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { Dropdown, Spin } from 'antd';
import React from 'react';

import { adminApi } from '@/services/synapse/api';

type AvatarDropdownProps = {
  children?: React.ReactNode;
  onLoggedOut: () => void;
};

export const AvatarDropdown: React.FC<AvatarDropdownProps> = ({ children, onLoggedOut }) => {
  const [submitting, setSubmitting] = React.useState(false);

  const onMenuClick: MenuProps['onClick'] = async ({ key }) => {
    if (key !== 'logout' || submitting) return;
    setSubmitting(true);
    try {
      await adminApi.logout();
    } finally {
      setSubmitting(false);
      onLoggedOut();
    }
  };

  const menuItems: MenuProps['items'] = [
    {
      key: 'logout',
      icon: <LogoutOutlined />,
      label: '退出登录',
    },
  ];

  if (submitting) return <Spin size="small" />;

  return (
    <Dropdown menu={{ selectedKeys: [], onClick: onMenuClick, items: menuItems }} placement="bottomRight" arrow>
      <span>{children}</span>
    </Dropdown>
  );
};
