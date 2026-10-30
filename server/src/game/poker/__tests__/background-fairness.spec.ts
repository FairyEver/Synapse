import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Logger } from "@nestjs/common"
import type { PrismaService } from "../../../prisma/prisma.service"
import type { PokerActionService } from "../poker-action.service"
import { PokerDeadlineTask } from "../poker-deadline.task"
import { PokerArchiveService } from "../poker-archive.service"

type Kind = "deadline" | "idle" | "archive"
type Row = {
  id: string
  code: string
  status: string
  actionDeadlineAt: Date
  createdAt: Date
  endedAt: Date
  lastMaintainedAt: Date | null
}
const base = new Date("2026-10-30T00:00:00Z")
const scalar = (value: unknown) => (value instanceof Date ? value.getTime() : value)
function matches(row: Row, where: Record<string, any>): boolean {
  return Object.entries(where).every(([field, condition]) => {
    if (field === "AND")
      return (Array.isArray(condition) ? condition : [condition]).every((part) =>
        matches(row, part),
      )
    if (field === "OR") return condition.some((part: Record<string, any>) => matches(row, part))
    const value = scalar(row[field as keyof Row]) as any
    if (condition instanceof Date || condition === null || typeof condition !== "object")
      return value === scalar(condition)
    return Object.entries(condition).every(([operator, expected]) => {
      const other = scalar(expected) as any
      if (operator === "not") return value !== other
      if (value === null) return false
      if (operator === "lte") return value <= other
      if (operator === "lt") return value < other
      if (operator === "gte") return value >= other
      if (operator === "gt") return value > other
      if (operator === "in") return (expected as unknown[]).includes(value)
      throw new Error("Unsupported persistence filter: " + operator)
    })
  })
}
function fixture(kind: Kind, total: number, future = 0) {
  const offset = kind === "archive" ? 90 * 86400000 : kind === "idle" ? 1800000 : 0,
    cutoff = base.getTime() - offset,
    rows: Row[] = Array.from({ length: total + future }, (_, i) => ({
      id: String(i).padStart(5, "0"),
      code: String(i).padStart(5, "0"),
      status: kind === "deadline" ? "running" : kind === "idle" ? "paused" : "settled",
      actionDeadlineAt: new Date(cutoff + (i < total ? -1 : 1)),
      createdAt: new Date(cutoff + (i < total ? -1 : 1)),
      endedAt: new Date(cutoff + (i < total ? -1 : 1)),
      lastMaintainedAt: null,
    })),
    failures = new Set<string>(),
    attempts: string[] = [],
    completed = new Set<string>(),
    keepOpen = new Set<string>(),
    handledAt = new Map<string, Date>()
  const handle = async (id: string, now: Date) => {
    attempts.push(id)
    handledAt.set(id, now)
    if (failures.has(id)) throw new Error("Persistent per-item failure")
    completed.add(id)
    const row = rows.find((r) => r.id === id)!
    if (keepOpen.has(id)) row.lastMaintainedAt = now
    else row.status = "closed"
    return true
  }
  const prisma = {
    gamePokerRoom: {
      findMany: async ({ where, orderBy, take, select }: any) => {
        const order = Array.isArray(orderBy) ? orderBy : [orderBy]
        return rows
          .filter((row) => matches(row, where))
          .sort((a, b) => {
            for (const clause of order) {
              const [field, direction] = Object.entries(clause)[0] as [keyof Row, any],
                left = scalar(a[field]) as any,
                right = scalar(b[field]) as any
              if (left === right) continue
              const comparison = left === null ? -1 : right === null ? 1 : left < right ? -1 : 1
              return (typeof direction === "string" ? direction : direction.sort) === "desc"
                ? -comparison
                : comparison
            }
            return 0
          })
          .slice(0, take)
          .map((row) =>
            Object.fromEntries(
              Object.keys(select).map((field) => [field, row[field as keyof Row]]),
            ),
          )
      },
    },
    // Archive SQL binds the eligibility cutoff followed by an optional tuple
    // (endedAt,id). This external persistence adapter implements that query.
    $queryRaw: async (
      query: TemplateStringsArray | { values: unknown[] },
      ...parameters: unknown[]
    ) => {
      const values = Array.isArray(query) ? parameters : (query as { values: unknown[] }).values,
        end = new Date(values[0] as string).getTime(),
        after = values.length > 1 ? new Date(values[1] as string).getTime() : null,
        afterId = values[2] as string | undefined
      return rows
        .filter(
          (row) =>
            row.status === "settled" &&
            row.endedAt.getTime() <= end &&
            (after === null ||
              row.endedAt.getTime() > after ||
              (row.endedAt.getTime() === after && row.id > afterId!)),
        )
        .sort((a, b) => a.endedAt.getTime() - b.endedAt.getTime() || a.id.localeCompare(b.id))
        .slice(0, 100)
        .map(({ id, endedAt }) => ({ id, endedAt }))
    },
  }
  let run: (now: Date) => Promise<void>
  if (kind === "archive") {
    const service = new PokerArchiveService(prisma as unknown as PrismaService)
    vi.spyOn(service, "archiveHand").mockImplementation(handle)
    run = (now) => service.scan(now)
  } else {
    const task = new PokerDeadlineTask({
      poker: { prisma, maintain: handle },
      expire: handle,
    } as unknown as PokerActionService)
    run = (now) => task.scan(now)
  }
  const interval = kind === "deadline" ? 1000 : kind === "idle" ? 30000 : 60000
  return {
    rows,
    failures,
    attempts,
    completed,
    keepOpen,
    handledAt,
    run,
    at: (tick: number) => new Date(base.getTime() + tick * interval),
  }
}
beforeEach(() => vi.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined))
afterEach(() => vi.restoreAllMocks())

it("空闲维护优先未维护房：已有100旧在线房不延迟新100在线房之后的冷房", async () => {
  const f = fixture("idle", 201)
  for (const row of f.rows.slice(0, 100)) {
    row.createdAt = new Date(base.getTime() - 7200000)
    row.lastMaintainedAt = new Date(base.getTime() - 60000)
    f.keepOpen.add(row.id)
  }
  for (const row of f.rows.slice(100, 200)) {
    row.createdAt = new Date(base.getTime() - 7200000)
    f.keepOpen.add(row.id)
  }
  f.rows[200].createdAt = new Date(base.getTime() - 3600000)
  await f.run(f.at(0))
  expect(f.completed.has("00200")).toBe(false)
  await f.run(f.at(1))
  expect(f.completed.has("00200")).toBe(true)
  expect(f.attempts.length).toBeLessThanOrEqual(200)
})

it("空闲维护成功项移动到尾部不会延长当前轮次而挡住失败项下一轮重试", async () => {
  const f = fixture("idle", 101)
  for (const row of f.rows.slice(0, 100)) f.keepOpen.add(row.id)
  f.failures.add("00100")
  await f.run(f.at(0))
  await f.run(f.at(1))
  expect(f.attempts).toHaveLength(101)
  f.failures.clear()
  await f.run(f.at(2))
  expect(f.completed.has("00100")).toBe(true)
})

describe.each(["deadline", "idle", "archive"] as const)("后台公平轮转：%s", (kind) => {
  it("前100项持续失败也不能挡住下一批健康项，每轮最多处理100项", async () => {
    const f = fixture(kind, 101)
    for (const row of f.rows.slice(0, 100)) f.failures.add(row.id)
    await f.run(f.at(0))
    expect(f.completed.has("00100")).toBe(false)
    const firstAttempts = f.attempts.length
    expect(firstAttempts).toBe(100)
    await f.run(f.at(1))
    expect(f.completed.has("00100")).toBe(true)
    expect(f.handledAt.get("00100")).toEqual(f.at(1))
    expect(f.attempts.length - firstAttempts).toBeLessThanOrEqual(100)
  })
  it("整批100项失败后空尾有界回绕，恢复项能重试且不超出处理限额", async () => {
    const f = fixture(kind, 100)
    for (const row of f.rows) f.failures.add(row.id)
    await f.run(f.at(0))
    f.failures.delete("00000")
    await f.run(f.at(1))
    expect(f.completed.has("00000")).toBe(true)
    expect(f.attempts.length).toBe(200)
  })
  it("到尾部后回绕，之前失败但已恢复的项仍会重新处理", async () => {
    const f = fixture(kind, 2)
    f.failures.add("00000")
    await f.run(f.at(0))
    expect(f.completed.has("00001")).toBe(true)
    f.failures.clear()
    await f.run(f.at(1))
    expect(f.completed.has("00000")).toBe(true)
  })
  it("新到期条目不无限延长当前轮次，旧失败项可以按有界轮次重试", async () => {
    const f = fixture(kind, 101, 100)
    for (const row of f.rows.slice(0, 100)) f.failures.add(row.id)
    await f.run(f.at(0))
    await f.run(f.at(1))
    expect(f.completed.has("00100")).toBe(true)
    expect(f.completed.has("00101")).toBe(false)
    f.failures.delete("00000")
    await f.run(f.at(2))
    expect(f.completed.has("00000")).toBe(true)
  })
})
