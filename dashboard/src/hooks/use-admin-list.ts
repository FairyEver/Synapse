import { useCallback, useEffect, useState } from 'react';

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

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError('');

    try {
      const result = await loader({ page, pageSize });
      setRows(result.data);
      setTotal(result.total);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '加载失败');
    } finally {
      setIsLoading(false);
    }
  }, [loader, page, pageSize]);

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
