import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import icon from "./assets/icon.png"
import { meetingAppDefinition } from "./app-definition"

export const meetingAppManifest = {
  ...meetingAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
