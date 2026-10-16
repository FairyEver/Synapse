import { useEffect, useState } from "react"
import { ancestors, initialBindings, initialItems, type Binding, type Item } from "./model"

export type Panel = { kind: "share" | "sync" | "preview"; itemId: string } | { kind: "center" }
export function usePrototype() {
  const [items, setItems] = useState(initialItems)
  const [bindings, setBindings] = useState(initialBindings)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [popover, setPopover] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [confirm, setConfirm] = useState<{ kind: "share" | "sync"; id: string } | null>(null)
  const [notice, setNotice] = useState("")
  const [copyFallback, setCopyFallback] = useState<string | null>(null)
  const [dark, setDark] = useState(false)
  const [online, setOnline] = useState(true)
  const folder = items.find(item => item.id === folderId)
  const breadcrumbs = folder ? [...ancestors(folder, items), folder] : []
  const rows = items.filter(item => item.parent === folderId)
  useEffect(() => { document.documentElement.classList.toggle("dark", dark) }, [dark])
  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(""), 3000)
    return () => window.clearTimeout(timer)
  }, [notice])
  function bindingFor(item: Item) {
    const binding = bindings.find(candidate => candidate.id === (item.binding ?? item.contains))
    return binding && !online && (binding.state === "active" || binding.state === "uploading")
      ? { ...binding, state: "offline" as const } : binding
  }
  function openFolder(id: string | null) { setFolderId(id); setPopover(null); setPanel(null) }
  function openItem(item: Item) {
    if (item.folder) openFolder(item.id)
    else showPanel({ kind: "preview", itemId: item.id })
  }
  function showPanel(next: Panel) { setPopover(null); setPanel(next) }
  function updateBinding(id: string, state: Binding["state"]) {
    setBindings(current => current.map(binding => binding.id === id ? { ...binding, state } : binding))
  }
  function togglePause(binding: Binding) {
    const next = binding.state === "paused" ? "active" : "paused"
    updateBinding(binding.id, next)
    setNotice(next === "paused" ? "已暂停该同步关系" : "已继续双向同步")
  }
  function removeConfirmed() {
    if (!confirm) return
    if (confirm.kind === "share") {
      setItems(current => current.map(item => item.id === confirm.id ? { ...item, share: undefined } : item))
      setNotice("分享已关闭")
    } else {
      setBindings(current => current.filter(binding => binding.id !== confirm.id))
      setNotice("同步已移除，两端文件保留")
    }
    setConfirm(null); setPanel(null); setPopover(null)
  }
  async function copy(text: string, label: string) {
    try {
      if (!navigator.clipboard) throw new Error("当前打开方式不支持剪贴板")
      await navigator.clipboard.writeText(text)
      setNotice(label)
    } catch {
      setPopover(null); setCopyFallback(text)
    }
  }
  function renewShare(item: Item) {
    setItems(current => current.map(candidate => candidate.id === item.id && candidate.share
      ? { ...candidate, share: { ...candidate.share, expired: false, expires: "2026-10-23 23:59" } } : candidate))
    setNotice("分享有效期已延长至 10 月 23 日")
  }
  function resolveConflict(binding: Binding) {
    updateBinding(binding.id, "active"); setNotice("已保留两个版本，继续双向同步")
  }
  function reset() {
    setItems(initialItems()); setBindings(initialBindings()); setFolderId(null); setPopover(null)
    setPanel(null); setConfirm(null); setCopyFallback(null); setOnline(true); setNotice("已恢复示例数据")
  }
  return { items, bindings, folderId, folder, breadcrumbs, rows, popover, setPopover, panel, setPanel, confirm, setConfirm,
    notice, copyFallback, setCopyFallback, dark, setDark, online, setOnline, bindingFor, openFolder, openItem, showPanel, togglePause,
    removeConfirmed, copy, renewShare, resolveConflict, reset }
}
export type Prototype = ReturnType<typeof usePrototype>
