import type { SynapseEditorId } from "@/types/editor"
import { editorDefinitions } from "@/definitions/generated/renderer-registry"

const editorIconMap = new Map<string, string>(
  editorDefinitions.map((definition) => [definition.id, definition.icon]),
)

function getEditorIconSrc(editorId: SynapseEditorId): string | undefined {
  return editorIconMap.get(editorId)
}

export { getEditorIconSrc }
