import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

interface CursorAccount {
  id: string
  label?: string
  userId?: string
  active: boolean
  createdAt: string
  lastSyncAt?: string
}

interface UseCursorAccountsReturn {
  accounts: CursorAccount[]
  loading: boolean
  syncing: boolean
  refresh: () => Promise<void>
  addWithToken: (token: string) => Promise<{ success: boolean; error?: string }>
  remove: (accountId: string) => Promise<void>
  setActive: (accountId: string) => Promise<void>
  sync: () => Promise<{ synced: boolean; rows: number; error?: string }>
}

export function useCursorAccounts(): UseCursorAccountsReturn {
  const [accounts, setAccounts] = useState<CursorAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await requireSynapseBridge().tokenUsage.cursorListAccounts()
      setAccounts(result)
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const addWithToken = useCallback(async (sessionToken: string) => {
    const bridge = requireSynapseBridge().tokenUsage
    const validation = await bridge.cursorValidate({ sessionToken })
    if (!validation.valid) {
      return { success: false, error: validation.error || "Token 无效或已过期" }
    }
    const addResult = await bridge.cursorAddAccount({
      sessionToken,
      label: validation.membershipType,
    })
    if (addResult.error) {
      return { success: false, error: addResult.error }
    }
    await refresh()
    return { success: true }
  }, [refresh])

  const remove = useCallback(async (accountId: string) => {
    await requireSynapseBridge().tokenUsage.cursorRemoveAccount({ accountId })
    await refresh()
  }, [refresh])

  const setActive = useCallback(async (accountId: string) => {
    await requireSynapseBridge().tokenUsage.cursorSetActive({ accountId })
    await refresh()
  }, [refresh])

  const sync = useCallback(async () => {
    setSyncing(true)
    try {
      const result = await requireSynapseBridge().tokenUsage.cursorSync()
      await refresh()
      return result
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  return { accounts, loading, syncing, refresh, addWithToken, remove, setActive, sync }
}
