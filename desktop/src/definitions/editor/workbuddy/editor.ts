import workbuddyIcon from "./icon.png"
import type { SynapseEditorDefinition } from "../../types"

export const editorDefinition = {
  id: "workbuddy",
  label: "WorkBuddy",
  order: 70,
  icon: workbuddyIcon,
  supportsGlobal: true,
  supportsProject: true,
  supportedContentTypes: ["skill"],
} as const satisfies SynapseEditorDefinition
