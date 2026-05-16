import { useState, useCallback, useEffect } from 'react'
import type { SchedulerSnapshot } from './types'
import { useConfig } from './hooks/use-config'
import { useOutputBuffer } from './hooks/use-output-buffer'
import { useSSE } from './hooks/use-sse'
import { ConfigView } from './views/config-view'
import { RunView } from './views/run-view'
import * as api from './api'

export function App() {
  const { config, loading, error, save, setConfig } = useConfig()
  const [snapshot, setSnapshot] = useState<SchedulerSnapshot | null>(null)
  const outputBuffer = useOutputBuffer()

  useSSE({
    onSnapshot: useCallback((s: SchedulerSnapshot) => setSnapshot(s), []),
    buffer: outputBuffer,
  })

  useEffect(() => {
    if (snapshot && !snapshot.currentBatch) return
    if (snapshot?.currentBatch) {
      api.fetchWorkerOutput()
        .then(res => outputBuffer.load(res.workers))
        .catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on mount + batch change
  }, [snapshot?.currentBatch?.id])

  const handleStart = useCallback(async () => {
    if (!config) return
    try {
      const saved = await save(config)
      const s = await api.startScheduler(saved)
      setSnapshot(s)
      outputBuffer.reset()
    } catch (err) {
      console.error('Start failed:', err)
    }
  }, [config, save, outputBuffer])

  const handleStop = useCallback(async () => {
    try {
      const s = await api.stopAfterCurrent()
      setSnapshot(s)
    } catch (err) {
      console.error('Stop failed:', err)
    }
  }, [])

  const isRunning = snapshot && !['idle', 'stopped', 'error'].includes(snapshot.status)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        加载中…
      </div>
    )
  }

  if (error || !config) {
    return (
      <div className="min-h-screen flex items-center justify-center text-destructive">
        {error ?? '无法加载配置'}
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6">
      <header className="mb-6 flex items-center gap-3">
        <h1 className="text-lg font-semibold tracking-tight">auto</h1>
        {snapshot && (
          <span className="text-xs text-muted-foreground">
            {snapshot.status}
          </span>
        )}
      </header>

      {isRunning && snapshot ? (
        <RunView
          snapshot={snapshot}
          outputLines={outputBuffer.lines}
          trimmed={outputBuffer.trimmed}
          onStop={handleStop}
        />
      ) : (
        <ConfigView
          config={config}
          onChange={setConfig}
          onStart={handleStart}
        />
      )}
    </div>
  )
}
