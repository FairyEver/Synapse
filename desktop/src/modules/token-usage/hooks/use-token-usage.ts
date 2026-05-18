import { useCallback, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseBridge } from "@/types/bridge"

type GraphResult = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getGraphResult"]>>
type ModelRow = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getModelReport"]>>[number]
type AgentRow = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getAgentReport"]>>[number]
type HourlyRow = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getHourlyReport"]>>[number]
type HourlyProfile = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getHourlyProfile"]>>
type ScanResult = Awaited<ReturnType<SynapseBridge["tokenUsage"]["scan"]>>

const logger = createRendererLogger("token-usage.hooks")

function toLoadError(error: unknown): Error {
  return new Error("读取失败")
}

function logLoadError(operation: string, error: unknown, options?: unknown): void {
  const errorName = error instanceof Error ? error.name : typeof error
  const errorLength = error instanceof Error ? error.message.length : String(error).length
  logger.error("Token usage load failed.", {
    operation,
    options,
    errorName,
    errorLength,
  })
}

export function useTokenUsageScan() {
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const scan = useCallback(async () => {
    setScanning(true)
    setError(null)
    try {
      const result = await requireSynapseBridge().tokenUsage.scan()
      return result
    } catch (e) {
      logLoadError("scan", e)
      setError(toLoadError(e))
      return null
    } finally {
      setScanning(false)
    }
  }, [])

  return { scan, scanning, error }
}

export function useGraphResult() {
  const [data, setData] = useState<GraphResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: { since?: string; until?: string }) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getGraphResult(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getGraphResult", e, options)
      setData(null)
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export type DateRange = { since?: string; until?: string }

export function useModelReport() {
  const [data, setData] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: DateRange & { groupBy?: string }) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getModelReport(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getModelReport", e, options)
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export function useDailyReport() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: DateRange) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getDailyReport(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getDailyReport", e, options)
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export function useAgentReport() {
  const [data, setData] = useState<AgentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: DateRange) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getAgentReport(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getAgentReport", e, options)
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export function useHourlyReport() {
  const [data, setData] = useState<HourlyRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: DateRange) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getHourlyReport(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getHourlyReport", e, options)
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export function useHourlyProfile() {
  const [data, setData] = useState<HourlyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (options?: DateRange) => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getHourlyProfile(options)
      setData(result)
      setError(null)
    } catch (e) {
      logLoadError("getHourlyProfile", e, options)
      setData(null)
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  return { data, loading, error, refresh }
}

export type { GraphResult, ModelRow, AgentRow, HourlyRow, HourlyProfile, ScanResult }
