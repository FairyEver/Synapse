import type { Settings as LayoutSettings } from '@ant-design/pro-components';
import type { RequestConfig, RunTimeLayoutConfig } from '@umijs/max';
import { history, Link } from '@umijs/max';
import { message } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import React from 'react';

import { AvatarDropdown, ErrorBoundary } from '@/components';
import { adminApi, adminAuthExpiredEvent } from '@/services/synapse/api';
import defaultSettings from '../config/defaultSettings';
import { errorConfig } from './requestErrorConfig';

dayjs.extend(relativeTime);

const loginPath = '/login';
const publicPaths = new Set([loginPath, '/signup', '/team-invite']);

function redirectToLogin(): void {
  const { pathname, search, hash } = history.location;
  if (publicPaths.has(pathname)) return;
  history.replace(`${loginPath}?redirect=${encodeURIComponent(pathname + search + hash)}`);
}

function AuthEvents({
  children,
  onExpired,
}: {
  readonly children: React.ReactNode;
  readonly onExpired: () => void;
}) {
  React.useEffect(() => {
    window.addEventListener(adminAuthExpiredEvent, onExpired);
    return () => window.removeEventListener(adminAuthExpiredEvent, onExpired);
  }, [onExpired]);

  return children;
}

export async function getInitialState(): Promise<{
  settings?: Partial<LayoutSettings>;
  currentUser?: API.CurrentUser;
  fetchUserInfo?: () => Promise<API.CurrentUser | undefined>;
}> {
  const fetchUserInfo = async () => {
    try {
      return await adminApi.getSession({ skipErrorHandler: true });
    } catch {
      redirectToLogin();
      return undefined;
    }
  };

  if (publicPaths.has(history.location.pathname)) {
    return {
      fetchUserInfo,
      settings: defaultSettings as Partial<LayoutSettings>,
    };
  }

  return {
    fetchUserInfo,
    currentUser: await fetchUserInfo(),
    settings: defaultSettings as Partial<LayoutSettings>,
  };
}

export const layout: RunTimeLayoutConfig = ({ initialState, setInitialState }) => ({
  menuItemRender: (item, dom) => {
    if (!item.path) return dom;
    return (
      <Link to={item.path} prefetch>
        {dom}
      </Link>
    );
  },
  avatarProps: {
    title: initialState?.currentUser?.name ?? initialState?.currentUser?.email,
    render: (_, avatarChildren) => (
      <AvatarDropdown
        onLoggedOut={() => {
          setInitialState((state) => ({ ...state, currentUser: undefined }));
          history.replace(loginPath);
        }}
      >
        {avatarChildren}
      </AvatarDropdown>
    ),
  },
  footerRender: false,
  onPageChange: () => {
    if (!initialState?.currentUser) redirectToLogin();
  },
  ErrorBoundary,
  menuHeaderRender: undefined,
  actionsRender: false,
  childrenRender: (children) => {
    return (
      <AuthEvents
        onExpired={() => {
          message.warning('登录已过期');
          setInitialState((state) => ({ ...state, currentUser: undefined }));
          redirectToLogin();
        }}
      >
        {children}
      </AuthEvents>
    );
  },
  ...initialState?.settings,
});

export const request: RequestConfig = {
  baseURL: '',
  ...errorConfig,
};

export function rootContainer(container: React.ReactNode) {
  return <ErrorBoundary>{container}</ErrorBoundary>;
}
