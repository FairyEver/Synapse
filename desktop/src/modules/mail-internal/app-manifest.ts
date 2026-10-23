import type { SynapseSystemAppManifest } from "../apps/types"
import { mailInternalAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const mailInternalAppManifest = { ...mailInternalAppDefinition, icon } as const satisfies SynapseSystemAppManifest
