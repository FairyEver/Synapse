import { useCallback, useEffect, useRef, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { runTrackedOperation } from "@/lib/ui-tracking"
import type { AutomationItem, AutomationRun } from "@/types/automation"
import { listAutomationRuns, subscribeAutomationChanges } from "./use-automation"

const logger = createRendererLogger("automation.runs")

export function useAutomationRuns(item: AutomationItem | null, onStopRun: (runId: string) => Promise<void>) {
  const [snapshot, setSnapshot] = useState<{ id?: string; runs: AutomationRun[] }>({ runs: [] })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stopErrors, setStopErrors] = useState<Record<string, string>>({})
  const [stopping, setStopping] = useState<ReadonlySet<string>>(new Set())
  const stoppingRef = useRef(new Set<string>())
  const generation = useRef(0)
  const currentId = useRef(item?.id)
  currentId.current = item?.id
  useEffect(() => () => { currentId.current = undefined; generation.current += 1 }, [])
  const id = item?.id

  const refresh = useCallback(async () => {
    if (!id) return
    const request = ++generation.current
    const isCurrent = () => generation.current === request && currentId.current === id
    setLoading(true)
    setError(null)
    try {
      const runs = await listAutomationRuns(id)
      if (isCurrent()) setSnapshot({ id, runs })
    } catch (cause) {
      if (isCurrent()) {
        logger.warn("Automation run history load failed.", { automationId: id, boundary: "renderer.automation.runs.list", errorName: cause instanceof Error ? cause.name : typeof cause })
        setError("读取历史失败")
      }
    } finally {
      if (isCurrent()) setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void refresh()
    return () => { generation.current += 1 }
  }, [item, refresh])

  useEffect(() => {
    setStopErrors({})
    setStopping(new Set())
    stoppingRef.current.clear()
    return subscribeAutomationChanges(event => {
      if (event.automationId && event.automationId !== id) return
      if (event.reason === "deleted") { generation.current += 1; setError("自动化不存在"); setLoading(false); return }
      if (event.reason.startsWith("run-")) void refresh()
    })
  }, [id, refresh])

  const stop = async (run: AutomationRun) => {
    if (!id || stoppingRef.current.has(run.id)) return
    stoppingRef.current.add(run.id)
    setStopping(new Set(stoppingRef.current))
    setStopErrors(current => { const next = { ...current }; delete next[run.id]; return next })
    try {
      await runTrackedOperation({ component: "automation", eventKey: "automation.history.stop" }, () => onStopRun(run.id))
      if (currentId.current === id) await refresh()
    } catch (cause) {
      logger.warn("Automation run stop failed.", { automationId: id, runId: run.id, boundary: "renderer.automation.runs.stop", errorName: cause instanceof Error ? cause.name : typeof cause })
      if (currentId.current === id) setStopErrors(current => ({ ...current, [run.id]: "停止失败" }))
    } finally {
      if (currentId.current === id) {
        stoppingRef.current.delete(run.id)
        setStopping(new Set(stoppingRef.current))
      }
    }
  }

  return { runs: snapshot.id === id ? snapshot.runs : [], loading, error, stopErrors, stopping, refresh, stop }
}
