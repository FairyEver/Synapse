import type { SynapseSystemAppManifest } from "../apps/types"
import { todosAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"
export const todosAppManifest = { ...todosAppDefinition, icon } as const satisfies SynapseSystemAppManifest
