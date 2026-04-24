import ccIcon from "../../assets/cc.png"
import type { SynapseIdeDefinition } from "../types"

export const ideDefinition = {
  id: "claude-code",
  label: "Claude Code",
  order: 30,
  icon: ccIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseIdeDefinition
