import { createRendererLogger } from "@/app-shell/logging"

const WORKSPACE_PANEL_WIDTH_STORAGE_PREFIX = "synapse:app:ui:workspace_panel_width:v1"
const logger = createRendererLogger("ui.workspace-panel-layout")

export type WorkspacePanelSizeConstraints = {
  readonly defaultSize: number
  readonly minSize: number
  readonly maxSize: number
}

function clampWorkspacePanelSize(size: number, constraints: WorkspacePanelSizeConstraints): number {
  return Math.min(constraints.maxSize, Math.max(constraints.minSize, Math.round(size)))
}

function storageKey(persistenceId: string): string {
  return `${WORKSPACE_PANEL_WIDTH_STORAGE_PREFIX}:${persistenceId.replaceAll("-", "_")}`
}

export function readWorkspacePanelWidth(
  persistenceId: string,
  constraints: WorkspacePanelSizeConstraints,
): number {
  const fallback = clampWorkspacePanelSize(constraints.defaultSize, constraints)
  if (typeof window === "undefined") return fallback

  try {
    const stored = window.localStorage.getItem(storageKey(persistenceId))
    if (stored === null) return fallback
    const size = Number(stored)
    if (stored.trim() === "" || !Number.isFinite(size)) {
      logger.warn("Ignored invalid persisted workspace panel width.", { persistenceId })
      return fallback
    }
    return clampWorkspacePanelSize(size, constraints)
  } catch (error) {
    logger.warn("Failed to read persisted workspace panel width.", { persistenceId, error })
    return fallback
  }
}

export function writeWorkspacePanelWidth(
  persistenceId: string,
  size: number,
  constraints: WorkspacePanelSizeConstraints,
): void {
  if (typeof window === "undefined" || !Number.isFinite(size)) return
  try {
    window.localStorage.setItem(
      storageKey(persistenceId),
      String(clampWorkspacePanelSize(size, constraints)),
    )
  } catch (error) {
    logger.warn("Failed to persist workspace panel width.", { persistenceId, error })
  }
}
