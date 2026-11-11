import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { tunnelAppDefinition } from "../shared/app-definition"
import icon from "./icon.svg"
export const tunnelAppManifest = { ...tunnelAppDefinition, icon } as const satisfies SynapseSystemAppManifest
