import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { textFileWriterAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const textFileWriterAppManifest = {
  ...textFileWriterAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
