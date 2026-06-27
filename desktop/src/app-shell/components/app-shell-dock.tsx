import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { REQUIRED_DOCK_APP_ID } from "@/modules/apps/dock"
import { DockAppMenuItems } from "@/modules/apps/components/dock-app-menu-items"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type AppShellDockApp = Pick<SynapseSystemAppManifest, "id" | "name" | "icon">
const ignoreDockPin = () => undefined

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseSystemAppId
  readonly onValueChange: (value: SynapseSystemAppId) => void
  readonly disabled?: boolean
  readonly onRemoveApp?: (appId: SynapseSystemAppId) => void
  readonly onManageDock?: () => void
}

export function AppShellDock({
  apps,
  disabled = false,
  onManageDock,
  onRemoveApp,
  value,
  onValueChange,
}: AppShellDockProps) {
  return (
    <TooltipProvider>
      <nav
        data-track="app-shell-dock"
        className="flex min-w-0 justify-center"
      >
        <ScrollArea className="min-w-0 max-w-full" scrollbars="horizontal">
          <div className="flex min-w-max items-center justify-center gap-1">
            {apps.map((app) => {
              const active = app.id === value

              return (
                <DockButton
                  key={app.id}
                  app={app}
                  active={active}
                  disabled={disabled}
                  onManageDock={onManageDock}
                  onRemoveApp={onRemoveApp}
                  onValueChange={onValueChange}
                />
              )
            })}
          </div>
        </ScrollArea>
      </nav>
    </TooltipProvider>
  )
}

function DockButton({
  active,
  app,
  disabled,
  onManageDock,
  onRemoveApp,
  onValueChange,
}: {
  readonly active: boolean
  readonly app: AppShellDockApp
  readonly disabled: boolean
  readonly onManageDock?: () => void
  readonly onRemoveApp?: (appId: SynapseSystemAppId) => void
  readonly onValueChange: (value: SynapseSystemAppId) => void
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="relative h-12 w-11 hover:bg-transparent active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:text-foreground dark:hover:bg-transparent"
      aria-label={app.name}
      aria-current={active ? "page" : undefined}
      onClick={() => onValueChange(app.id)}
    >
      <img src={app.icon} alt="" className="size-10 object-contain" draggable={false} />
      {active ? (
        <span
          data-slot="app-shell-dock-active-indicator"
          aria-hidden="true"
          className="absolute bottom-0 left-1/2 size-1 -translate-x-1/2 rounded-full bg-blue-500"
        />
      ) : null}
    </Button>
  )

  if (!onManageDock && !onRemoveApp) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {button}
        </TooltipTrigger>
        <TooltipContent side="top">{app.name}</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            {button}
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">{app.name}</TooltipContent>
      </Tooltip>
      <ContextMenuContent>
        <DockAppMenuItems
          appId={app.id}
          pinned
          removable={Boolean(onRemoveApp) && app.id !== REQUIRED_DOCK_APP_ID}
          includePinAction={false}
          includeManageAction={Boolean(onManageDock)}
          itemKind="context"
          onOpen={onValueChange}
          onPin={ignoreDockPin}
          onUnpin={(appId) => {
            if (!disabled) {
              onRemoveApp?.(appId)
            }
          }}
          onManageDock={() => {
            if (!disabled) {
              onManageDock?.()
            }
          }}
        />
      </ContextMenuContent>
    </ContextMenu>
  )
}
