import type { SynapseEditorId } from "@/types/editor"

const EDITOR_ORDER: SynapseEditorId[] = ["claude-code", "cursor", "codex"]

const EDITOR_LABELS: Record<SynapseEditorId, string> = {
  "claude-code": "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
}

function getEditorLabel(editorId: SynapseEditorId): string {
  return EDITOR_LABELS[editorId] ?? editorId
}

export { EDITOR_LABELS, EDITOR_ORDER, getEditorLabel }
