import { useCallback, useEffect, useState, type DependencyList } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import type { ReportState } from "./types"

const logger = createRendererLogger("usage-analysis.report-loader")

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
    } catch (err) {
      logger.error("Usage analysis report load failed.", { error: err })
      setError(toReportLoadError(err))
    } finally {
      setLoading(false)
    }
  }, dependencies)

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}

function toReportLoadError(err: unknown): Error {
  if (err instanceof Error && err.message.trim()) return err
  return new Error("读取失败")
}
