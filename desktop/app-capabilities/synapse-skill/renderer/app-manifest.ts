import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { synapseSkillAppDefinition } from "./app-definition"
import icon from "./assets/icon.png"

const synapseSkillAppManifest = {
  ...synapseSkillAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest

export { synapseSkillAppManifest }
