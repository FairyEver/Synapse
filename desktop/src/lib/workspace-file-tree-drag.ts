export const WORKSPACE_FILE_TREE_DRAG_TYPE = "application/x-synapse-workspace-file-tree"

export type WorkspaceFileTreeDragPayload = {
  readonly scopeId: string
  readonly relativePaths: readonly string[]
}

let activeWorkspaceFileTreeDrag: WorkspaceFileTreeDragPayload | null = null

export function writeWorkspaceFileTreeDrag(
  dataTransfer: DataTransfer,
  payload: WorkspaceFileTreeDragPayload,
): void {
  activeWorkspaceFileTreeDrag = clonePayload(payload)
  dataTransfer.effectAllowed = "copy"
  dataTransfer.setData(WORKSPACE_FILE_TREE_DRAG_TYPE, JSON.stringify(payload))
}

export function hasWorkspaceFileTreeDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer) && (
    activeWorkspaceFileTreeDrag !== null
    || Array.from(dataTransfer?.types ?? []).includes(WORKSPACE_FILE_TREE_DRAG_TYPE)
  )
}

export function readWorkspaceFileTreeDrag(
  dataTransfer: DataTransfer | null,
): WorkspaceFileTreeDragPayload | null {
  if (!dataTransfer || !hasWorkspaceFileTreeDrag(dataTransfer)) return null
  try {
    const parsed = JSON.parse(dataTransfer.getData(WORKSPACE_FILE_TREE_DRAG_TYPE)) as unknown
    return parsePayload(parsed) ?? activeWorkspaceFileTreeDrag
  } catch {
    return activeWorkspaceFileTreeDrag
  }
}

export function clearWorkspaceFileTreeDrag(): void {
  activeWorkspaceFileTreeDrag = null
}

function parsePayload(value: unknown): WorkspaceFileTreeDragPayload | null {
  if (!isRecord(value) || typeof value.scopeId !== "string" || !Array.isArray(value.relativePaths)) return null
  if (value.relativePaths.length === 0 || !value.relativePaths.every((path) => typeof path === "string")) return null
  return clonePayload({ scopeId: value.scopeId, relativePaths: value.relativePaths })
}

function clonePayload(payload: WorkspaceFileTreeDragPayload): WorkspaceFileTreeDragPayload {
  return { scopeId: payload.scopeId, relativePaths: [...payload.relativePaths] }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}
