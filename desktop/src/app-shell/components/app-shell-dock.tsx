import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { DragEvent } from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { SYSTEM_APP_DOCK_DRAG_TYPE } from "@/modules/apps/dock-drag"
import { isSystemAppId, type SynapseSystemAppId, type SynapseSystemAppManifest } from "@/modules/apps/types"

type AppShellDockApp = Pick<SynapseSystemAppManifest, "id" | "name" | "icon">

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseSystemAppId
  readonly onValueChange: (value: SynapseSystemAppId) => void
  readonly onPinApp?: (value: SynapseSystemAppId) => void
  readonly canUnpinApp?: (value: SynapseSystemAppId) => boolean
  readonly onUnpinApp?: (value: SynapseSystemAppId) => void
}

export function AppShellDock({
  apps,
  value,
  onValueChange,
  onPinApp,
  canUnpinApp,
  onUnpinApp,
}: AppShellDockProps) {
  const handleDragOver = (event: DragEvent<HTMLElement>) => {
    if (!onPinApp) return
    const appId = event.dataTransfer.getData(SYSTEM_APP_DOCK_DRAG_TYPE)
    if (!isSystemAppId(appId)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "move"
  }

  const handleDrop = (event: DragEvent<HTMLElement>) => {
    if (!onPinApp) return
    const appId = event.dataTransfer.getData(SYSTEM_APP_DOCK_DRAG_TYPE)
    if (!isSystemAppId(appId)) return
    event.preventDefault()
    onPinApp(appId)
  }

  return (
    <TooltipProvider>
      <nav
        data-track="app-shell-dock"
        className="flex min-w-0 justify-center"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        <ScrollArea className="min-w-0 max-w-full" scrollbars="horizontal">
          <div className="flex min-w-max items-center justify-center gap-1 pb-1.5">
            {apps.map((app) => {
              const active = app.id === value
              const unpinnable = Boolean(canUnpinApp?.(app.id) && onUnpinApp)

              return (
                <ContextMenu key={app.id}>
                  <Tooltip>
                    <ContextMenuTrigger asChild>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="relative size-11 hover:bg-transparent active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:text-foreground dark:hover:bg-transparent"
                          aria-label={app.name}
                          aria-current={active ? "page" : undefined}
                          data-can-unpin={unpinnable ? "true" : undefined}
                          onClick={() => onValueChange(app.id)}
                        >
                          <img src={app.icon} alt="" className="size-10 object-contain" draggable={false} />
                          {active ? (
                            <span
                              data-slot="app-shell-dock-active-indicator"
                              aria-hidden="true"
                              className="absolute bottom-0 left-1/2 size-1.5 -translate-x-1/2 rounded-full bg-blue-500"
                            />
                          ) : null}
                        </Button>
                      </TooltipTrigger>
                    </ContextMenuTrigger>
                    <TooltipContent side="top">{app.name}</TooltipContent>
                  </Tooltip>
                  {unpinnable ? (
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => onUnpinApp?.(app.id)}>
                        取消固定
                      </ContextMenuItem>
                    </ContextMenuContent>
                  ) : null}
                </ContextMenu>
              )
            })}
          </div>
        </ScrollArea>
      </nav>
    </TooltipProvider>
  )
}
