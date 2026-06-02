import { useCallback, useEffect, useRef, useState, type DependencyList } from "react"
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
  const requestIdRef = useRef(0)

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1
    requestIdRef.current = requestId
    setLoading(true)
    try {
      const next = await loader()
      if (requestIdRef.current !== requestId) return
      setData(next)
      setError(null)
    } catch (err) {
      if (requestIdRef.current !== requestId) return
      logger.error("Usage analysis report load failed.", { error: err })
      setError(toReportLoadError(err))
    } finally {
      if (requestIdRef.current !== requestId) return
      setLoading(false)
    }
  }, dependencies)

  useEffect(() => {
    void reload()
    return () => {
      requestIdRef.current += 1
    }
  }, [reload])

  return { data, loading, error, reload }
}

function toReportLoadError(err: unknown): Error {
  if (err instanceof Error && err.message.trim()) return err
  return new Error("读取失败")
}
