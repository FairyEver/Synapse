import type { RequestConfig } from '@umijs/max';
import { message } from 'antd';

import { adminAuthExpiredEvent, readErrorMessage } from '@/services/synapse/api';

export const errorConfig: RequestConfig = {
  errorConfig: {
    errorHandler: (error: any, opts: any) => {
      if (opts?.skipErrorHandler) throw error;
      const status = error?.response?.status;
      if (status === 401 || status === 403) {
        window.dispatchEvent(new CustomEvent(adminAuthExpiredEvent));
        return;
      }
      message.error(readErrorMessage(error?.data ?? error?.response?.data));
    },
  },
  requestInterceptors: [
    (config: any) => ({
      ...config,
      credentials: 'include',
      headers: {
        ...config.headers,
        'Content-Type': 'application/json',
      },
    }),
  ],
};
