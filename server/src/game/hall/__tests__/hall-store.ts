import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"
// Stateful persistence double: a serialized transaction models DB account locks.
export function createHallStore(points = 1000000) {
  const makeAccount = (userId: string, initial: number) => ({ userId, points: initial, netProfit: 0, lastGrantAt: null as Date | null })
  const account = makeAccount("u", points), accounts = new Map([["u", account]])
  const sessions: Record<string, any>[] = [], transfers: Record<string, any>[] = [], locks: string[] = []
  const reserveLots: Record<string, any>[] = [], reserveClaims: Record<string, any>[] = [], reserveMovements: Record<string, any>[] = []
  const failures = { reserveMovement: false }
  const matches = (row: Record<string, any>, where: Record<string, any> = {}): boolean => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === "object") {
      if ("not" in value) return row[key] !== value.not
      if ("in" in value) return value.in.includes(row[key])
      if ("gt" in value) return row[key] > value.gt
    }
    return row[key] === value
  })
  const mutate = (row: Record<string, any>, data: Record<string, any>) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? row[key] + value.increment : value
    return { ...row }
  }
  const reserveTable = (rows: Record<string, any>[], movement = false) => ({
    findMany: async ({ where, take = 1000 }: any) => rows.filter(r => matches(r, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(r => ({ ...r })),
    findUniqueOrThrow: async ({ where }: any) => {
      const flat = where.settlementId_rootActionId_eventIndex ?? where
      const row = rows.find(r => matches(r, flat)); if (!row) throw new Error("missing reserve row"); return { ...row }
    },
    upsert: async ({ where, create, update }: any) => {
      const row = rows.find(r => matches(r, where)); if (row) return mutate(row, update)
      const added = { ...create }; rows.push(added); return { ...added }
    },
    createMany: async ({ data }: any) => {
      if (movement && failures.reserveMovement) throw new Error("injected reserve write failure")
      let count = 0
      for (const value of data) if (!rows.some(r => r.id === value.id || movement && r.settlementId === value.settlementId && r.rootActionId === value.rootActionId && r.eventIndex === value.eventIndex)) { rows.push({ ...value }); count++ }
      return { count }
    },
    update: async ({ where, data }: any) => { const row = rows.find(r => matches(r, where)); if (!row) throw new Error("missing reserve row"); return mutate(row, data) },
    updateMany: async ({ where, data }: any) => { const found = rows.filter(r => matches(r, where)); found.forEach(r => mutate(r, data)); return { count: found.length } },
    aggregate: async ({ where }: any) => ({ _sum: { remainingAmount: rows.filter(r => matches(r, where)).reduce((n, r) => n + r.remainingAmount, 0) } }),
    count: async ({ where }: any) => rows.filter(r => matches(r, where)).length,
  })
  const tx = {
    $executeRaw: async (_sql: TemplateStringsArray, userId: string) => { if (!accounts.has(userId)) accounts.set(userId, makeAccount(userId, 0)); return 0 },
    $queryRaw: async (sql: TemplateStringsArray, userId: string) => {
      if (sql.join("").includes("pg_advisory_xact_lock")) return []
      if (!sql.join("").includes('FROM "GameSession"')) { locks.push(userId); return [accounts.get(userId)] }
      const rows = sessions.filter(s => s.userId === userId && s.status !== "closed")
      const financial = rows.filter(s => s.funding !== "practice")
      return [{ sessions: rows, inPlay: financial.reduce((sum, s) => sum + s.inPlay, 0), activeProfit: financial.reduce((sum, s) => sum + s.inPlay - s.buyIn, 0), pending: transfers.filter(t => t.userId === userId && t.funding === "points" && t.status === "pending").reduce((sum, t) => sum + t.amount, 0) + reserveClaims.filter(c => c.userId === userId && c.funding === "points" && c.status === "pending").reduce((sum, c) => sum + c.remainingAmount, 0) }]
    },
    gameReserveLot: reserveTable(reserveLots),
    gameReserveClaim: reserveTable(reserveClaims),
    gameReserveMovement: reserveTable(reserveMovements, true),
    gameAccount: { update: async ({ where, data }: any) => mutate(accounts.get(where.userId)!, data) },
    gameSession: {
      findMany: async ({ where }: any) => sessions.filter(s => matches(s, where)).map(s => ({ ...s })),
      findFirst: async ({ where }: any) => sessions.find(s => matches(s, where)) ?? null,
      count: async ({ where }: any) => sessions.filter(s => matches(s, where)).length,
      findUnique: async ({ where }: any) => sessions.find(s => matches(s, where.userId_gameKind_gameRoomId)) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const row = sessions.find(s => matches(s, where.userId_gameKind_gameRoomId))
        if (row) { Object.assign(row, update); return row }
        const added = { id: String(sessions.length), ...create }; sessions.push(added); return added
      },
      update: async ({ where, data }: any) => mutate(sessions.find(s => s.id === where.id)!, data),
    },
    gamePendingTransfer: {
      createMany: async ({ data }: any) => { for (const value of data) if (!transfers.some(t => t.sourceId === value.sourceId && t.admissionId === value.admissionId)) transfers.push({ id: String(transfers.length).padStart(5, "0"), status: "pending", releasedAt: null, releasedTo: null, ...value }); return { count: data.length } },
      findUniqueOrThrow: async ({ where }: any) => { const row = transfers.find(t => matches(t, where.sourceId_admissionId)); if (!row) throw new Error("not found"); return { ...row } },
      findMany: async ({ where, take }: any) => transfers.filter(t => matches(t, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(t => ({ ...t })),
      groupBy: async ({ where }: any) => [...new Set(transfers.filter(t => matches(t, where)).map(t => t.userId))].map(userId => ({ userId })),
      count: async ({ where }: any) => transfers.filter(t => matches(t, where)).length,
      updateMany: async ({ where, data }: any) => { const rows = transfers.filter(t => matches(t, where)); rows.forEach(row => mutate(row, data)); return { count: rows.length } },
    },
  }
  let tail: Promise<unknown> = Promise.resolve()
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const result = tail.then(async () => {
      const before = structuredClone({ accounts: [...accounts], sessions, transfers, reserveLots, reserveClaims, reserveMovements })
      try { return await work(tx as unknown as Prisma.TransactionClient) }
      catch (error) {
        for (const [id, value] of before.accounts) Object.assign(accounts.get(id) ?? (() => { const added = makeAccount(id, 0); accounts.set(id, added); return added })(), value)
        for (const id of accounts.keys()) if (!before.accounts.some(([key]) => key === id)) accounts.delete(id)
        sessions.splice(0, sessions.length, ...before.sessions); transfers.splice(0, transfers.length, ...before.transfers)
        reserveLots.splice(0, reserveLots.length, ...before.reserveLots); reserveClaims.splice(0, reserveClaims.length, ...before.reserveClaims); reserveMovements.splice(0, reserveMovements.length, ...before.reserveMovements)
        throw error
      }
    })
    tail = result.catch(() => undefined); return result
  }
  return { account, accounts, sessions, transfers, reserveLots, reserveClaims, reserveMovements, failures, locks, transaction, prisma: { ...tx, $transaction: transaction } as unknown as PrismaService }
}
