import { ConflictException, Injectable, NotFoundException, Optional } from "@nestjs/common"
import { Prisma, type TodoItem } from "@prisma/client"
import type { TodoChangedPayload, TodoCompletionInput, TodoCreateInput, TodoDeleteInput, TodoDeleteResult, TodoItemDto, TodoListInput, TodoPageDto, TodoUpdateInput } from "@synapse/shared/todo-contracts"
import { TodoRepository } from "./todo.repository"
import { todoCompletionSchema, todoCreateSchema, todoDeleteSchema, todoListSchema, todoUpdateSchema, normalizeTodoFields } from "./todo.schemas"
import { nextTodoReminderState } from "./todo-state"
import { todoRequestHash } from "./todo-idempotency"
import { TodoEvents } from "./todo-events"

export function todoDto(item: TodoItem): TodoItemDto {
  return { id: item.id, title: item.title, note: item.note, dueAt: item.dueAt?.toISOString() ?? null, reminder: item.reminder,
    offsetMinutes: item.offsetMinutes as TodoItemDto["offsetMinutes"], remindAt: item.remindAt?.toISOString() ?? null,
    reminderGeneration: item.reminderGeneration, reminderStatus: item.reminderStatus, completedAt: item.completedAt?.toISOString() ?? null,
    version: item.version, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() }
}
@Injectable()
export class TodosService {
  constructor(private readonly repository: TodoRepository, @Optional() private readonly events?: TodoEvents) {}
  async list(userId: string, input: TodoListInput): Promise<TodoPageDto> {
    const parsed = todoListSchema.parse(input)
    const rows = await this.repository.list(userId, parsed)
    return { items: rows.slice(0, parsed.limit).map(todoDto), nextOffset: rows.length > parsed.limit ? parsed.offset + parsed.limit : null }
  }
  async get(userId: string, id: string): Promise<TodoItemDto> {
    const row = await this.repository.get(userId, id)
    if (!row) throw this.unavailable()
    return todoDto(row)
  }
  async create(userId: string, raw: TodoCreateInput): Promise<TodoItemDto> {
    const parsed = todoCreateSchema.parse(raw)
    // Canonicalize defaults before hashing; a replay is allowed after its reminder time passes.
    const canonical = normalizeTodoFields(parsed, null, new Date(), { validateFuture: false })
    const input = { ...parsed, ...canonical, dueAt: canonical.dueAt?.toISOString() ?? null, remindAt: canonical.remindAt?.toISOString() ?? null } as TodoCreateInput
    return this.mutate(userId, "create", null, input, async (tx, hash, changed) => {
      const existing = await tx.todoItem.findUnique({ where: { userId_createRequestId: { userId, createRequestId: input.clientRequestId } } })
      if (existing) { if (existing.createRequestHash !== hash) throw this.requestConflict(); if (existing.deletedAt) throw this.unavailable(); return todoDto(existing) }
      const now = new Date()
      const fields = normalizeTodoFields(input, null, now)
      const row = await tx.todoItem.create({ data: { userId, ...fields, ...nextTodoReminderState(fields, null, null, now), createRequestId: input.clientRequestId, createRequestHash: hash } })
      changed({ id: row.id, version: row.version })
      return todoDto(row)
    })
  }
  async update(userId: string, id: string, raw: TodoUpdateInput): Promise<TodoItemDto> {
    const input = todoUpdateSchema.parse(raw)
    return this.mutate(userId, "update", id, input, async (tx, _hash, changed) => {
      const row = await this.requireVersion(tx, userId, id, input.expectedVersion)
      const now = new Date()
      const fields = normalizeTodoFields(input, row, now)
      const state = nextTodoReminderState(fields, row, row.completedAt, now)
      const unchanged = fields.title === row.title && fields.note === row.note && fields.dueAt?.getTime() === row.dueAt?.getTime()
        && fields.reminder === row.reminder && fields.offsetMinutes === row.offsetMinutes && fields.remindAt?.getTime() === row.remindAt?.getTime()
      if (unchanged) return todoDto(row)
      const updated = await tx.todoItem.update({ where: { id }, data: { ...fields, ...state, version: { increment: 1 } } })
      changed({ id: updated.id, version: updated.version })
      return todoDto(updated)
    })
  }
  async setCompleted(userId: string, id: string, raw: TodoCompletionInput): Promise<TodoItemDto> {
    const input = todoCompletionSchema.parse(raw)
    return this.mutate(userId, "completion", id, input, async (tx, _hash, changed) => {
      const row = await this.requireVersion(tx, userId, id, input.expectedVersion)
      if (Boolean(row.completedAt) === input.completed) return todoDto(row)
      const now = new Date()
      const completedAt = input.completed ? now : null
      const updated = await tx.todoItem.update({ where: { id }, data: { completedAt, ...nextTodoReminderState(row, row, completedAt, now), version: { increment: 1 } } })
      changed({ id: updated.id, version: updated.version })
      return todoDto(updated)
    })
  }
  async delete(userId: string, id: string, raw: TodoDeleteInput): Promise<TodoDeleteResult> {
    const input = todoDeleteSchema.parse(raw)
    return this.mutate(userId, "delete", id, input, async (tx, _hash, changed) => {
      const row = await this.requireVersion(tx, userId, id, input.expectedVersion)
      const deleted = await tx.todoItem.update({ where: { id }, data: { deletedAt: new Date(), reminderStatus: row.reminderStatus === "pending" ? "cancelled" : row.reminderStatus, version: { increment: 1 } } })
      changed({ id: deleted.id, version: deleted.version })
      return { id: deleted.id, version: deleted.version, deleted: true }
    })
  }
  private async mutate<T extends TodoItemDto | TodoDeleteResult>(userId: string, action: string, id: string | null, input: { clientRequestId: string }, work: (tx: Prisma.TransactionClient, hash: string, changed: (payload: TodoChangedPayload) => void) => Promise<T>): Promise<T> {
    const hash = todoRequestHash(action, id, input)
    let event: TodoChangedPayload | undefined
    const response = await this.repository.transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId + ":" + input.clientRequestId}, 0))::text AS "lock"`
      const receipt = await tx.todoMutationReceipt.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId: input.clientRequestId } } })
      if (receipt && receipt.expiresAt > new Date()) { if (receipt.requestHash !== hash) throw this.requestConflict(); return receipt.response as unknown as T }
      if (receipt) await tx.todoMutationReceipt.delete({ where: { id: receipt.id } })
      const response = await work(tx, hash, (payload) => { event = payload })
      await tx.todoMutationReceipt.create({ data: { userId, clientRequestId: input.clientRequestId, requestHash: hash, response: response as unknown as Prisma.InputJsonValue, expiresAt: new Date(Date.now() + 86400000) } })
      return response
    })
    if (event) this.events?.publish(userId, event)
    return response
  }
  private async requireVersion(tx: Prisma.TransactionClient, userId: string, id: string, version: number): Promise<TodoItem> {
    const row = await this.repository.lock(tx, userId, id)
    if (!row) throw this.unavailable()
    if (row.version !== version) throw new ConflictException({ code: "TODO_VERSION_CONFLICT", message: "事项已被修改，请重新载入" })
    return row
  }
  private unavailable() { return new NotFoundException({ code: "TODO_UNAVAILABLE", message: "事项已删除或无法访问" }) }
  private requestConflict() { return new ConflictException({ code: "TODO_REQUEST_CONFLICT", message: "请求标识已用于其他操作" }) }
}
