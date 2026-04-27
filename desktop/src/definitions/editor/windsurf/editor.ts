import windsurfIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "windsurf",
  label: "Windsurf",
  order: 40,
  icon: windsurfIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
