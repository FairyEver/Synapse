import { GAME_TOOLS } from "@synapse/shared/game-contracts"
export const POKER_PRIVATE_UI_OPERATIONS = [
  {
    id: "app.game.poker.control.set",
    name: "",
    description: "本人接管、请求或取消AI托管",
    mutates: true,
    inputSchema: {
      type: "object",
      properties: {
        roomCode: { type: "string", pattern: "^[0-9]{4,6}$" },
        controlVersion: { type: "integer", minimum: 0, maximum: 2147483647 },
        action: { type: "string", enum: ["takeover", "request_ai", "cancel_ai"] },
      },
      required: ["roomCode", "controlVersion", "action"],
      additionalProperties: false,
    },
  },
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
        "app.game.poker.table.wait",
        "app.game.poker.control.claim",
        "app.game.poker.checkpoint.get",
        "app.game.poker.checkpoint.save",
      ].includes(t.id),
  ),
  ...POKER_PRIVATE_UI_OPERATIONS,
]

// Human UI actions never carry agent-only decision notes or persona selection.
export const POKER_HUMAN_ACTION_SCHEMA = (() => {
  const action = GAME_TOOLS.find(t => t.id === "app.game.poker.action.act")!
  const { note: _note, personaSource: _personaSource, ...properties } = action.inputSchema.properties
  return { ...action.inputSchema, properties }
})()
