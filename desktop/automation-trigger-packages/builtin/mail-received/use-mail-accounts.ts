import { useCallback, useEffect, useRef, useState } from "react"
import { getSynapseBridge, requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { createRendererLogger } from "../../../src/app-shell/logging"
import type { AccountSummary } from "../../../app-capabilities/mail/shared/types"

export function useMailTriggerAccounts(enabled = true) {
  const logger = createRendererLogger("automation.mail-config")
  const [setupError, setSetupError] = useState<string | null>(null)
  const request = useRef(0)
  const [accounts, setAccounts] = useState<AccountSummary[]>([])
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "unauthenticated">("loading")
  const reload = useCallback(() => {
    const token = ++request.current
    setAccounts([]); setStatus("loading")
    void (async () => {
      const api = requireBridgeDomain("mail"), scope = await api.uiScope()
      if (request.current !== token) return
      if (!scope.ownerId) { setStatus("unauthenticated"); return }
      const items: AccountSummary[] = []; let cursor: string | undefined
      do {
        const page = await api.accountList({ limit: 100, cursor }); if (request.current !== token) return
        items.push(...page.items); cursor = page.nextCursor ?? undefined
      } while (cursor)
      const current = await api.uiScope()
      if (token !== request.current || current.ownerId !== scope.ownerId || current.generation !== scope.generation) return
      setAccounts(items); setStatus("ready")
    })().catch(() => { if (request.current === token) { setAccounts([]); setStatus("error") } })
  }, [])
  useEffect(() => {
    if (!enabled) return
    reload()
    const identity = getSynapseBridge()?.account.state.onChanged(reload)
    const mail = getSynapseBridge()?.mail.onChanged(event => { if (event.ids.includes(event.accountId)) reload() })
    return () => { request.current++; identity?.(); mail?.() }
  }, [enabled, reload])
  const openAccounts = async () => {
    setSetupError(null)
    try { await requireBridgeDomain("mail").accountOpen({}) } catch (cause) { logger.warn("Mail account settings could not open.", { errorName: cause instanceof Error ? cause.name : typeof cause }); setSetupError("无法打开邮箱账号设置") }
  }
  return { accounts, status, reload, openAccounts, setupError }
}
