import { useCallback, useEffect, useState, type DependencyList } from "react"
import type { ReportState } from "./types"

export function useReportLoader<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
): ReportState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const next = await loader()
      setData(next)
      setError(null)
    } catch {
      setError(new Error("读取失败"))
    } finally {
      setLoading(false)
    }
  }, dependencies)

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}
