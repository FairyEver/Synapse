import { z } from "zod"
import { POKER_RESPONSE_SCHEMAS } from "./game-poker-response-schemas.js"

const points = z
  .object({ total: z.number(), available: z.number(), inPlay: z.number(), pending: z.number().optional(), netProfit: z.number() })
  .passthrough()
const game = z
  .object({
    id: z.string(),
    name: z.string(),
    icon: z.string(),
    entry: z.string(),
    status: z.string(),
  })
  .passthrough()
const session = z
  .object({
    funding: z.enum(["points", "practice"]).optional(),
    game: z.string(),
    gameName: z.string(),
    roomCode: z.string().nullable(),
    seatNo: z.number().nullable(),
    status: z.string(),
    needsAction: z.boolean(),
    deadlineMs: z.number().nullable(),
  })
  .passthrough()

// Games register their own output contracts; the cloud proxy only resolves this map.
export const GAME_RESPONSE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  "app.game.hall.overview": z
    .object({
      points,
      games: z.array(game),
      sessions: z.array(session),
      next: z
        .object({ game: z.string(), roomCode: z.string().nullable() })
        .passthrough()
        .nullable(),
    })
    .passthrough(),
  "app.game.hall.guide": z
    .object({
      points: z
        .object({ initial: z.number(), grant: z.number(), grantIntervalHours: z.number() })
        .passthrough(),
      overview: z.string(),
      games: z.array(game),
    })
    .passthrough(),
  "app.game.hall.account": points.extend({
    recent: z.array(
      z
        .object({
          gameKind: z.string(),
          roomCode: z.string().nullable(),
          buyIn: z.number(),
          returned: z.number().nullable(),
          status: z.string(),
          lastActiveAt: z.string(),
        })
        .passthrough(),
    ),
  }),
  ...POKER_RESPONSE_SCHEMAS,
}
