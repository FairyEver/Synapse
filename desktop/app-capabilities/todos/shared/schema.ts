import { z } from "zod"
import { countTodoCodePoints, isValidTodoText, parseTodoInstant, parseTodoReference, TODO_PRIORITIES, TODO_PRIORITY_FILTERS, TODO_REMINDER_KINDS, TODO_REMINDER_STATUSES, TODO_SORTS } from "@synapse/shared/todo-contracts"
import { TODO_IMAGE_MIME_TYPES, TODO_IMAGE_VARIANTS, TODO_MAX_IMAGES, TODO_MAX_IMAGE_BYTES, TODO_MAX_THUMBNAIL_BYTES } from "@synapse/shared/todo-contracts"

const text = (limit: number) => z.string().refine(isValidTodoText).refine((value) => countTodoCodePoints(value) <= limit)
const instant = z.string().refine((value) => parseTodoInstant(value) !== null)
const todoId = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/u)
const priority = z.enum(TODO_PRIORITIES).nullable().optional()
const imageId = z.uuid().transform(id => id.toLowerCase())
const imageIds = z.array(imageId).max(TODO_MAX_IMAGES).refine(ids => new Set(ids).size === ids.length).optional()
const fields = { title: z.string().trim().pipe(text(200)).refine((value) => value.length > 0), note: text(10000).nullable().optional(), priority, imageIds, dueAt: instant.nullable().optional(),
  reminder: z.enum(TODO_REMINDER_KINDS).optional(), offsetMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).nullable().optional(), remindAt: instant.nullable().optional() }
const preconditions = { expectedVersion: z.number().int().positive().max(2147483647), clientRequestId: z.uuid() }
export const todoListInputSchema = z.object({
  filter: z.enum(["pending", "all"]).optional(), priority: z.enum(TODO_PRIORITY_FILTERS).optional(), sort: z.enum(TODO_SORTS).optional(),
  query: text(200).optional(), offset: z.number().int().min(0).max(2147483647).optional(), limit: z.number().int().min(1).max(100).optional(),
}).strict().default({})
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
export const todoItemSchema = z.object({ id: todoId, title: text(200), note: text(10000).nullable(), priority, imageIds, dueAt: timestamp.nullable(),
  reminder: z.enum(TODO_REMINDER_KINDS), offsetMinutes: z.union([z.literal(10), z.literal(60), z.literal(1440)]).nullable(), remindAt: timestamp.nullable(),
  reminderGeneration: z.number().int().positive(), reminderStatus: z.enum(TODO_REMINDER_STATUSES), completedAt: timestamp.nullable(),
  version: z.number().int().positive(), createdAt: timestamp, updatedAt: timestamp }).strict()
export const todoPageSchema = z.object({ items: z.array(todoItemSchema).max(100), nextOffset: z.number().int().nonnegative().nullable() }).strict()
export const todoDeleteResultSchema = z.object({ id: todoId, version: z.number().int().positive(), deleted: z.literal(true) }).strict()
export const todoChangedSchema = z.object({ id: todoId, version: z.number().int().positive() }).strict()
const imageBytes = (max: number) => z.instanceof(Uint8Array).refine(value => value.byteLength > 0 && value.byteLength <= max)
export const todoImageStageSchema = z.object({ imageId, original: imageBytes(TODO_MAX_IMAGE_BYTES), thumbnail: imageBytes(TODO_MAX_THUMBNAIL_BYTES) }).strict()
export const todoImageReadSchema = z.object({ todoId, imageId, variant: z.enum(TODO_IMAGE_VARIANTS) }).strict()
export const todoImageStageResultSchema = z.object({ imageId }).strict()
export const todoImageContentSchema = z.object({ mimeType: z.enum(TODO_IMAGE_MIME_TYPES), bytes: imageBytes(TODO_MAX_IMAGE_BYTES) }).strict()
export const todoFailureSchema = z.object({ status: z.number().int(), code: z.string().max(64), message: z.string().max(500) }).strict()
export function todoIpcResultSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), data }).strict(), z.object({ ok: z.literal(false), failure: todoFailureSchema }).strict()])
}
