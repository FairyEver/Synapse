import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { buildDriveDiscussionNotificationOpenUrl, type NotificationSource } from "@synapse/shared"
import { useAccount } from "@/app-shell/account"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import { requestOpenTerminalSession } from "@/app-shell/terminal-navigation"
import { SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG } from "@/generated/deployment-config.generated"
import { getSynapseBridge, requireBridgeDomain } from "@/lib/electron-bridge"
import { mailRequest } from "@/lib/mail-api"
import type { MailMessage } from "@/types/mail"
import type { SynapseNotification } from "@/types/notification-center"

const logger = createRendererLogger("message-center")
export type MessageFilter = "pending" | "all" | "unread"
export type MessageSourceFilter = "all" | NotificationSource

export function useMessageCenter(onOpenMeeting?: (meetingId: string) => void) {
  const { state } = useAccount()
  const notifications = useAppNotifications()
  const userId = state.status === "authenticated" ? state.profile.user.id : null
  const identity = `${state.status}:${userId ?? ""}`
  const identityRef = useRef(identity)
  identityRef.current = identity
  const navigationId = useRef(0)
  useLayoutEffect(() => { navigationId.current += 1 }, [identity])
  useEffect(() => {
    const off = getSynapseBridge()?.account.state.onChanged((event) => {
      const next = `${event.state.status}:${event.state.status === "authenticated" ? event.state.profile.user.id : ""}`
      if (next !== identityRef.current) { identityRef.current = next; navigationId.current += 1 }
    })
    return () => { navigationId.current += 1; off?.() }
  }, [])
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<MessageFilter>("all")
  const [source, setSource] = useState<MessageSourceFilter>("all")
  const [items, setItems] = useState<readonly SynapseNotification[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [unread, setUnread] = useState(0)
  const [selected, setSelected] = useState<SynapseNotification | null>(null)
  const [mail, setMail] = useState<MailMessage | null>(null)
  const [mailLoading, setMailLoading] = useState(false)
  const [mailError, setMailError] = useState<string | null>(null)
  const [mailRevision, setMailRevision] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => new Set())
  const [error, setError] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const refreshId = useRef(0)
  const pendingDeletes = useRef(new Map<string, number>())
  const imagePreviewRef = useRef<string | null>(null)
  const imageRequestId = useRef(0)

  const replaceImagePreview = useCallback((next: string | null) => {
    const previous = imagePreviewRef.current
    imagePreviewRef.current = next
    if (previous && previous !== next) URL.revokeObjectURL(previous)
    setImagePreview(next)
  }, [])

  const closeImagePreview = useCallback(() => {
    imageRequestId.current += 1
    replaceImagePreview(null)
  }, [replaceImagePreview])

  const openNotificationImage = useCallback(async (item: SynapseNotification) => {
    if (!item.image) return
    const requestId = ++imageRequestId.current
    const expectedIdentity = identityRef.current
    try {
      const { mimeType, bytes } = await requireBridgeDomain("account").notifications.image({ id: item.id })
      if (requestId !== imageRequestId.current || identityRef.current !== expectedIdentity) return
      replaceImagePreview(URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: mimeType })))
    } catch (cause) {
      if (requestId !== imageRequestId.current) return
      logger.warn("Notification image could not be loaded.", { cause })
      setError("图片加载失败")
    }
  }, [replaceImagePreview])

  useEffect(() => {
    closeImagePreview()
  }, [closeImagePreview, userId])

  useEffect(() => () => {
    imageRequestId.current += 1
    if (!imagePreviewRef.current) return
    URL.revokeObjectURL(imagePreviewRef.current)
    imagePreviewRef.current = null
  }, [])

  useEffect(() => {
    refreshId.current += 1
    navigationId.current += 1
    setItems([])
    setUnread(0)
    setSelected(null)
    setMail(null)
    setMailError(null)
    setMailLoading(false)
  }, [userId])

  useEffect(() => {
    if (!open || selected?.source !== "mail-internal" || !selected.targetId) {
      setMail(null)
      setMailError(null)
      setMailLoading(false)
      return
    }
    let active = true
    const messageId = selected.targetId
    setMail(null)
    setMailError(null)
    setMailLoading(true)
    void mailRequest({ kind: "messageGet", messageId }).then(async (message) => {
      if (!active) return
      setMail(message)
      setMailLoading(false)
      if (message.sender.userId !== message.viewerId && !message.readAt) {
        try {
          await mailRequest({ kind: "messageSetRead", messageId, read: true })
        } catch (cause) {
          if (active) {
            logger.warn("Mail could not be marked read from the message center.", { cause })
            setMailError("站内信已读状态更新失败")
          }
        }
      }
    }).catch((cause: unknown) => {
      if (!active) return
      logger.warn("Mail could not be loaded from the message center.", { cause })
      setMailError("原信无法读取")
      setMailLoading(false)
    })
    return () => { active = false }
  }, [open, selected?.id, selected?.source, selected?.targetId, mailRevision, userId])

  const refresh = useCallback(async () => {
    if (!userId) return
    const requestId = ++refreshId.current
    setLoading(true)
    try {
      const api = requireBridgeDomain("account").notifications
      const [page, count] = await Promise.all([api.list({ filter, ...(source === "all" ? {} : { source }) }), api.count()])
      if (requestId !== refreshId.current) return
      setItems(page.items)
      setCursor(page.nextCursor)
      setUnread(count.unread)
      setError(null)
    } catch (cause) {
      if (requestId !== refreshId.current) return
      logger.warn("Messages could not be loaded.", { cause })
      setError("消息加载失败")
    } finally {
      if (requestId === refreshId.current) setLoading(false)
    }
  }, [filter, source, userId])

  const latestRefresh = useRef(refresh)
  useLayoutEffect(() => { latestRefresh.current = refresh }, [refresh])

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
    navigationId.current += 1
    setOpen(next)
    if (next) void refresh()
    else setSelected(null)
  }

  const changeFilter = (next: MessageFilter) => {
    if (next === filter) return
    navigationId.current += 1
    refreshId.current += 1
    setFilter(next)
    setItems([])
    setCursor(null)
    setSelected(null)
  }

  const changeSource = (next: MessageSourceFilter) => {
    if (next === source) return
    navigationId.current += 1
    refreshId.current += 1
    setSource(next)
    setItems([])
    setCursor(null)
    setSelected(null)
  }

  const openItem = async (item: SynapseNotification) => {
    navigationId.current += 1
    setSelected(item)
    try {
      if (!item.readAt) await requireBridgeDomain("account").notifications.read({ id: item.id })
      setSelected((current) => current?.id === item.id ? { ...current, readAt: current.readAt ?? new Date().toISOString() } : current)
      await latestRefresh.current()
    } catch (cause) {
      logger.warn("Message could not be marked read.", { cause })
      setError("操作失败")
    }
  }

  const navigate = async (item: SynapseNotification) => {
    const requestId = ++navigationId.current
    const expectedIdentity = identity
    try {
      if (item.source === "drive-discussion") {
        if (!userId) return
        const url = buildDriveDiscussionNotificationOpenUrl(SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl, item.id)
        await requireBridgeDomain("account").notifications.read({ id: item.id })
        if (requestId !== navigationId.current || identityRef.current !== expectedIdentity) return
        await requireBridgeDomain("shell").openExternal(url)
      } else if (item.source.startsWith("terminal-") && item.targetId) {
        requestOpenTerminalSession({ requestId: crypto.randomUUID(), sessionId: item.targetId })
        setOpen(false)
      } else if (item.source === "meeting-transcription" && item.targetId) {
        onOpenMeeting?.(item.targetId)
        setOpen(false)
      } else if (item.source === "todo-reminder" && item.targetId) {
        await requireBridgeDomain("apps").openSystemApp("todos", { todoOpenRequest: { requestId: crypto.randomUUID(), id: item.targetId } })
        setOpen(false)
      } else if (item.source === "mail-internal" && item.targetId) {
        await requireBridgeDomain("apps").openSystemApp("mail-internal", {
          mailInternalOpenRequest: { requestId: crypto.randomUUID(), messageId: item.targetId },
        })
        setOpen(false)
      } else if (item.url) {
        const url = new URL(item.url)
        if (url.protocol === "https:") await requireBridgeDomain("shell").openExternal(url.toString())
      }
    } catch (cause) {
      if (item.source === "drive-discussion") {
        if (requestId !== navigationId.current || identityRef.current !== expectedIdentity) return
        logger.warn("Drive discussion notification could not be opened.", { notificationId: item.id, reason: "OPEN_FAILED" })
        setError("无法打开消息目标")
        return
      }
      logger.warn("Message target could not be opened.", { cause })
      setError("无法打开消息目标")
    }
  }

  const openApiGuide = async () => {
    try {
      const url = new URL("/document/open-api/guide/send-message", SYNAPSE_DESKTOP_DEPLOYMENT_CONFIG.publicAppUrl)
      await requireBridgeDomain("shell").openExternal(url.toString())
    } catch (cause) {
      logger.warn("Message API guide could not be opened.", { cause })
      setError("无法打开 API 文档")
    }
  }

  const commitDelete = async (id: string) => {
    pendingDeletes.current.delete(id)
    try {
      await requireBridgeDomain("account").notifications.delete({ id })
      await latestRefresh.current()
    } catch (cause) {
      logger.warn("Message could not be deleted.", { cause })
      setError("删除失败")
    } finally {
      setHiddenIds((current) => { const next = new Set(current); next.delete(id); return next })
    }
  }

  const remove = (item: SynapseNotification) => {
    if (pendingDeletes.current.has(item.id)) return
    setHiddenIds((current) => new Set(current).add(item.id))
    setSelected(null)
    const timer = window.setTimeout(() => { void commitDelete(item.id) }, 5_500)
    pendingDeletes.current.set(item.id, timer)
    notifications.info("通知已删除", { durationMs: 5_500, action: { label: "撤销", onClick: () => {
      const pending = pendingDeletes.current.get(item.id)
      if (pending === undefined) return
      window.clearTimeout(pending)
      pendingDeletes.current.delete(item.id)
      setHiddenIds((current) => { const next = new Set(current); next.delete(item.id); return next })
    } } })
  }

  useEffect(() => {
    const pending = pendingDeletes.current
    return () => {
      for (const [id, timer] of pending) {
        window.clearTimeout(timer)
        try {
          void requireBridgeDomain("account").notifications.delete({ id }).catch((cause: unknown) => {
            logger.warn("Pending message deletion could not be completed.", { cause })
          })
        } catch (cause) {
          logger.warn("Pending message deletion could not be started.", { cause })
        }
      }
      pending.clear()
    }
  }, [])

  const markAllRead = async () => {
    try {
      await requireBridgeDomain("account").notifications.readAll()
      if (filter === "unread") setSelected(null)
      await latestRefresh.current()
    } catch (cause) {
      logger.warn("Messages could not be marked read.", { cause })
      setError("操作失败")
    }
  }

  const setRead = async (item: SynapseNotification, read: boolean) => {
    try {
      await requireBridgeDomain("account").notifications.read({ id: item.id, read })
      setSelected((current) => current?.id === item.id
        ? (read && filter === "unread" ? null : { ...current, readAt: read ? new Date().toISOString() : null })
        : current)
      await latestRefresh.current()
    } catch (cause) {
      logger.warn("Message read state could not be changed.", { cause })
      setError("操作失败")
    }
  }

  const deleteAll = async (scope: "all" | "pending") => {
    try {
      await requireBridgeDomain("account").notifications.deleteAll({ filter: scope })
      for (const timer of pendingDeletes.current.values()) window.clearTimeout(timer)
      pendingDeletes.current.clear()
      setHiddenIds(new Set())
      setSelected(null)
      await latestRefresh.current()
    } catch (cause) {
      logger.warn("Messages could not be deleted.", { cause })
      setError(scope === "pending" ? "忽略失败" : "清空失败")
    }
  }

  const loadMailForReply = async (item: SynapseNotification): Promise<MailMessage | null> => {
    if (item.source !== "mail-internal" || !item.targetId) return null
    if (mail?.messageId === item.targetId) return mail
    return mailRequest({ kind: "messageGet", messageId: item.targetId })
  }

  const refreshAfterQuickReply = async (messageId: string) => {
    await latestRefresh.current()
    if (selected?.source === "mail-internal" && selected.targetId === messageId) setMailRevision((value) => value + 1)
  }

  const loadMore = async () => {
    if (!cursor || loading) return
    const requestId = refreshId.current
    try {
      const page = await requireBridgeDomain("account").notifications.list({ filter, cursor, ...(source === "all" ? {} : { source }) })
      if (requestId !== refreshId.current) return
      setItems((current) => [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))])
      setCursor(page.nextCursor)
    } catch (cause) {
      if (requestId !== refreshId.current) return
      logger.warn("More messages could not be loaded.", { cause })
      setError("消息加载失败")
    }
  }

  return {
    authenticated: state.status === "authenticated",
    accountId: userId,
    open, filter, source, items: items.filter((item) => !hiddenIds.has(item.id)), cursor,
    unread: Math.max(0, unread - items.filter((item) => hiddenIds.has(item.id) && !item.readAt).length),
    selected, mail, mailLoading, mailError, loading, error,
    imagePreview, closeImagePreview, openNotificationImage,
    changeOpen, changeFilter, changeSource, openItem, navigate, openApiGuide, remove, markAllRead, setRead, deleteAll, loadMore, refresh,
    retryMail: () => setMailRevision((value) => value + 1),
    loadMailForReply, refreshAfterQuickReply,
    closeDetail: () => { navigationId.current += 1; setSelected(null) },
  }
}
