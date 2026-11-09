import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { skillHubAppDefinition } from "../shared/app-definition"
import icon from "./icon.svg"

export const skillHubAppManifest = {
  ...skillHubAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
