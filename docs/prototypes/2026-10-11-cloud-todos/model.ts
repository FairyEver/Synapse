/** 第一阶段交互原型：所有条目均为示例，不连接产品接口。 */
export type Platform = "desktop" | "iphone" | "ipad"
export type Scenario = "normal" | "signed-out" | "offline" | "empty" | "notifications-off"
export type Filter = "pending" | "all"
export type Reminder = "none" | "due" | "10m" | "1h" | "1d" | "custom"
export interface Todo {
  id: string
  title: string
  note: string
  due: string
  reminder: Reminder
  customReminder: string
  completed: boolean
}
export type Draft = Omit<Todo, "id" | "completed">
export const REFERENCE_TIME = new Date("2026-10-11T10:00:00+08:00").getTime()
export const reminderOptions: { value: Reminder; label: string }[] = [
  { value: "none", label: "不提醒" },
  { value: "due", label: "截止时" },
  { value: "10m", label: "提前 10 分钟" },
  { value: "1h", label: "提前 1 小时" },
  { value: "1d", label: "提前 1 天" },
  { value: "custom", label: "自定时间" },
]
export const initialTodos: Todo[] = [
  { id: "sample-1", title: "提交报销单", note: "附上出差发票和行程单", due: "2026-10-10T18:00", reminder: "none", customReminder: "", completed: false },
  { id: "sample-2", title: "确认待办事项原型", note: "检查桌面端和 iOS 的主要操作", due: "2026-10-11T18:00", reminder: "1h", customReminder: "", completed: false },
  { id: "sample-3", title: "预约车辆保养", note: "", due: "2026-10-12T09:00", reminder: "due", customReminder: "", completed: false },
  { id: "sample-4", title: "整理会议纪要", note: "记录结论和后续事项", due: "", reminder: "none", customReminder: "", completed: false },
  { id: "sample-5", title: "续费域名", note: "", due: "", reminder: "none", customReminder: "", completed: true },
]
export function newDraft(): Draft {
  return { title: "", note: "", due: "", reminder: "none", customReminder: "" }
}
export function instant(value: string): number {
  return value ? new Date(`${value}:00+08:00`).getTime() : NaN
}
export function reminderTime(draft: Draft): number {
  if (draft.reminder === "none") return NaN
  if (draft.reminder === "custom") return instant(draft.customReminder)
  const offsets = { due: 0, "10m": 600000, "1h": 3600000, "1d": 86400000 }
  return instant(draft.due) - offsets[draft.reminder]
}
export function validateDraft(draft: Draft): string | null {
  if (!draft.title.trim()) return "填写标题"
  if (draft.reminder !== "none" && draft.reminder !== "custom" && !draft.due) return "设置截止时间或选择自定提醒时间"
  if (draft.reminder === "custom" && !draft.customReminder) return "设置提醒时间"
  if (draft.reminder !== "none" && (!Number.isFinite(reminderTime(draft)) || reminderTime(draft) <= REFERENCE_TIME)) return "提醒时间须晚于当前时间"
  return null
}
export function displayedTodos(todos: Todo[], filter: Filter): Todo[] {
  return todos.filter(todo => filter === "all" || !todo.completed).sort((a, b) => {
    if (a.completed !== b.completed) return Number(a.completed) - Number(b.completed)
    const aDue = a.due ? instant(a.due) : Infinity
    const bDue = b.due ? instant(b.due) : Infinity
    return aDue === bDue ? 0 : aDue - bDue
  })
}
export function dueLabel(todo: Todo): string {
  if (!todo.due) return ""
  const [date, time] = todo.due.split("T")
  const prefix = date === "2026-10-11" ? "今天" : date === "2026-10-12" ? "明天" : date.replace(/^2026-/, "").replace("-", "/")
  return `${!todo.completed && instant(todo.due) < REFERENCE_TIME ? "已逾期 · " : ""}${prefix} ${time}`
}
export function reminderLabel(todo: Todo): string {
  if (todo.reminder === "none" || todo.completed) return ""
  if (todo.reminder === "custom") return `${todo.customReminder.replace("2026-", "").replace("T", " ")} 提醒`
  return `${reminderOptions.find(option => option.value === todo.reminder)?.label}提醒`
}
