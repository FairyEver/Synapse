import { useCallback, useEffect, useState } from 'react'
import type { DriveBrowserSurface, DriveUsageDto } from '@synapse/shared'
import { useDriveBrowser, type DriveBrowserState } from '@/features/drive-browser/use-drive-browser'
import { driveApi } from '@/lib/api'

export type DriveConsoleInput =
  | { readonly context: 'root' }
  | { readonly context: 'item'; readonly itemId: string; readonly surface: DriveBrowserSurface }

export type DriveConsoleState = {
  readonly browser: DriveBrowserState
  readonly usage: DriveUsageDto | null
  readonly usageLoading: boolean
  readonly usageError: string | null
  readonly refresh: () => Promise<void>
}

export function useDriveConsole(input: DriveConsoleInput): DriveConsoleState {
  const browser = useDriveBrowser(
    input.context === 'root'
      ? { context: 'console-root' }
      : { context: 'owner', itemId: input.itemId, surface: input.surface }
  )
  const [usage, setUsage] = useState<DriveUsageDto | null>(null)
  const [usageLoading, setUsageLoading] = useState(false)
  const [usageError, setUsageError] = useState<string | null>(null)

  const loadUsage = useCallback(async () => {
    setUsageLoading(true)
    setUsageError(null)
    try {
      setUsage(await driveApi.getUsage())
    } catch (error) {
      setUsageError(error instanceof Error ? error.message : '用量加载失败')
    } finally {
      setUsageLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadUsage()
  }, [loadUsage])

  const refresh = useCallback(async () => {
    await Promise.all([
      browser.status === 'ready' ? browser.reload() : Promise.resolve(),
      loadUsage(),
    ])
  }, [browser, loadUsage])

  return { browser, usage, usageLoading, usageError, refresh }
}
