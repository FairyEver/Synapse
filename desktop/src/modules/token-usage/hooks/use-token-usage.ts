import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseBridge } from "@/types/bridge"

type GraphResult = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getGraphResult"]>>
type ModelRow = Awaited<ReturnType<SynapseBridge["tokenUsage"]["getModelReport"]>>[number]
type ScanResult = Awaited<ReturnType<SynapseBridge["tokenUsage"]["scan"]>>

function toLoadError(error: unknown): Error {
  return error instanceof Error ? error : new Error("读取失败")
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
      setData(null)
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useModelReport() {
  const [data, setData] = useState<ModelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getModelReport()
      setData(result)
      setError(null)
    } catch (e) {
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useDailyReport() {
  const [data, setData] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getDailyReport()
      setData(result)
      setError(null)
    } catch (e) {
      setData([])
      setError(toLoadError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useDetectedAgents() {
  const [agents, setAgents] = useState<{ id: string; name: string; fileCount: number }[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.getDetectedAgents()
      setAgents(result)
    } catch {
      setAgents([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { agents, loading, refresh }
}

export type { GraphResult, ModelRow, ScanResult }
