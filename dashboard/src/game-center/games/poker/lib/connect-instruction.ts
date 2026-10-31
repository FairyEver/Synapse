export function pokerConnectInstruction(roomCode: string) {
  return `通过 Synapse MCP 进入 #${roomCode} 打德州扑克。先读 guide 并查询 overview，按 Skill 安全分段行动，遵守上下文维护和暂停/恢复协议。已有本人座位时复用原座位；只有 handoffPending=true 时通过 control.claim 接受交接，未请求交接的真人座位不得抢权。没有座位时先查询 table.state 读取 handoffPending 和 controlVersion，仅在 handoffPending=true 时调用 seat.join 并携带该 controlVersion；未授权接入时等待用户在牌桌选择接入 AI。`
}
