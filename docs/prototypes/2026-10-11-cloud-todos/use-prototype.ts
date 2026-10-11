import { useCallback, useEffect, useState } from "react"
import { initialTodos, newDraft, reminderTime, REFERENCE_TIME, validateDraft, type Draft, type Filter, type Platform, type Scenario, type Todo } from "./model"

type Snapshot = { platform: Platform; scenario: Scenario; todos: Todo[]; filter: Filter; home: boolean }
type Host = { widgetState?: { privateContent?: Snapshot }; setWidgetState?: (snapshot: unknown) => Promise<unknown> }
function host(): Host | undefined { return (window as Window & { openai?: Host }).openai }
function restore(): Snapshot {
  const saved = host()?.widgetState?.privateContent
  if (saved && ["desktop", "iphone", "ipad"].includes(saved.platform) && Array.isArray(saved.todos)) return saved
  return { platform: "desktop", scenario: "normal", todos: initialTodos, filter: "pending", home: false }
}
export function usePrototype() {
  const [snapshot, setSnapshot] = useState<Snapshot>(restore)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(newDraft)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Todo | null>(null)
  const [notice, setNotice] = useState("")
  const [undoItem, setUndoItem] = useState<Todo | null>(null)
  const update = useCallback((next: Snapshot) => {
    setSnapshot(next)
    const promise = host()?.setWidgetState?.({ modelContent: { platform: next.platform, scenario: next.scenario }, privateContent: next })
    promise?.catch(() => { /* 宿主状态不可用时，原型继续保留本次内存状态。 */ })
  }, [])
  useEffect(() => {
    const receive = (event: Event) => {
      const saved = (event as CustomEvent).detail?.globals?.widgetState?.privateContent as Snapshot | undefined
      if (saved && Array.isArray(saved.todos)) setSnapshot(saved)
    }
    window.addEventListener("openai:set_globals", receive)
    return () => window.removeEventListener("openai:set_globals", receive)
  }, [])
  function setPlatform(platform: Platform) { update({ ...snapshot, platform, filter: "pending" }); setEditing(null); setNotice("") }
  function setScenario(scenario: Scenario) {
    update({ ...snapshot, scenario, todos: scenario === "empty" ? [] : snapshot.scenario === "empty" ? initialTodos : snapshot.todos })
    setNotice(""); setUndoItem(null); setEditing(null)
  }
  function openEditor(todo?: Todo) {
    setEditing(todo?.id ?? "new")
    setDraft(todo ? { title: todo.title, note: todo.note, due: todo.due, reminder: todo.completed ? "none" : todo.reminder, customReminder: todo.customReminder } : newDraft())
    setError(null)
  }
  function closeEditor() { setEditing(null); setError(null) }
  function save() {
    const validation = validateDraft(draft)
    if (validation) { setError(validation); return }
    if (snapshot.scenario === "offline") { setError("保存失败，检查网络后重试"); return }
    const data = { ...draft, title: draft.title.trim(), note: draft.note.trim() }
    const todos = editing === "new" ? [...snapshot.todos, { ...data, id: `sample-${Date.now()}`, completed: false }] : snapshot.todos.map(todo => todo.id === editing ? { ...todo, ...data } : todo)
    update({ ...snapshot, todos }); setNotice(editing === "new" ? "已添加" : "已保存"); setUndoItem(null); closeEditor()
  }
  function toggle(todo: Todo) {
    if (snapshot.scenario === "offline") { setNotice("操作失败，检查网络后重试"); return }
    const reopened = { ...todo, completed: !todo.completed }
    if (!reopened.completed && reminderTime(reopened) <= REFERENCE_TIME) reopened.reminder = "none"
    update({ ...snapshot, todos: snapshot.todos.map(item => item.id === todo.id ? reopened : item) })
    setNotice(todo.completed ? "已恢复为未完成" : "已完成"); setUndoItem(todo)
  }
  function undo() {
    if (!undoItem) return
    update({ ...snapshot, todos: snapshot.todos.map(todo => todo.id === undoItem.id ? undoItem : todo) })
    setUndoItem(null); setNotice("已撤销")
  }
  function remove() {
    if (!deleting) return
    if (snapshot.scenario === "offline") { setNotice("删除失败，检查网络后重试"); setDeleting(null); return }
    update({ ...snapshot, todos: snapshot.todos.filter(todo => todo.id !== deleting.id) })
    setDeleting(null); setNotice("已删除"); setUndoItem(null)
  }
  return { ...snapshot, setPlatform, setScenario, setFilter: (filter: Filter) => update({ ...snapshot, filter }), setHome: (home: boolean) => update({ ...snapshot, home, filter: home ? snapshot.filter : "pending" }), editing, draft, setDraft, error, openEditor, closeEditor, save, deleting, setDeleting, remove, toggle, undo, undoItem, notice }
}
export type Prototype = ReturnType<typeof usePrototype>
