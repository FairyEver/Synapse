import cursorIcon from "../../assets/cursor.png"
import type { SynapseIdeDefinition } from "../types"

export const ideDefinition = {
  id: "cursor",
  label: "Cursor",
  order: 10,
  icon: cursorIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseIdeDefinition
