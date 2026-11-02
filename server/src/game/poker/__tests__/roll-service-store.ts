import type { GamePokerRoom } from "@prisma/client"
import type { Prisma } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { createHallStore } from "../../hall/__tests__/hall-store"
import { HallService } from "../../hall/hall.service"
import { PokerService } from "../poker.service"
import { startNext } from "../poker-lifecycle"
import type { RoomContext } from "../poker.service"
// Only persistence is doubled. Room transactions, engine and Hall accounting are real.
export async function rollStore(mode = "points", count = 3, rules?: Pick<GamePokerRoom, "ruleOptions" | "rollPricingVersion">) {
  const db = createHallStore(10000), hall = new HallService(db.prisma)
  const now = new Date("2026-11-01T00:00:00Z")
  const room: any = { id: "room", code: "1234", ownerUserId: "u", name: "table", status: "waiting", mode, maxSeats: 10, buyIn: 500, variant: "standard52", smallBlind: 1, bigBlind: 2, ruleOptions: { roll: true }, rollPricingVersion: "roll-v1", handNo: 0, dealerSeat: 0, currentHandId: null, createdAt: now, ...rules }
  const seats: any[] = [], hands: any[] = [], participants: any[] = [], actions: any[] = [], receipts: any[] = [], rolls: any[] = [], summaries: any[] = [], archives: any[] = []
  const matches = (row: any, where: any = {}): boolean => Object.entries(where).every(([k, v]: any) => {
    if (k === "OR") return v.some((part: any) => matches(row, part))
    if (v && typeof v === "object" && !(v instanceof Date)) {
      if ("not" in v) return row[k] !== v.not
      if ("notIn" in v) return !v.notIn.includes(row[k])
      if ("in" in v) return v.in.includes(row[k])
      if ("gt" in v) return row[k] > v.gt
      if ("gte" in v) return row[k] >= v.gte
      return matches(row, v)
    }
    return row[k] === v
  })
  const table = (rows: any[]) => ({
    upsert: async ({ where, create, update }: any) => { const row = rows.find(r => matches(r, where)); if (row) { Object.assign(row,structuredClone(update)); return structuredClone(row) }; const added = { id: randomUUID(),...structuredClone(create) };rows.push(added);return structuredClone(added) },
    findUnique: async ({ where }: any) => structuredClone(rows.find(r => matches(r, where)) ?? null),
    findUniqueOrThrow: async ({ where }: any) => { const row = rows.find(r => matches(r, where)); if (!row) throw Error("missing fixture row"); return structuredClone(row) },
    findFirst: async ({ where }: any) => structuredClone(rows.find(r => matches(r, where)) ?? null),
    findMany: async ({ where, take = 1000, orderBy }: any = {}) => {
      const found = rows.filter(r => matches(r, where)); if (orderBy && !Array.isArray(orderBy)) { const [key, dir] = Object.entries(orderBy)[0]; found.sort((a,b) => (a[key] > b[key] ? 1 : -1) * (dir === "desc" ? -1 : 1)) }
      return structuredClone(found.slice(0, take))
    },
    create: async ({ data }: any) => { const row = { id: randomUUID(), actionSeq: 0, isAuto: false, showdownSeats: [], status: "running", ...structuredClone(data) }; rows.push(row); return structuredClone(row) },
    createMany: async ({ data }: any) => { rows.push(...data.map((r: any) => ({ id: randomUUID(), folded: false, allIn: false, ...structuredClone(r) }))); return { count: data.length } },
    update: async ({ where, data }: any) => { const row = rows.find(r => matches(r, where)); if (!row) throw Error("missing update row"); Object.assign(row, structuredClone(data)); return structuredClone(row) },
    updateMany: async ({ where, data }: any) => { const found = rows.filter(r => matches(r, where)); for (const r of found) Object.assign(r, structuredClone(data)); return { count: found.length } },
    delete: async ({ where }: any) => rows.splice(rows.findIndex(r => matches(r, where)), 1)[0],
    groupBy: async () => [],
  })
  const arrays = [seats, hands, participants, actions, receipts, rolls, summaries, archives]
  const prisma: any = { $transaction: (work: any) => db.transaction(async (hallTx) => {
    const backup = structuredClone({ arrays, room })
    const tx: any = { ...hallTx, gamePokerRoom: table([room]), gamePokerSeat: table(seats), gamePokerHand: table(hands), gamePokerHandSeat: table(participants), gamePokerAction: table(actions), gamePokerActionReceipt: table(receipts), gamePokerRoll: table(rolls), gamePokerHandSummary: table(summaries), gamePokerAgent: table([]), gamePokerAgentVersion: table([]), gamePokerHandArchive: table(archives), gamePokerControlHistory: table([]), user: table([]) }
    tx.gameSession = { ...hallTx.gameSession, updateMany: table(db.sessions).updateMany }
    tx.$queryRaw = (sql: TemplateStringsArray | Prisma.Sql, ...args: any[]) => {
      const query = "text" in sql ? sql.text : sql.join("")
      if ("values" in sql && "text" in sql) args = sql.values
      if (query.includes("WITH records AS")) {
        const handId = args[2], tracked = args.slice(4)
        const unique = new Map<string, any>()
        for (const archive of archives.filter(a => a.roomId === room.id)) for (const row of archive.data.rolls ?? []) unique.set(row.id, { ...row, displayName: archive.data.seats.find((s: any) => s.admissionId === row.admissionId && s.userId === row.userId)?.displayName ?? "选手" })
        for (const row of rolls.filter(r => r.roomId === room.id)) unique.set(row.id, { ...row, displayName: participants.find(s => s.handId === row.handId && s.admissionId === row.admissionId && s.userId === row.userId)?.displayName ?? "选手" })
        const players = new Map<string, any>()
        for (const row of unique.values()) {
          const p = players.get(row.userId) ?? { userId: row.userId, displayName: row.displayName, count: 0, paid: 0, handCount: 0, handPaid: 0 }
          p.count++; p.paid += row.data.fee
          if (row.handId === handId) { p.handCount++; p.handPaid += row.data.fee }
          players.set(row.userId, p)
        }
        const list = [...players.values()].sort((a,b) => a.userId.localeCompare(b.userId))
        return Promise.resolve([{
          hand: { players: list.filter(p => p.handCount > 0).length, count: list.reduce((n,p) => n+p.handCount,0), paid: list.reduce((n,p) => n+p.handPaid,0) },
          room: { players: list.length, count: list.reduce((n,p) => n+p.count,0), paid: list.reduce((n,p) => n+p.paid,0) },
          players: list.filter(player => tracked.includes(player.userId)),
        }])
      }
      if (query.includes('FROM "GamePokerRoom"')) return Promise.resolve([structuredClone(room)])
      if (query.includes('SELECT "id","handNo","seq","action"')) {
        const terminalOnly = query.includes(`action."action" IN ('check','fold')`) && query.includes("action->>'action' IN ('check','fold')")
        return Promise.resolve(actions.filter(a => a.userId === args[1] && a.isAuto && (!terminalOnly || ["check","fold"].includes(a.action))).sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime() || b.id.localeCompare(a.id)).slice(0,1).map(a=>({...a,handNo:1})))
      }
      return (hallTx.$queryRaw as any)(sql, ...args)
    }
    try { return await work(tx) } catch (e) { arrays.forEach((a,i) => a.splice(0,a.length,...backup.arrays[i])); Object.assign(room,backup.room); throw e }
  }) }
  const poker = new PokerService(prisma, hall)
  for (let i = 0; i < count; i++) {
    const userId = i === 0 ? "u" : `u${i}`, id = `admission-${i}`
    if (i > 0) db.accounts.set(userId, { userId, points: 10000, netProfit: 0, lastGrantAt: null })
    await db.transaction(tx => hall.join(tx, userId, { admissionId: id, gameKind: "poker", gameRoomId: room.id, roomCode: room.code, seatNo: i, buyIn: mode === "practice" ? 0 : 500, funding: mode as "points" | "practice", startCursor: "1" }, now))
    seats.push({ id, userId, roomId: room.id, seatNo: i, participantKind: "human", displayName: userId, stack: 500, status: "waiting", joinedHandNo: 1, controller: "ai", controlVersion: 0, lastSeenAt: now, leavePending: false, sitPending: false })
  }
  await poker.withRoom(room.code, c => startNext(poker, c), now)
  db.locks.length = 0
  return { db, hall, poker, room, seats, hands, participants, actions, receipts, rolls, summaries, archives, now, transact: <T>(fn: (c: RoomContext) => Promise<T>, at = now) => poker.withRoom(room.code, fn, at) }
}
