import type { SynapseSystemAppManifest } from "../apps/types"
import { todosAppDefinition } from "./app-definition"
import icon from "./assets/icon.svg"
export const todosAppManifest = { ...todosAppDefinition, icon } as const satisfies SynapseSystemAppManifest
