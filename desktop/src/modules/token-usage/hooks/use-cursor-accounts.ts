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
  login: () => Promise<{ success: boolean; error?: string }>
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

  const login = useCallback(async () => {
    const bridge = requireSynapseBridge().tokenUsage
    const loginResult = await bridge.cursorLogin()
    if (loginResult.cancelled || !loginResult.sessionToken) {
      return { success: false }
    }
    const validation = await bridge.cursorValidate({ sessionToken: loginResult.sessionToken })
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }
    const addResult = await bridge.cursorAddAccount({
      sessionToken: loginResult.sessionToken,
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

  return { accounts, loading, syncing, refresh, login, remove, setActive, sync }
}
