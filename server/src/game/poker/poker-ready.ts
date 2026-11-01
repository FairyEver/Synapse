type Seat = { stack: number; status: string; sitPending?: boolean; leavePending?: boolean; participantKind?: string }
export const nextHandEligible = (seat: Seat) => seat.stack > 0 && seat.status !== "sitting_out" && !seat.sitPending && !seat.leavePending
export const preparedForNextHand = (seat: Seat) => nextHandEligible(seat) && (seat.participantKind === "bot" || seat.status === "ready")
