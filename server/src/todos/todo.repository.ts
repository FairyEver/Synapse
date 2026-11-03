import { Injectable } from "@nestjs/common"
import { Prisma, type TodoItem } from "@prisma/client"
import type { TodoListInput } from "@synapse/shared/todo-contracts"
import { PrismaService } from "../prisma/prisma.service"

export type TodoVisibleRow = Pick<TodoItem,
  "id" | "title" | "note" | "priority" | "dueAt" | "reminder" | "offsetMinutes" | "remindAt"
  | "reminderGeneration" | "reminderStatus" | "completedAt" | "version" | "createdAt" | "updatedAt"
>

@Injectable()
export class TodoRepository {
  constructor(private readonly prisma: PrismaService) {}
  transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> { return this.prisma.$transaction(work, { timeout: 10000 }) }
  async list(userId: string, input: Required<Pick<TodoListInput, "filter" | "offset" | "limit">> & TodoListInput): Promise<TodoVisibleRow[]> {
    const filter = input.filter === "pending" ? Prisma.sql`AND "completedAt" IS NULL` : Prisma.empty
    const priority = input.priority === "none" ? Prisma.sql`AND "priority" IS NULL`
      : input.priority ? Prisma.sql`AND "priority" = ${input.priority}::"TodoPriority"` : Prisma.empty
    const priorityOrder = input.sort === "priority" ? Prisma.sql`CASE WHEN "completedAt" IS NULL THEN "priority" END ASC NULLS LAST,` : Prisma.empty
    const query = input.query ? Prisma.sql`AND (strpos(lower("title"), lower(${input.query})) > 0 OR strpos(lower(coalesce("note", '')), lower(${input.query})) > 0)` : Prisma.empty
    return this.prisma.$queryRaw<TodoVisibleRow[]>(Prisma.sql`
      SELECT "id", "title", "note", "priority", "dueAt", "reminder", "offsetMinutes", "remindAt",
        "reminderGeneration", "reminderStatus", "completedAt", "version", "createdAt", "updatedAt"
      FROM "TodoItem"
      WHERE "userId" = ${userId} AND "deletedAt" IS NULL ${filter} ${priority} ${query}
      ORDER BY ("completedAt" IS NOT NULL) ASC,
        ${priorityOrder}
        CASE WHEN "completedAt" IS NULL THEN "dueAt" END ASC NULLS LAST,
        CASE WHEN "completedAt" IS NULL THEN "createdAt" END ASC,
        CASE WHEN "completedAt" IS NULL THEN "id" END ASC,
        "completedAt" DESC NULLS LAST,
        CASE WHEN "completedAt" IS NOT NULL THEN "id" END DESC
      LIMIT ${input.limit + 1} OFFSET ${input.offset}
    `)
  }
  get(userId: string, id: string): Promise<TodoItem | null> { return this.prisma.todoItem.findFirst({ where: { id, userId, deletedAt: null } }) }
  async lock(tx: Prisma.TransactionClient, userId: string, id: string): Promise<TodoItem | null> {
    return (await tx.$queryRaw<TodoItem[]>`SELECT * FROM "TodoItem" WHERE "id" = ${id} AND "userId" = ${userId} AND "deletedAt" IS NULL FOR UPDATE`)[0] ?? null
  }
}
