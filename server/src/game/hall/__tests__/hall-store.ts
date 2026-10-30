import type { Prisma } from "@prisma/client"
import type { PrismaService } from "../../../prisma/prisma.service"
// External persistence double: mutations run through a serialized transaction, as the DB row lock does.
export function createHallStore(points = 1000000) {
  const account = { userId: "u", points, netProfit: 0, lastGrantAt: null as Date | null }
  const sessions: Record<string, any>[] = []
  const tx = {
    $queryRaw: async (sql: TemplateStringsArray, userId: string) => {
      if (!sql.join("").includes('FROM "GameSession"')) return [account]
      const rows = sessions.filter((s) => s.userId === userId && s.status !== "closed")
      return [
        {
          sessions: rows,
          inPlay: rows.reduce((sum, s) => sum + s.inPlay, 0),
          activeProfit: rows.reduce((sum, s) => sum + s.inPlay - s.buyIn, 0),
        },
      ]
    },
    gameAccount: {
      upsert: async () => account,
      update: async ({ data }: any) => {
        for (const [k, v] of Object.entries(data)) {
          if (typeof v === "object" && v !== null && "increment" in v)
            (account as any)[k] += (v as any).increment
          else (account as any)[k] = v
        }
        return { ...account }
      },
    },
    gameSession: {
      findMany: async ({ where }: any) =>
        sessions
          .filter((s) => s.userId === where.userId && s.status !== "closed")
          .map((s) => ({ ...s })),
      count: async () => sessions.filter((s) => s.status !== "closed").length,
      findUnique: async ({ where }: any) =>
        sessions.find((s) =>
          Object.entries(where.userId_gameKind_gameRoomId).every(([k, v]) => s[k] === v),
        ) ?? null,
      upsert: async ({ where, create, update }: any) => {
        const s = sessions.find((s) =>
          Object.entries(where.userId_gameKind_gameRoomId).every(([k, v]) => s[k] === v),
        )
        if (s) {
          Object.assign(s, update)
          return s
        }
        const row = { id: String(sessions.length), ...create }
        sessions.push(row)
        return row
      },
      update: async ({ where, data }: any) => {
        const s = sessions.find((s) => s.id === where.id)!
        Object.assign(s, data)
        return s
      },
    },
  }
  let tail: Promise<unknown> = Promise.resolve()
  const transaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> => {
    const result = tail.then(() => work(tx as unknown as Prisma.TransactionClient))
    tail = result.catch(() => undefined)
    return result
  }
  return {
    account,
    sessions,
    transaction,
    prisma: { ...tx, $transaction: transaction } as unknown as PrismaService,
  }
}
