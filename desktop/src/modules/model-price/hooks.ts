import { useCallback, useEffect, useRef, useState, type DependencyList } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type {
  ModelPriceCoverageInput,
  ModelPriceCoverageRow,
  ModelPricePresetSummary,
  ModelPriceRule,
  ModelPriceState,
} from "./types"

const logger = createRendererLogger("model-price")

export function useModelPriceCoverage(input: ModelPriceCoverageInput, refreshKey: number): ModelPriceState<ModelPriceCoverageRow[]> {
  return useModelPriceLoader(
    () => requireSynapseBridge().modelPrice.usedModel.list(input),
    [input.source, input.range, input.limit, refreshKey],
  )
}

export function useModelPriceRules(refreshKey: number): ModelPriceState<ModelPriceRule[]> {
  return useModelPriceLoader(
    () => requireSynapseBridge().modelPrice.rule.list(),
    [refreshKey],
  )
}

export function useModelPricePresets(refreshKey = 0): ModelPriceState<ModelPricePresetSummary[]> {
  return useModelPriceLoader(
    () => requireSynapseBridge().modelPrice.preset.list(),
    [refreshKey],
  )
}

function useModelPriceLoader<T>(
  loader: () => Promise<T>,
  dependencies: DependencyList,
): ModelPriceState<T> {
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
      logger.error("Model price load failed.", { error: err })
      setError(toLoadError(err))
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

function toLoadError(err: unknown): Error {
  if (err instanceof Error && err.message.trim()) return err
  return new Error("读取失败")
}
