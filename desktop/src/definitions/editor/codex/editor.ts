import codexIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "codex",
  label: "Codex",
  order: 20,
  icon: codexIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["rule", "skill"],
} as const satisfies SynapseEditorDefinition
