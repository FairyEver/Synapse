import { z } from "zod"
import { countTodoCodePoints, isValidTodoText, parseTodoInstant, parseTodoReference, TODO_REMINDER_KINDS, TODO_REMINDER_STATUSES } from "@synapse/shared/todo-contracts"

const text = (limit: number) => z.string().refine(isValidTodoText).refine((value) => countTodoCodePoints(value) <= limit)
const instant = z.string().refine((value) => parseTodoInstant(value) !== null)
const todoId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u)
const fields = { title: z.string().trim().pipe(text(200)).refine((value) => value.length > 0), note: text(10000).nullable().optional(), dueAt: instant.nullable().optional(),
  reminder: z.enum(TODO_REMINDER_KINDS).optional(), offsetMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).nullable().optional(), remindAt: instant.nullable().optional() }
const preconditions = { expectedVersion: z.number().int().positive().max(2147483647), clientRequestId: z.uuid() }
export const todoListInputSchema = z.object({ filter: z.enum(["pending", "all"]).optional(), query: text(200).optional(), offset: z.number().int().min(0).max(2147483647).optional(), limit: z.number().int().min(1).max(100).optional() }).strict().default({})
export const todoLocatorSchema = z.object({ id: todoId.optional(), reference: z.string().refine((value) => parseTodoReference(value) !== null).optional() }).strict().refine((value) => (value.id === undefined) !== (value.reference === undefined), "请选择一个事项")
export const todoCreateInputSchema = z.object({ ...fields, clientRequestId: z.uuid() }).strict()
export const todoUpdateInputSchema = z.object({ ...fields, title: fields.title.optional(), ...preconditions }).strict()
export const todoCompletionInputSchema = z.object({ completed: z.boolean(), ...preconditions }).strict()
export const todoDeleteInputSchema = z.object(preconditions).strict()
export const todoUpdateActionSchema = todoUpdateInputSchema.extend({ id: todoId })
export const todoCompletionActionSchema = todoCompletionInputSchema.extend({ id: todoId })
export const todoDeleteActionSchema = todoDeleteInputSchema.extend({ id: todoId })
export const todoIdSchema = todoId
const timestamp = z.iso.datetime()
export const todoItemSchema = z.object({ id: todoId, title: text(200), note: text(10000).nullable(), dueAt: timestamp.nullable(),
  reminder: z.enum(TODO_REMINDER_KINDS), offsetMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).nullable(), remindAt: timestamp.nullable(),
  reminderGeneration: z.number().int().positive(), reminderStatus: z.enum(TODO_REMINDER_STATUSES), completedAt: timestamp.nullable(),
  version: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp }).strict()
export const todoPageSchema = z.object({ items: z.array(todoItemSchema).max(100), nextOffset: z.number().int().nonnegative().nullable() }).strict()
export const todoDeleteResultSchema = z.object({ id: todoId, version: z.number().int().positive(), deleted: z.literal(true) }).strict()
export const todoChangedSchema = z.object({ id: todoId, version: z.number().int().positive() }).strict()
export const todoFailureSchema = z.object({ status: z.number().int(), code: z.string().max(64), message: z.string().max(500) }).strict()
export function todoIpcResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }).strict(), z.object({ ok: z.literal(false), failure: todoFailureSchema }).strict()])
}
