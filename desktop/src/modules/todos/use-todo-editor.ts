import { useCallback, useEffect, useRef, useState } from "react"
import { countTodoCodePoints, isValidTodoText, type TodoFieldsInput, type TodoItemDto, type TodoReminderKind } from "@synapse/shared/todo-contracts"
import { todosApi } from "@/lib/todos-api"
import { todoLocalToUtc, todoUtcToLocal } from "./todo-time"
import { todoErrorMessage } from "./todo-state"

export type TodoEditorDraft = { id: string | null; expectedVersion: number | null; clientRequestId: string; title: string; note: string; due: string; reminder: TodoReminderKind; offsetMinutes: 10 | 60 | 1440; custom: string; originalTimes: { dueLocal: string; customLocal: string; dueAt: string | null; remindAt: string | null } }
export function useTodoEditor({ generation, online, onSaved }: { generation: number; online: boolean; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<TodoEditorDraft | null>(null)
  const [saving, setSaving] = useState(false), [error, setError] = useState<string | null>(null), [conflict, setConflict] = useState(false)
  const busy = useRef(false), epoch = useRef(generation), active = useRef(true), revision = useRef(0)
  const open = useCallback((item?: TodoItemDto) => {
    if (busy.current) return
    revision.current++
    const dueAt = item?.dueAt ?? null, remindAt = item?.reminder === "custom" ? item.remindAt : null
    const dueLocal = todoUtcToLocal(dueAt), customLocal = todoUtcToLocal(remindAt)
    setDraft({ id: item?.id ?? null, expectedVersion: item?.version ?? null, clientRequestId: crypto.randomUUID(), title: item?.title ?? "", note: item?.note ?? "", due: dueLocal, reminder: item?.reminder ?? "none", offsetMinutes: item?.offsetMinutes ?? 10, custom: customLocal, originalTimes: { dueAt, remindAt, dueLocal, customLocal } }); setError(null); setConflict(false)
  }, [])
  const close = useCallback(() => { if (!busy.current) { revision.current++; setDraft(null); setError(null) } }, [])
  const change = useCallback(<K extends keyof TodoEditorDraft>(key: K, value: TodoEditorDraft[K]) => {
    if (busy.current) return
    revision.current++
    setDraft((current) => current && current[key] !== value ? { ...current, [key]: value, clientRequestId: crypto.randomUUID() } : current)
  }, [])
  useEffect(() => { epoch.current = generation; revision.current++; busy.current = false; setDraft(null); setSaving(false); setError(null); setConflict(false) }, [generation])
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  const save = useCallback(async () => {
    if (!draft || busy.current) return
    const identity = epoch.current; revision.current++; busy.current = true; setSaving(true); setError(null)
    const current = () => active.current && identity === epoch.current
    try {
      if (!online) throw new Error("连接失败，请重试")
      const title = draft.title.trim()
      if (!title || countTodoCodePoints(title) > 200 || !isValidTodoText(title)) throw new Error("标题需为 1 至 200 个字符")
      if (countTodoCodePoints(draft.note) > 10000 || !isValidTodoText(draft.note)) throw new Error("备注最多 10000 个字符")
      const dueAt = draft.due === draft.originalTimes.dueLocal ? draft.originalTimes.dueAt : todoLocalToUtc(draft.due)
      const remindAt = draft.custom === draft.originalTimes.customLocal ? draft.originalTimes.remindAt : todoLocalToUtc(draft.custom)
      const fields: TodoFieldsInput = { title, note: draft.note.trim() ? draft.note : null, dueAt, reminder: draft.reminder,
        offsetMinutes: draft.reminder === "before_due" ? draft.offsetMinutes : null, remindAt: draft.reminder === "custom" ? remindAt : null }
      if (draft.reminder === "custom" && !fields.remindAt) throw new Error("请选择提醒时间")
      if ((draft.reminder === "at_due" || draft.reminder === "before_due") && !fields.dueAt) throw new Error("请选择截止时间")
      if (draft.id && draft.expectedVersion) await todosApi.update(draft.id, { ...fields, expectedVersion: draft.expectedVersion, clientRequestId: draft.clientRequestId })
      else await todosApi.create({ ...fields, clientRequestId: draft.clientRequestId })
      if (current()) { setDraft(null); setConflict(false); await onSaved() }
    } catch (cause) { if (current()) { setError(todoErrorMessage(cause)); setConflict((cause as { code?: string })?.code === "TODO_VERSION_CONFLICT") } }
    finally { if (current()) { busy.current = false; setSaving(false) } }
  }, [draft, online, onSaved])
  const reload = useCallback(async () => {
    if (!draft?.id || busy.current) return
    const identity = epoch.current, request = ++revision.current
    const current = () => active.current && identity === epoch.current && request === revision.current
    try { const item = await todosApi.get({ id: draft.id }); if (current()) open(item) }
    catch (cause) { if (current()) setError(todoErrorMessage(cause)) }
  }, [draft?.id, open])
  const sameIdentity = epoch.current === generation
  return { draft: sameIdentity ? draft : null, saving: sameIdentity && saving, error: sameIdentity ? error : null, conflict: sameIdentity && conflict, open, close, change, save, reload }
}
