import hermesIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "hermes",
  label: "Hermes",
  order: 60,
  icon: hermesIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
