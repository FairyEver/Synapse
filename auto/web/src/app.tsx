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
  const [showConfig, setShowConfig] = useState(true)
  const outputBuffer = useOutputBuffer()

  useSSE({
    onSnapshot: useCallback((s: SchedulerSnapshot) => {
      setSnapshot(s)
      if (!['idle', 'stopped', 'error'].includes(s.status)) {
        setShowConfig(false)
      }
    }, []),
    buffer: outputBuffer,
  })

  useEffect(() => {
    if (!snapshot?.session) return
    api.fetchWorkerOutput()
      .then(res => outputBuffer.load(res.workers))
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on session change
  }, [snapshot?.session?.id])

  const handleSave = useCallback(async () => {
    if (!config) return
    await save(config)
  }, [config, save])

  const handleStart = useCallback(async () => {
    if (!config) return
    try {
      const saved = await save(config)
      const s = await api.startScheduler(saved)
      setSnapshot(s)
      setShowConfig(false)
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

  const isRunning = snapshot && ['running', 'draining'].includes(snapshot.status)
  const hasResults = snapshot && snapshot.session
  const showRunView = !showConfig && (isRunning || hasResults)

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
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-6 py-3 flex items-center gap-2">
        <h1 className="text-sm font-bold tracking-tight uppercase text-foreground/80">auto</h1>
        <div className="h-3 w-px bg-border" />
        <span className="text-xs text-muted-foreground">
          {snapshot ? snapshot.status : 'idle'}
        </span>
      </header>

      <main className="flex-1 px-6 py-6">
        {showRunView && snapshot ? (
          <RunView
            snapshot={snapshot}
            outputLines={outputBuffer.lines}
            trimmed={outputBuffer.trimmed}
            onStop={handleStop}
            onBack={() => setShowConfig(true)}
          />
        ) : (
          <ConfigView
            config={config}
            onChange={setConfig}
            onSave={handleSave}
            onStart={handleStart}
          />
        )}
      </main>
    </div>
  )
}
