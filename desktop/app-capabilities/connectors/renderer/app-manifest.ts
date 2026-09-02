import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { connectorsAppDefinition } from "./app-definition"
import icon from "./assets/connector.png"

export const connectorsAppManifest = { ...connectorsAppDefinition, icon } as const satisfies SynapseSystemAppManifest
