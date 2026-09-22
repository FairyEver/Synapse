import { useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import { requireBridgeDomain } from "../../../../src/lib/electron-bridge"
import type { ConnectorItem } from "../../shared/schema"

export function useConnectors() {
  const bridge = useMemo(() => requireBridgeDomain("connectors"), [])
  const [items, setItems] = useState<ConnectorItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const reload = useCallback(async () => {
    try { setItems((await bridge.item.list()).items) }
    catch { toast.error("加载连接器失败") }
    finally { setLoading(false) }
  }, [bridge])
  useEffect(() => {
    void reload()
    return bridge.item.onChanged((event) => setItems(event.items))
  }, [bridge, reload])
  const run = useCallback(async (item: ConnectorItem, action: "connect" | "disconnect" | "retry") => {
    setBusyIds((current) => new Set(current).add(item.id))
    try {
      await bridge.item[action]({ id: item.id })
      if (!item.connectionStatus) toast.success(`${item.name} MCP ${action === "disconnect" ? "已停用" : "已激活"}`)
    } catch (error) { toast.error(error instanceof Error ? error.message : "连接失败") }
    finally {
      await reload()
      setBusyIds((current) => { const next = new Set(current); next.delete(item.id); return next })
    }
  }, [bridge, reload])
  const toggle = useCallback((item: ConnectorItem) => run(item, item.enabled ? "disconnect" : "connect"), [run])
  const reconnect = useCallback((item: ConnectorItem) => run(item, "connect"), [run])
  const retry = useCallback((item: ConnectorItem) => run(item, "retry"), [run])
  const openDocumentation = useCallback(async (url: string) => {
    try { await requireBridgeDomain("shell").openExternal(url) }
    catch { toast.error("无法打开文档") }
  }, [])
  return { items, loading, busyIds, toggle, reconnect, retry, openDocumentation }
}
