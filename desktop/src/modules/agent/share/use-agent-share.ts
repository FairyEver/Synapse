import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react"
import type { AgentConversationTarget } from "@/types/agent-conversation-window"
import type { SynapseAgentTimelineItem } from "@/types/agent"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { createRendererLogger } from "@/app-shell/logging"
import { DEFAULT_AGENT_SHARE_SETTINGS, type AgentShareSettings } from "@/types/agent-share"
import { loadShareContent, loadShareHistory, selectShareRange, shareHistoryIndex, shareHistoryPrefix, shareMessageRounds, shareMessages, type ShareMessage } from "./messages"

const logger = createRendererLogger("agent.share")
type ScrollAnchor = { readonly id?: string; readonly offset: number; readonly top: number }

export function useAgentShare(input: { target: AgentConversationTarget; title: string; items: readonly SynapseAgentTimelineItem[]; sending: boolean; viewport: RefObject<HTMLDivElement | null> }) {
  const key = `${input.target.projectId}:${input.target.conversationId}:${input.target.sessionKey}`
  const [owner, setOwner] = useState(key)
  const [enabled, setEnabled] = useState(false)
  const [snapshot, setSnapshot] = useState<readonly SynapseAgentTimelineItem[]>([])
  const [cachedHistory, setCachedHistory] = useState<readonly SynapseAgentTimelineItem[]>([])
  const [complete, setComplete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const [preview, setPreview] = useState<readonly ShareMessage[] | null>(null)
  const [settings, setSettings] = useState<AgentShareSettings>(DEFAULT_AGENT_SHARE_SETTINGS)
  const controller = useRef<AbortController | null>(null)
  const anchor = useRef<string | null>(null)
  const preparingRef = useRef(false)
  const scroll = useRef<ScrollAnchor | null>(null)
  const active = owner === key && enabled
  const liveItems = useMemo(() => {
    if (owner !== key || !cachedHistory.length) return input.items
    return input.items.length ? [...shareHistoryPrefix(cachedHistory, input.items), ...input.items] : input.items
  }, [cachedHistory, input.items, key, owner])
  const items = active ? snapshot : liveItems
  const messages = useMemo(() => shareMessages(items, active ? false : input.sending), [items, active, input.sending])

  function saveScroll() {
    const viewport = input.viewport.current
    if (!viewport) return
    const top = viewport.getBoundingClientRect().top
    const first = Array.from(viewport.querySelectorAll<HTMLElement>("[data-share-message]")).find((node) => (node.querySelector("article") ?? node.firstElementChild ?? node).getBoundingClientRect().bottom > top)
    scroll.current = { id: first?.dataset.shareMessage, offset: first ? (first.querySelector("article") ?? first.firstElementChild ?? first).getBoundingClientRect().top - top : 0, top: viewport.scrollTop }
  }
  useLayoutEffect(() => {
    const saved = scroll.current, viewport = input.viewport.current
    if (!saved || !viewport) return
    scroll.current = null
    const node = Array.from(viewport.querySelectorAll<HTMLElement>("[data-share-message]")).find((item) => item.dataset.shareMessage === saved.id)
    viewport.scrollTop = node ? viewport.scrollTop + (node.querySelector("article") ?? node.firstElementChild ?? node).getBoundingClientRect().top - viewport.getBoundingClientRect().top - saved.offset : saved.top
  }, [items, active, input.viewport])
  useEffect(() => {
    setEnabled(false); setOwner(key); setSnapshot([]); setCachedHistory([]); setSelected(new Set()); setPreview(null); setLoading(false); setPreparing(false); setComplete(false); setError(null)
    preparingRef.current = false
    return () => { controller.current?.abort(); preparingRef.current = false }
  }, [key])

  async function fetchHistory(initial: readonly SynapseAgentTimelineItem[], signal: AbortSignal) {
    try {
      const history = await loadShareHistory(requireBridgeDomain("agent"), input.target, signal)
      if (signal.aborted) return
      const prefix = shareHistoryPrefix(history, initial)
      const frozen = [...prefix, ...initial]
      saveScroll(); setSnapshot(frozen); setCachedHistory(frozen.filter((item) => shareHistoryIndex(item) !== undefined)); setComplete(true); setError(null)
    } catch (cause) {
      if (signal.aborted) return
      logger.warn("Agent share history failed.", { errorName: cause instanceof Error ? cause.name : typeof cause })
      setError(cause instanceof Error ? cause.message : "历史消息加载失败，请重试。")
    } finally { if (!signal.aborted) setLoading(false) }
  }
  function enter(id?: string) {
    controller.current?.abort()
    const next = new AbortController(); controller.current = next
    const frozen = structuredClone(liveItems)
    // A running turn's assistant text is never made selectable by freezing it.
    const eligible = new Set(shareMessages(frozen, input.sending).map((item) => item.id))
    const initial = frozen.map((item) => item.kind === "message" && item.role === "assistant" && !eligible.has(item.id) ? { ...item, streaming: true } : item)
    saveScroll(); setOwner(key); setSnapshot(initial); setEnabled(true); setComplete(false); setLoading(true); setError(null); setPreview(null)
    setSelected(new Set(id && eligible.has(id) ? [id] : [])); anchor.current = null
    setSettings({ ...DEFAULT_AGENT_SHARE_SETTINGS, title: input.title.slice(0, 60) || "对话摘录" })
    return fetchHistory(initial, next.signal)
  }
  function exit() {
    controller.current?.abort(); preparingRef.current = false
    saveScroll(); setEnabled(false); setSelected(new Set()); setPreview(null); setLoading(false); setPreparing(false); setError(null)
  }
  function choose(id: string, range: boolean) {
    if (!messages.some((item) => item.id === id)) return
    const rangeAnchor = range ? anchor.current : null
    setSelected((current) => selectShareRange(messages, current, id, rangeAnchor, !current.has(id)))
    anchor.current = id
  }
  function toggleRound(ids: readonly string[]) {
    setSelected((current) => { const next = new Set(current); const remove = ids.every((id) => next.has(id)); for (const id of ids) { if (remove) next.delete(id); else next.add(id) } return next })
    anchor.current = null
  }
  function preset(kind: "all" | "ai" | "latest" | "clear") {
    if ((kind === "all" || kind === "ai") && !complete) return
    const latestComplete = kind === "latest" ? shareMessageRounds(messages).filter((ids) => ids.some((id) => messages.find((item) => item.id === id)?.role === "assistant")).at(-1) : undefined
    const ids = kind === "clear" ? [] : kind === "latest" ? latestComplete ?? [] : messages.filter((item) => kind !== "ai" || item.role === "assistant").map((item) => item.id)
    setSelected(new Set(ids)); anchor.current = null
  }
  async function openPreview() {
    if (preparingRef.current || !controller.current || !selected.size) return
    preparingRef.current = true; setPreparing(true); setError(null)
    const signal = controller.current.signal
    try {
      const chosen = messages.filter((item) => selected.has(item.id))
      if (!chosen.length || chosen.length !== selected.size) throw new Error("所选消息已变化，请重新选择。")
      const full = await loadShareContent(requireBridgeDomain("agent"), input.target, chosen, signal)
      if (!signal.aborted) setPreview(full)
    } catch (cause) {
      if (!signal.aborted) {
        logger.warn("Agent share content failed.", { errorName: cause instanceof Error ? cause.name : typeof cause })
        setError(cause instanceof Error ? cause.message : "消息加载失败，请重试。")
      }
    } finally { if (!signal.aborted) { preparingRef.current = false; setPreparing(false) } }
  }
  return { active, items, messages, selected, loading, preparing, complete, error, preview, settings, setSettings, enter, exit, choose, toggleRound, preset, openPreview,
    closePreview: () => setPreview(null),
    retryHistory: () => { if (controller.current && !controller.current.signal.aborted) { setLoading(true); void fetchHistory(snapshot, controller.current.signal) } },
  }
}

export type AgentShareController = ReturnType<typeof useAgentShare>
