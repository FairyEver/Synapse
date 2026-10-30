import type { SynapseSystemAppManifest } from "../apps/types"
import { gameHallAppDefinition } from "./app-definition"
import icon from "./assets/icon.svg"
export const gameHallAppManifest = {
  ...gameHallAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
