import { MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { REQUIRED_DOCK_APP_ID } from "@/modules/apps/dock"
import { DockAppMenuItems } from "@/modules/apps/components/dock-app-menu-items"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import type { SynapseSystemAppId } from "@/modules/apps/types"

type AppLauncherGridProps = {
  readonly apps: readonly SynapseSystemAppManifest[]
  readonly onOpenApp: (appId: SynapseSystemAppManifest["id"]) => void
  readonly pinnedAppIds: readonly SynapseSystemAppId[]
  readonly disabled?: boolean
  readonly onPinApp: (appId: SynapseSystemAppId) => void
  readonly onUnpinApp: (appId: SynapseSystemAppId) => void
  readonly onManageDock: () => void
}

export function AppLauncherGrid({
  apps,
  disabled = false,
  onManageDock,
  onOpenApp,
  onPinApp,
  onUnpinApp,
  pinnedAppIds,
}: AppLauncherGridProps) {
  return (
    <div
      data-app-launcher-grid
      className="mx-auto grid w-fit grid-cols-5 justify-items-center gap-x-8 gap-y-7"
    >
      {apps.map((app) => {
        const pinned = pinnedAppIds.includes(app.id)
        const removable = app.id !== REQUIRED_DOCK_APP_ID

        return (
          <ContextMenu key={app.id}>
            <ContextMenuTrigger asChild>
              <div className="group relative h-36 w-32">
                <button
                  type="button"
                  className="flex h-36 w-32 flex-col items-center justify-start rounded-md px-3 py-3 text-center outline-none transition-[background-color,transform] duration-150 ease-out hover:bg-background/60 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
                  onClick={() => onOpenApp(app.id)}
                >
                  <img
                    src={app.icon}
                    alt=""
                    className="size-22 shrink-0 object-cover transition-transform duration-150 ease-out group-hover:scale-[1.035] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
                    draggable={false}
                  />
                  <span className="mt-3 flex min-w-0 flex-1 items-start">
                    <span className="block max-w-full truncate text-sm font-medium leading-tight text-foreground">{app.name}</span>
                  </span>
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1 size-7 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                      aria-label={`${app.name} 更多操作`}
                      disabled={disabled}
                    >
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DockAppMenuItems
                      appId={app.id}
                      pinned={pinned}
                      removable={removable}
                      itemKind="dropdown"
                      onOpen={onOpenApp}
                      onPin={onPinApp}
                      onUnpin={onUnpinApp}
                      onManageDock={onManageDock}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
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
        )
      })}
    </div>
  )
}
