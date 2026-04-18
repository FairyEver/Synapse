import { claudeCodeAdapter } from "./claude-code-adapter"
import { codexAdapter } from "./codex-adapter"
import { cursorAdapter } from "./cursor-adapter"

const editorAdapters = [cursorAdapter, codexAdapter, claudeCodeAdapter] as const

const editorAdapterById = new Map(
  editorAdapters.map((adapter) => [adapter.id, adapter]),
)

export { editorAdapterById, editorAdapters }
