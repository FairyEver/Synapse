import { z } from "zod"
import { POKER_HUMAN_ACTION_SCHEMA } from "../games/poker/shared/ui-operations"
import { GAME_TOOLS } from "@synapse/shared/game-contracts"
import type { IpcModule, IpcMethodDescriptor } from "../../../electron/runtime/ipc/types"
import type { PermissionGuard, AuditSink } from "../../../electron/runtime/security"
import { GAME_SERVICE_ID, GAME_PRIVATE_UI_OPERATIONS } from "../shared/capability"
import type { GameHallService } from "./service"
import { createGameDispatcher } from "./dispatcher"
function method(operation: string): IpcMethodDescriptor {
  const definition = [...GAME_TOOLS, ...GAME_PRIVATE_UI_OPERATIONS].find((t) => t.id === operation)!
  const request =
    operation === "app.game.poker.table.state"
      ? z
          .object({
            roomCode: z.string().regex(/^\d{4,6}$/),
            perspective: z.enum(["owner", "public"]).optional(),
          })
          .strict()
      : z.fromJSONSchema((operation === "app.game.poker.action.act" ? POKER_HUMAN_ACTION_SCHEMA : definition.inputSchema) as Parameters<typeof z.fromJSONSchema>[0])
  return {
    operationId: operation as IpcMethodDescriptor["operationId"],
    kind: "invoke",
    request,
    response: z.object({
      ok: z.boolean(),
      data: z.unknown().optional(),
      error: z.string().optional(),
      code: z.string().optional(),
    }),
    async handler(ctx, input) {
      return createGameDispatcher({
        service: ctx.resolve<GameHallService>(GAME_SERVICE_ID),
        permissionGuard: ctx.resolve<PermissionGuard>("core.permission-guard"),
        auditSink: ctx.resolve<AuditSink>("core.audit-sink"),
      }).dispatch(operation, input as Record<string, unknown>, {
        source: "api",
        actor: { kind: "user", id: "game-hall-ui" },
      })
    },
  }
}
export const gameIpcModule: IpcModule = {
  id: "game",
  methods: {
    hallOverview: { ...method("app.game.hall.overview"), operationId: "app.game.hall.overview" },
    hallGuide: { ...method("app.game.hall.guide"), operationId: "app.game.hall.guide" },
    hallAccount: { ...method("app.game.hall.account"), operationId: "app.game.hall.account" },
    pokerGuide: { ...method("app.game.poker.guide"), operationId: "app.game.poker.guide" },
    pokerLobbyList: {
      ...method("app.game.poker.lobby.list"),
      operationId: "app.game.poker.lobby.list",
    },
    pokerRoomCreate: {
      ...method("app.game.poker.room.create"),
      operationId: "app.game.poker.room.create",
    },
    pokerRoomClose: {
      ...method("app.game.poker.room.close"),
      operationId: "app.game.poker.room.close",
    },
    pokerBotAdd: { ...method("app.game.poker.bot.add"), operationId: "app.game.poker.bot.add" },
    pokerBotRemove: { ...method("app.game.poker.bot.remove"), operationId: "app.game.poker.bot.remove" },
    pokerRoomGet: { ...method("app.game.poker.room.get"), operationId: "app.game.poker.room.get" },
    pokerSeatJoin: { ...method("app.game.poker.seat.join"), operationId: "app.game.poker.seat.join" },
    pokerActionAct: { ...method("app.game.poker.action.act"), operationId: "app.game.poker.action.act" },
    pokerControlSet: { ...method("app.game.poker.control.set"), operationId: "app.game.poker.control.set" },
    pokerTableEvents: { ...method("app.game.poker.table.events"), operationId: "app.game.poker.table.events" },
    pokerSeatLeave: {
      ...method("app.game.poker.seat.leave"),
      operationId: "app.game.poker.seat.leave",
    },
    pokerSeatSit: { ...method("app.game.poker.seat.sit"), operationId: "app.game.poker.seat.sit" },
    pokerSeatNudge: {
      ...method("app.game.poker.seat.nudge"),
      operationId: "app.game.poker.seat.nudge",
    },
    pokerTableState: {
      ...method("app.game.poker.table.state"),
      operationId: "app.game.poker.table.state",
    },
    pokerAgentList: {
      ...method("app.game.poker.agent.list"),
      operationId: "app.game.poker.agent.list",
    },
    pokerAgentUpsert: {
      ...method("app.game.poker.agent.upsert"),
      operationId: "app.game.poker.agent.upsert",
    },
    pokerAgentVersions: {
      ...method("app.game.poker.agent.versions"),
      operationId: "app.game.poker.agent.versions",
    },
    pokerHandHistory: {
      ...method("app.game.poker.hand.history"),
      operationId: "app.game.poker.hand.history",
    },
    pokerHandDetail: {
      ...method("app.game.poker.hand.detail"),
      operationId: "app.game.poker.hand.detail",
    },
    pokerStatsGet: {
      ...method("app.game.poker.stats.get"),
      operationId: "app.game.poker.stats.get",
    },
  },
  events: {},
}
