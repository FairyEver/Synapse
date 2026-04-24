import codexIcon from "../../assets/codex.png"
import type { SynapseIdeDefinition } from "../types"

export const ideDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  icon: codexIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseIdeDefinition
