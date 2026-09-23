import { useCallback, useEffect, useRef, useState } from "react"
import { useAccount } from "@/app-shell/account"
import { createRendererLogger } from "@/app-shell/logging"
import { requestOpenTerminalSession } from "@/app-shell/terminal-navigation"
import { getSynapseBridge, requireBridgeDomain } from "@/lib/electron-bridge"
import type { SynapseNotification } from "@/types/notification-center"

const logger = createRendererLogger("message-center")
export type MessageFilter = "pending" | "all" | "unread"

export function useMessageCenter(onOpenMeeting?: (meetingId: string) => void) {
  const { state } = useAccount()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<MessageFilter>("pending")
  const [items, setItems] = useState<readonly SynapseNotification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [selected, setSelected] = useState<SynapseNotification | null>(null)
  const [error, setError] = useState<string | null>(null)
  const refreshId = useRef(0)

  useEffect(() => {
    refreshId.current += 1
    setItems([])
    setUnread(0)
    setSelected(null)
  }, [userId])

  const refresh = useCallback(async () => {
    if (!userId) return
    const requestId = ++refreshId.current
    try {
      const api = requireBridgeDomain("account").notifications
      const [page, count] = await Promise.all([api.list({ filter }), api.count()])
      if (requestId !== refreshId.current) return
      setItems(page.items)
      setCursor(page.nextCursor)
      setUnread(count.unread)
      setError(null)
    } catch (cause) {
      if (requestId !== refreshId.current) return
      logger.warn("Messages could not be loaded.", { cause })
      setError("消息加载失败")
    }
  }, [filter, userId])

  useEffect(() => {
    if (!userId) return
    void refresh()
    const bridge = getSynapseBridge()
    const off = bridge?.account.notifications.onChanged(() => { void refresh() })
    const offLive = bridge?.live.onStateChanged((event) => {
      if (event.state.status === "connected") void refresh()
    })
    const onFocus = () => { void refresh() }
    window.addEventListener("focus", onFocus)
    return () => {
      off?.()
      offLive?.()
      window.removeEventListener("focus", onFocus)
    }
  }, [refresh, userId])

  const changeOpen = (next: boolean) => {
    setOpen(next)
    if (next) void refresh()
    else setSelected(null)
  }

  const changeFilter = (next: MessageFilter) => {
    setFilter(next)
    setSelected(null)
  }

  const openItem = async (item: SynapseNotification) => {
    try {
      if (!item.readAt) await requireBridgeDomain("account").notifications.read({ id: item.id })
      setSelected({ ...item, readAt: item.readAt ?? new Date().toISOString() })
      await refresh()
    } catch (cause) {
      logger.warn("Message could not be marked read.", { cause })
      setError("操作失败")
    }
  }

  const navigate = async (item: SynapseNotification) => {
    try {
      if (item.source.startsWith("terminal-") && item.targetId) {
        requestOpenTerminalSession({ requestId: crypto.randomUUID(), sessionId: item.targetId })
        setOpen(false)
      } else if (item.source === "meeting-transcription" && item.targetId) {
        onOpenMeeting?.(item.targetId)
        setOpen(false)
      } else if (item.url) {
        const url = new URL(item.url)
        if (url.protocol === "https:") await requireBridgeDomain("shell").openExternal(url.toString())
      }
    } catch (cause) {
      logger.warn("Message target could not be opened.", { cause })
      setError("无法打开消息目标")
    }
  }

  const remove = async (item: SynapseNotification) => {
    try {
      await requireBridgeDomain("account").notifications.delete({ id: item.id })
      setSelected(null)
      await refresh()
    } catch (cause) {
      logger.warn("Message could not be deleted.", { cause })
      setError("删除失败")
    }
  }

  const markAllRead = async () => {
    try {
      await requireBridgeDomain("account").notifications.readAll()
      await refresh()
    } catch (cause) {
      logger.warn("Messages could not be marked read.", { cause })
      setError("操作失败")
    }
  }

  const loadMore = async () => {
    if (!cursor) return
    try {
      const page = await requireBridgeDomain("account").notifications.list({ filter, cursor })
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setCursor(page.nextCursor)
    } catch (cause) {
      logger.warn("More messages could not be loaded.", { cause })
      setError("消息加载失败")
    }
  }

  return {
    authenticated: state.status === "authenticated",
    open, filter, items, cursor, unread, selected, error,
    changeOpen, changeFilter, openItem, navigate, remove, markAllRead, loadMore,
    closeDetail: () => setSelected(null),
  }
}
