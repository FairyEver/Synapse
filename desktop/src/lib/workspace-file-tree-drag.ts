export const WORKSPACE_FILE_TREE_DRAG_TYPE = "application/x-synapse-workspace-file-tree"

export type WorkspaceFileTreeDragPayload = {
  readonly scopeId: string
  readonly relativePaths: readonly string[]
}

export function writeWorkspaceFileTreeDrag(
  dataTransfer: DataTransfer,
  payload: WorkspaceFileTreeDragPayload,
): void {
  dataTransfer.effectAllowed = "copy"
  dataTransfer.setData(WORKSPACE_FILE_TREE_DRAG_TYPE, JSON.stringify(payload))
}

export function hasWorkspaceFileTreeDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer)
    && Array.from(dataTransfer?.types ?? []).includes(WORKSPACE_FILE_TREE_DRAG_TYPE)
}

export function readWorkspaceFileTreeDrag(
  dataTransfer: DataTransfer | null,
): WorkspaceFileTreeDragPayload | null {
  if (!dataTransfer) return null
  try {
    const parsed = JSON.parse(dataTransfer.getData(WORKSPACE_FILE_TREE_DRAG_TYPE)) as unknown
    if (!isRecord(parsed) || typeof parsed.scopeId !== "string" || !Array.isArray(parsed.relativePaths)) return null
    if (parsed.relativePaths.length === 0 || !parsed.relativePaths.every((value) => typeof value === "string")) return null
    return { scopeId: parsed.scopeId, relativePaths: parsed.relativePaths }
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
