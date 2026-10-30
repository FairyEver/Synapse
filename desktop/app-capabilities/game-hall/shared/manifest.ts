import { z } from "zod"
import type { MainAppCapabilityManifest } from "../../manifest"
export const GAME_OPEN_HANDLER = "game-hall.open"
export const gameHallCapabilityManifest = {
  id: "game-hall",
  deepLinks: [],
  pathRoutes: [
    {
      path: "game-hall",
      action: "open",
      mainHandlerId: GAME_OPEN_HANDLER,
      paramsSchema: z.object({}).strict(),
    },
    {
      path: "game-hall/poker/:roomCode",
      action: "open",
      mainHandlerId: GAME_OPEN_HANDLER,
      defaults: { entry: "/poker" },
      paramsSchema: z
        .object({ entry: z.literal("/poker"), roomCode: z.string().regex(/^\d{4,6}$/) })
        .strict(),
    },
  ],
} as const satisfies MainAppCapabilityManifest
