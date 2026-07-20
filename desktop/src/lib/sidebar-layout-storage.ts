import { createRendererLogger } from "@/app-shell/logging"

const SIDEBAR_WIDTH_STORAGE_PREFIX = "synapse:app:ui:sidebar_width:v1"
const logger = createRendererLogger("ui.sidebar-layout")

type SidebarSizeConstraints = {
  defaultSize: number
  minSize: number
  maxSize: number
}

function clampSidebarSize(size: number, minSize: number, maxSize: number): number {
  return Math.min(maxSize, Math.max(minSize, Math.round(size)))
}

function getSidebarWidthStorageKey(persistenceId: string): string {
  return `${SIDEBAR_WIDTH_STORAGE_PREFIX}:${persistenceId.replaceAll("-", "_")}`
}

function readSidebarWidth(
  persistenceId: string,
  constraints: SidebarSizeConstraints,
): number {
  const fallback = clampSidebarSize(
    constraints.defaultSize,
    constraints.minSize,
    constraints.maxSize,
  )

  if (typeof window === "undefined") return fallback

  try {
    const stored = window.localStorage.getItem(getSidebarWidthStorageKey(persistenceId))
    if (stored === null) return fallback

    const size = Number(stored)
    if (stored.trim() === "" || !Number.isFinite(size)) {
      logger.warn("Ignored invalid persisted sidebar width.", { persistenceId })
      return fallback
    }

    return clampSidebarSize(size, constraints.minSize, constraints.maxSize)
  } catch (error) {
    logger.warn("Failed to read persisted sidebar width.", { persistenceId, error })
    return fallback
  }
}

function writeSidebarWidth(
  persistenceId: string,
  size: number,
  constraints: Pick<SidebarSizeConstraints, "minSize" | "maxSize">,
): void {
  if (typeof window === "undefined" || !Number.isFinite(size)) return

  try {
    window.localStorage.setItem(
      getSidebarWidthStorageKey(persistenceId),
      String(clampSidebarSize(size, constraints.minSize, constraints.maxSize)),
    )
  } catch (error) {
    logger.warn("Failed to persist sidebar width.", { persistenceId, error })
  }
}

export { readSidebarWidth, writeSidebarWidth }
