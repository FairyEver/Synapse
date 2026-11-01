import type { RoomContext } from "./poker.service"
import { archiveData } from "./poker-archive.service"
/** Waiting may last past archival; room.handNo remains the authoritative round. */
export async function currentHand(c: RoomContext) {
  const hot = c.room.currentHandId ? await c.tx.gamePokerHand.findUnique({ where: { id: c.room.currentHandId } }) : null
  const cold = !hot && c.room.handNo > 0 ? await c.tx.gamePokerHandArchive.findFirst({ where: { roomId: c.room.id, handNo: c.room.handNo }, select: { data: true } }) : null
  const archived = cold ? archiveData(cold.data) : null
  return { hot, archived, hand: hot ?? archived?.hand ?? null }
}
