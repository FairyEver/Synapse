import { useCallback, useEffect, useRef, useState } from "react"
import type { TunnelMappingDto } from "@synapse/shared/tunnel-contracts"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { toast } from "sonner"
const message = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试"
export function useTunnels() {
  const [items, setItems] = useState<TunnelMappingDto[]>([]), [clientId, setClientId] = useState("")
  const [loading, setLoading] = useState(true), [failure, setFailure] = useState<string | null>(null)
  const [writingIds, setWritingIds] = useState<Set<string>>(new Set()), [nextOffset, setNextOffset] = useState<number | null>(null)
  const epoch = useRef(0), sequence = useRef(0), alive = useRef(true), locks = useRef(new Set<string>())
  const refresh = useCallback(async (offset = 0) => {
    const generation = epoch.current, order = ++sequence.current
    setLoading(true)
    try {
      const page = await requireBridgeDomain("tunnel").mapping.list({ offset, limit: 100 })
      if (!alive.current || generation !== epoch.current || order !== sequence.current) return
      setClientId(page.currentClientInstanceId); setItems(previous => offset ? [...previous.filter(row => !page.items.some(next => next.id === row.id)), ...page.items] : page.items)
      setNextOffset(page.nextOffset); setFailure(null)
    } catch (error) { if (alive.current && generation === epoch.current && order === sequence.current) setFailure(message(error)) }
    finally { if (alive.current && generation === epoch.current && order === sequence.current) setLoading(false) }
  }, [])
  useEffect(() => {
    alive.current = true
    const api = requireBridgeDomain("tunnel").mapping
    const reset = () => { epoch.current++; sequence.current++; setItems([]); setClientId(""); setNextOffset(null); setFailure(null); setWritingIds(new Set()); locks.current.clear(); void refresh() }
    const changed = api.onChanged(() => { void refresh() }), cleared = api.onReset(reset)
    const timer = setInterval(() => { void refresh() }, 20000)
    void refresh()
    return () => { alive.current = false; epoch.current++; changed(); cleared(); clearInterval(timer) }
  }, [refresh])
  const write = useCallback(async <T,>(key: string, run: () => Promise<T>, commit: (result: T) => void): Promise<boolean> => {
    if (locks.current.has(key)) return false
    const generation = epoch.current
    locks.current.add(key); sequence.current++; setWritingIds(new Set(locks.current)); setFailure(null)
    try {
      const result = await run()
      if (!alive.current || generation !== epoch.current) return false
      sequence.current++; commit(result); return true
    } catch (error) {
      if (alive.current && generation === epoch.current) { setFailure(message(error)); if ((error as { status?: number }).status === 409) void refresh() }
      return false
    } finally { if (alive.current && generation === epoch.current) { locks.current.delete(key); setWritingIds(new Set(locks.current)); setLoading(false) } }
  }, [refresh])
  const save = (result: TunnelMappingDto) => { setClientId(previous => previous || result.clientInstanceId); setItems(previous => [result, ...previous.filter(row => row.id !== result.id)]) }
  const create = (port: number) => write("create", () => requireBridgeDomain("tunnel").mapping.create({ port }), save)
  const update = (row: TunnelMappingDto, port: number) => write(row.id, () => requireBridgeDomain("tunnel").mapping.update(row.id, { port, expectedRevision: row.revision }), save)
  const setEnabled = (row: TunnelMappingDto, enabled: boolean) => write(row.id, () => requireBridgeDomain("tunnel").mapping.setEnabled(row.id, { enabled, expectedRevision: row.revision }), save)
  const remove = (row: TunnelMappingDto) => write(row.id, () => requireBridgeDomain("tunnel").mapping.delete(row.id, { expectedRevision: row.revision }), () => setItems(previous => previous.filter(item => item.id !== row.id)))
  const copy = async (row: TunnelMappingDto) => { try { await navigator.clipboard.writeText(row.url); toast("链接已复制") } catch { toast.error("复制失败") } }
  return { items, clientId, loading, failure, writingIds, nextOffset, refresh, create, update, setEnabled, remove, copy }
}
