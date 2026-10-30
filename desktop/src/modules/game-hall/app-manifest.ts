import type { SynapseSystemAppManifest } from "../apps/types"
import { gameHallAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"
export const gameHallAppManifest = {
  ...gameHallAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
