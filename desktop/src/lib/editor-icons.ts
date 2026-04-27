import type { SynapseEditorId } from "@/types/editor"
import { editorDefinitions } from "@/definitions/generated/renderer-registry"

const editorIconMap = new Map<string, string>(
  editorDefinitions.map((definition) => [definition.id, definition.icon]),
)

const EDITOR_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

function getEditorIconSrc(editorId: SynapseEditorId): string | undefined {
  return editorIconMap.get(editorId)
}

export { EDITOR_ICON_CLIP_STYLE, getEditorIconSrc }
