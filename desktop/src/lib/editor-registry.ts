import { ideDefinitions } from "@/ide-definitions/generated/renderer-registry"
import type { SynapseEditorId } from "@/types/editor"

const EDITOR_ORDER: SynapseEditorId[] = ideDefinitions.map((definition) => definition.id)

const EDITOR_LABELS = Object.fromEntries(
  ideDefinitions.map((definition) => [definition.id, definition.label]),
) as Record<SynapseEditorId, string>

function getEditorLabel(editorId: SynapseEditorId): string {
  return EDITOR_LABELS[editorId] ?? editorId
}

export { EDITOR_LABELS, EDITOR_ORDER, getEditorLabel }
