import { useEffect, useRef } from "react"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { REQUIRED_DOCK_APP_ID } from "@/modules/apps/dock"
import { DockAppMenuItems } from "@/modules/apps/components/dock-app-menu-items"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import type { SynapseSystemAppId } from "@/modules/apps/types"

const LAUNCHER_COLUMN_COUNT = 5
const LAUNCHER_REVEAL_DURATION_MS = 400
const LAUNCHER_REVEAL_DELAY_PER_GRID_UNIT_MS = 40
const LAUNCHER_REVEAL_OFFSET_PER_GRID_UNIT_PX = 8
const LAUNCHER_REVEAL_EASING = "cubic-bezier(0.16, 1, 0.3, 1)"

type LauncherRevealMotion = {
  readonly delay: number
  readonly translateX: number
  readonly translateY: number
}

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly focusAppId?: SynapseSystemAppId | null
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
  readonly pinnedAppIds: readonly SynapseSystemAppId[]
  readonly disabled?: boolean
  readonly onPinApp: (appId: SynapseSystemAppId) => void
  readonly onUnpinApp: (appId: SynapseSystemAppId) => void
  readonly onManageDock: () => void
}

function getLauncherRevealMotion(index: number, appCount: number): LauncherRevealMotion {
  const rowCount = Math.ceil(appCount / LAUNCHER_COLUMN_COUNT)
  const column = index % LAUNCHER_COLUMN_COUNT
  const row = Math.floor(index / LAUNCHER_COLUMN_COUNT)
  const centerColumn = (LAUNCHER_COLUMN_COUNT - 1) / 2
  const centerRow = (rowCount - 1) / 2
  const columnOffset = column - centerColumn
  const rowOffset = row - centerRow
  const distanceFromCenter = Math.hypot(columnOffset, rowOffset)

  return {
    delay: Math.round(distanceFromCenter * LAUNCHER_REVEAL_DELAY_PER_GRID_UNIT_MS),
    translateX: columnOffset * -LAUNCHER_REVEAL_OFFSET_PER_GRID_UNIT_PX,
    translateY: rowOffset * -LAUNCHER_REVEAL_OFFSET_PER_GRID_UNIT_PX,
  }
}

export function AppLauncherGrid({
  apps,
  focusAppId = null,
  onManageDock,
  onOpenApp,
  onPinApp,
  onUnpinApp,
  pinnedAppIds,
}: AppLauncherGridProps) {
  const gridRef = useRef<HTMLDivElement>(null)
  const focusTargetRef = useRef<HTMLButtonElement>(null)
  const launcherAppsKey = apps.map((app) => app.id).join("\0")

  useEffect(() => {
    focusTargetRef.current?.focus()
  }, [focusAppId])

  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return undefined

    const launcherItems = gridRef.current?.querySelectorAll<HTMLElement>(
      "[data-app-launcher-item]",
    )
    if (!launcherItems) return undefined

    const animations: Animation[] = []
    launcherItems.forEach((item, index) => {
      if (typeof item.animate !== "function") return
      const motion = getLauncherRevealMotion(index, launcherItems.length)
      animations.push(item.animate([
        {
          opacity: 0,
          transform:
            `translate3d(${motion.translateX}px, ${motion.translateY}px, 0) scale(0.75)`,
        },
        {
          opacity: 1,
          transform: "translate3d(0, 0, 0) scale(1)",
        },
      ], {
        delay: motion.delay,
        duration: LAUNCHER_REVEAL_DURATION_MS,
        easing: LAUNCHER_REVEAL_EASING,
        fill: "backwards",
      }))
    })

    return () => {
      animations.forEach((animation) => animation.cancel())
    }
  }, [launcherAppsKey])

  return (
    <div
      ref={gridRef}
      data-app-launcher-grid
      className="mx-auto grid w-fit grid-cols-5 justify-items-center gap-x-6 gap-y-5"
    >
      {apps.map((app) => {
        const pinned = pinnedAppIds.includes(app.id)
        const removable = app.id !== REQUIRED_DOCK_APP_ID

        return (
          <div
            key={app.id}
            data-app-launcher-item
          >
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div className="group relative h-32 w-32">
                  <button
                    ref={app.id === focusAppId ? focusTargetRef : undefined}
                    type="button"
                    className="flex h-32 w-32 flex-col items-center justify-start rounded-md px-3 py-2 text-center outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
                    onClick={() => onOpenApp(app.id)}
                  >
                    <img
                      src={app.icon}
                      alt=""
                      className="size-20 shrink-0 object-cover transition-transform duration-150 ease-out group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                      draggable={false}
                    />
                    <span className="mt-2.5 flex min-w-0 flex-1 items-start">
                      <span className="block max-w-full truncate text-sm font-medium leading-tight text-foreground">{app.name}</span>
                    </span>
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <DockAppMenuItems
                  appId={app.id}
                  pinned={pinned}
                  removable={removable}
                  itemKind="context"
                  onOpen={onOpenApp}
                  onPin={onPinApp}
                  onUnpin={onUnpinApp}
                  onManageDock={onManageDock}
                />
              </ContextMenuContent>
            </ContextMenu>
          </div>
        )
      })}
    </div>
  )
}
