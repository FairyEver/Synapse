import { useEffect, useMemo, useState } from "react"
import type { MailMessage } from "@/types/mail"
import {
  contactsFor,
  initialMessages,
  messageBox,
  messageMatchesContact,
  personName,
  viewer,
  type MailBox,
} from "./model"

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration))
}

export function usePrototype() {
  const [messages, setMessages] = useState(initialMessages)
  const [box, setBox] = useState<MailBox>("inbox")
  const [contactKey, setContactKey] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>("mail-test")
  const [notice, setNotice] = useState("")
  const [dark, setDark] = useState(false)

  const contacts = useMemo(() => contactsFor(messages, box), [messages, box])
  const list = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return messages
      .filter((message) => messageBox(message) === box)
      .filter((message) => messageMatchesContact(message, box, contactKey))
      .filter((message) => !unreadOnly || message.readAt === null)
      .filter((message) => !needle || `${message.subject}\n${message.body}\n${personName(message.sender)}`.toLocaleLowerCase().includes(needle))
      .sort((left, right) => right.sentAt.localeCompare(left.sentAt))
  }, [messages, box, contactKey, unreadOnly, query])
  const detail = list.find((message) => message.messageId === selectedId) ?? messages.find((message) => message.messageId === selectedId) ?? null
  const totalUnread = messages.filter((message) => messageBox(message) === "inbox" && message.readAt === null).length

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 2400)
    return () => window.clearTimeout(timer)
  }, [notice])

  function openMessage(messageId: string) {
    setSelectedId(messageId)
    setMessages((current) => current.map((message) => message.messageId === messageId ? { ...message, readAt: message.readAt ?? new Date().toISOString() } : message))
  }

  function changeBox(next: MailBox) {
    setBox(next)
    setContactKey(null)
    setQuery("")
    setUnreadOnly(false)
    setSelectedId(next === "inbox" ? "mail-test" : null)
  }

  function chooseContact(key: string | null) {
    setContactKey(key)
    setSelectedId(null)
  }

  async function reply(source: MailMessage, body: string) {
    await wait(720)
    const replyBody = body.trim()
    if (!replyBody) return
    const recipients = source.sender.userId === viewer.userId ? source.toRecipients : [source.sender]
    const now = new Date().toISOString()
    const replyMessage: MailMessage = {
      messageId: `reply-${Date.now()}`,
      kind: "user",
      sender: viewer,
      recipients,
      toRecipients: recipients,
      ccRecipients: [],
      relationKind: "reply",
      subject: `回复：${source.subject}`,
      snippet: replyBody,
      sentAt: now,
      readAt: now,
      attachmentCount: 0,
      viewerId: viewer.userId,
      body: replyBody,
      team: source.team,
      conversationId: source.conversationId,
      replyToId: source.messageId,
      relation: { kind: "reply", messageId: source.messageId },
      quote: null,
      attachments: [],
    }
    setMessages((current) => [...current, replyMessage])
    setNotice(`已回复 ${recipients.map(personName).join("、")}`)
  }

  return {
    box,
    contactKey,
    query,
    setQuery,
    unreadOnly,
    setUnreadOnly,
    contacts,
    list,
    detail,
    selectedId,
    totalUnread,
    notice,
    setNotice,
    dark,
    setDark,
    openMessage,
    changeBox,
    chooseContact,
    reply,
    markAllRead: () => setMessages((current) => current.map((message) => message.readAt === null ? { ...message, readAt: new Date().toISOString() } : message)),
  }
}

export type Prototype = ReturnType<typeof usePrototype>
