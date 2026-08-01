import ccIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "claude-code",
  label: "CC/Synapse",
  order: 30,
  icon: ccIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
