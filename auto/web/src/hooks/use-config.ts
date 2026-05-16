import { useCallback, useEffect, useState } from 'react'
import type { UiConfig } from '../types'
import { fetchConfig, saveConfig as apiSaveConfig } from '../api'

export function useConfig() {
  const [config, setConfig] = useState<UiConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchConfig()
      .then(setConfig)
      .catch(err => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [])

  const save = useCallback(async (next: UiConfig) => {
    try {
      const saved = await apiSaveConfig(next)
      setConfig(saved)
      return saved
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    }
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = await fetchConfig()
      setConfig(loaded)
      return loaded
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  return { config, loading, error, save, reload, setConfig }
}
