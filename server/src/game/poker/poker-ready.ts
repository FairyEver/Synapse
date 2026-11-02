type Seat = { userId?: string; stack: number; status: string; sitPending?: boolean; leavePending?: boolean; participantKind?: string }
export const nextHandEligible = (seat: Seat) => seat.stack > 0 && seat.status !== "sitting_out" && !seat.sitPending && !seat.leavePending
type ReadyRoom = { handNo: number; ownerUserId: string }
export const preparedForNextHand = (seat: Seat, room: ReadyRoom) => nextHandEligible(seat) && (seat.participantKind === "bot" || seat.status === "ready" || (room.handNo === 0 && seat.userId === room.ownerUserId))
