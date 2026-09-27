import type { SynapseSystemAppManifest } from "../apps/types"
import { mailAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

export const mailAppManifest = { ...mailAppDefinition, icon } as const satisfies SynapseSystemAppManifest
