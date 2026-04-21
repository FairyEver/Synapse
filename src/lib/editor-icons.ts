import ccIcon from "@/assets/cc.png"
import codexIcon from "@/assets/codex.png"
import cursorIcon from "@/assets/cursor.png"
import type { SynapseEditorId } from "@/types/editor"

const editorIconMap: Record<SynapseEditorId, string> = {
  "claude-code": ccIcon,
  codex: codexIcon,
  cursor: cursorIcon,
}

const EDITOR_ICON_CLIP_STYLE: React.CSSProperties = { clipPath: "inset(6%)" }

function getEditorIconSrc(editorId: SynapseEditorId): string | undefined {
  return editorIconMap[editorId]
}

export { EDITOR_ICON_CLIP_STYLE, getEditorIconSrc }
