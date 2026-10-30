import { GAME_TOOLS } from "@synapse/shared/game-contracts"
export const POKER_PRIVATE_UI_OPERATIONS = [
  {
    id: "app.game.poker.room.close",
    name: "",
    description: "房主请求本手结束后解散",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: { roomCode: { type: "string", pattern: "^[0-9]{4,6}$" } },
      required: ["roomCode"],
      additionalProperties: false,
    },
  },
]
export const POKER_UI_OPERATIONS = [
  ...GAME_TOOLS.filter(
    (t) =>
      t.id.startsWith("app.game.poker.") &&
      ![
        "app.game.poker.action.act",
        "app.game.poker.table.wait",
        "app.game.poker.seat.join",
      ].includes(t.id),
  ),
  ...POKER_PRIVATE_UI_OPERATIONS,
]
