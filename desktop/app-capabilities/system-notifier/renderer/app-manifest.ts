import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../sound-notifier/renderer/assets/icon.png"
import { systemNotifierAppDefinition } from "./app-definition"

export const systemNotifierAppManifest = {
  ...systemNotifierAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
