import icon from "./assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { editorScanAppDefinition } from "./app-definition"

export const editorScanAppManifest = {
  ...editorScanAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
