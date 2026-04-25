import windsurfIcon from "./icon.png"
import type { SynapseIdeDefinition } from "../types"

export const ideDefinition = {
  id: "windsurf",
  label: "Windsurf",
  order: 40,
  icon: windsurfIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseIdeDefinition
