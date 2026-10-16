import { useEffect, useMemo, useState } from "react"
import { contactsFor, initialMessages, matchingMessages, type Box, type Contact, type Message } from "./model"

export function usePrototype() {
  const [messages, setMessages] = useState(initialMessages)
  const [box, setBox] = useState<Box>("inbox")
  const [contact, setContact] = useState<Contact | null>(null)
  const [partySearch, setPartySearch] = useState("")
  const [query, setQuery] = useState("")
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [checked, setChecked] = useState<string[]>([])
  const [deleting, setDeleting] = useState<string[] | null>(null)
  const [dark, setDark] = useState(false)
  const [notice, setNotice] = useState("")
  const [pickerOpen, setPickerOpen] = useState(false)
  const contacts = useMemo(() => contactsFor(messages, box), [messages, box])
  const list = useMemo(() => matchingMessages(messages, box, contact?.id ?? null, query, unreadOnly), [messages, box, contact, query, unreadOnly])
  const detail = messages.find(message => message.id === selectedId) ?? null
  const totalUnread = messages.filter(message => message.box === "inbox" && message.unread).length
  const partyLabel = box === "inbox" ? "发件人" : "收件人"
  const boxLabel = box === "inbox" ? "收件箱" : "已发送"
  const foundContacts = contacts.filter(party => `${party.name} ${party.identity ?? ""}`.toLocaleLowerCase().includes(partySearch.trim().toLocaleLowerCase()))

  useEffect(() => { document.documentElement.classList.toggle("dark", dark) }, [dark])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 2500)
    return () => window.clearTimeout(timer)
  }, [notice])

  function clearSelection() { setSelectedId(null); setSelecting(false); setChecked([]) }
  function chooseBox(next: Box) {
    if (next === box) return
    setBox(next); setContact(null); setPartySearch(""); setQuery(""); setUnreadOnly(false); setPickerOpen(false); clearSelection()
  }
  function chooseContact(next: Contact | null) { setContact(next); setPickerOpen(false); clearSelection() }
  function search(value: string) { setQuery(value); clearSelection() }
  function toggleUnread() { setUnreadOnly(!unreadOnly); clearSelection() }
  function open(message: Message) {
    if (selecting) { setChecked(current => current.includes(message.id) ? current.filter(id => id !== message.id) : [...current, message.id]); return }
    setSelectedId(message.id)
    if (message.box === "inbox") setMessages(current => current.map(item => item.id === message.id ? { ...item, unread: false } : item))
  }
  function toggleSelecting() { setSelecting(!selecting); setChecked([]); setSelectedId(null) }
  function toggleRead() {
    if (!detail) return
    setMessages(current => current.map(item => item.id === detail.id ? { ...item, unread: !item.unread } : item))
  }
  function markAllRead() {
    setMessages(current => current.map(item => item.box === "inbox" ? { ...item, unread: false } : item))
    setNotice("收件箱已全部设为已读")
  }
  function confirmDelete() {
    if (!deleting) return
    setMessages(current => current.filter(item => !deleting.includes(item.id)))
    setNotice(`已删除 ${deleting.length} 封示例信件`)
    setDeleting(null); clearSelection()
  }
  function clearFilters() { setContact(null); setPartySearch(""); setQuery(""); setUnreadOnly(false); clearSelection() }
  function reset() {
    setMessages(initialMessages()); setBox("inbox"); setDeleting(null); setPickerOpen(false); clearFilters(); setNotice("已恢复示例数据")
  }
  return { messages, box, contact, partySearch, setPartySearch, query, unreadOnly, selecting, checked, deleting, setDeleting, dark, setDark, notice, pickerOpen, setPickerOpen, contacts, foundContacts, list, detail, totalUnread, partyLabel, boxLabel, chooseBox, chooseContact, search, toggleUnread, open, toggleSelecting, toggleRead, markAllRead, confirmDelete, clearFilters, reset, clearSelection }
}
export type Prototype = ReturnType<typeof usePrototype>
