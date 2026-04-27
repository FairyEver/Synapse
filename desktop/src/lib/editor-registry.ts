import { editorDefinitions } from "@/definitions/generated/renderer-registry"
import type { SynapseEditorId } from "@/types/editor"

const EDITOR_ORDER: SynapseEditorId[] = editorDefinitions.map((definition) => definition.id)

const EDITOR_LABELS = Object.fromEntries(
  editorDefinitions.map((definition) => [definition.id, definition.label]),
) as Record<SynapseEditorId, string>

function getEditorLabel(editorId: SynapseEditorId): string {
  return EDITOR_LABELS[editorId] ?? editorId
}

export { editorDefinitions, EDITOR_LABELS, EDITOR_ORDER, getEditorLabel }
