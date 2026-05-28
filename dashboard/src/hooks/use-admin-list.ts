import { useCallback, useEffect, useRef, useState } from 'react';

import type { PaginatedResponse } from '@/lib/api';

export function useAdminList<T>(
  loader: (options: {
    page: number;
    pageSize: number;
  }) => Promise<PaginatedResponse<T>>,
  pageSize = 20,
) {
  const [rows, setRows] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const isMountedRef = useRef(true);
  const latestRequestId = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setIsLoading(true);
    setError('');

    try {
      const result = await loader({ page, pageSize });
      if (!isMountedRef.current) return;
      if (requestId !== latestRequestId.current) return;
      setRows(result.data);
      setTotal(result.total);
    } catch (nextError) {
      if (!isMountedRef.current) return;
      if (requestId !== latestRequestId.current) return;
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      if (isMountedRef.current && requestId === latestRequestId.current) {
        setIsLoading(false);
      }
    }
  }, [loader, page, pageSize]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    error,
    isLoading,
    page,
    pageSize,
    refresh,
    rows,
    setPage,
    total,
  };
}
