import { BadRequestException } from "@nestjs/common"
import { z } from "zod"
import { countTodoCodePoints, isValidTodoText, parseTodoInstant, TODO_REMINDER_KINDS, type TodoFieldsInput, type TodoReminderKind } from "@synapse/shared/todo-contracts"

const text = (limit: number) => z.string().refine(isValidTodoText, "包含无效字符").refine((value) => countTodoCodePoints(value) <= limit, `最多 ${limit} 个字符`)
const instant = z.string().refine((value) => parseTodoInstant(value) !== null, "使用带时区的分钟精度时间").transform((value) => parseTodoInstant(value)!.toISOString())
const fields = {
  title: z.string().trim().pipe(text(200)).refine((value) => value.length > 0, "标题必填"),
  note: text(10000).transform((value) => value.trim() ? value : null).nullable().optional(),
  dueAt: instant.nullable().optional(),
  reminder: z.enum(TODO_REMINDER_KINDS).optional(),
  offsetMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).nullable().optional(),
  remindAt: instant.nullable().optional(),
}
const preconditions = { expectedVersion: z.number().int().positive().max(2147483647), clientRequestId: z.uuid() }
export const todoCreateSchema = z.object({ ...fields, clientRequestId: z.uuid() }).strict()
export const todoUpdateSchema = z.object({ ...fields, title: fields.title.optional(), ...preconditions }).strict()
export const todoCompletionSchema = z.object({ completed: z.boolean(), ...preconditions }).strict()
export const todoDeleteSchema = z.object(preconditions).strict()
export const todoListSchema = z.object({
  filter: z.enum(["pending", "all"]).default("pending"),
  query: text(200).optional(),
  offset: z.coerce.number().int().min(0).max(2147483647).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict()
export interface NormalizedTodoFields {
  title: string
  note: string | null
  dueAt: Date | null
  reminder: TodoReminderKind
  offsetMinutes: number | null
  remindAt: Date | null
}
export function normalizeTodoFields(input: Partial<TodoFieldsInput>, current: NormalizedTodoFields | null, now: Date, options: { validateFuture?: boolean } = {}): NormalizedTodoFields {
  const title = input.title ?? current?.title ?? ""
  const note = input.note === undefined ? current?.note ?? null : input.note
  const dueAt = input.dueAt === undefined ? current?.dueAt ?? null : input.dueAt === null ? null : new Date(input.dueAt)
  const reminder = input.reminder ?? current?.reminder ?? "none"
  let offsetMinutes = input.offsetMinutes === undefined ? current?.offsetMinutes ?? null : input.offsetMinutes
  let remindAt: Date | null
  if (reminder === "none") { remindAt = null; offsetMinutes = null }
  else if (reminder === "custom") {
    remindAt = input.remindAt === undefined ? current?.remindAt ?? null : input.remindAt === null ? null : new Date(input.remindAt)
    offsetMinutes = null
    if (!remindAt) throw new BadRequestException({ code: "TODO_INVALID_REMINDER", message: "请选择提醒时间" })
  } else {
    if (!dueAt || (reminder === "before_due" && offsetMinutes === null)) throw new BadRequestException({ code: "TODO_INVALID_REMINDER", message: "请补齐截止时间和提醒选项" })
    if (reminder === "at_due") offsetMinutes = null
    remindAt = new Date(dueAt.getTime() - (offsetMinutes ?? 0) * 60_000)
    if (input.remindAt != null && new Date(input.remindAt).getTime() !== remindAt.getTime()) throw new BadRequestException({ code: "TODO_INVALID_REMINDER", message: "提醒时间与截止时间不一致" })
  }
  const changed = !current || current.reminder !== reminder || current.offsetMinutes !== offsetMinutes || current.remindAt?.getTime() !== remindAt?.getTime()
  if (options.validateFuture !== false && changed && remindAt && remindAt <= now) throw new BadRequestException({ code: "TODO_REMINDER_IN_PAST", message: "提醒时间必须晚于当前时间" })
  return { title, note, dueAt, reminder, offsetMinutes, remindAt }
}
