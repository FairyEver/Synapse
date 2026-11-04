import { useRef, type RefObject } from "react"
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
const dockContextMenuCollisionPadding = 12

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseSystemAppId
  readonly onValueChange: (value: SynapseSystemAppId) => void
  readonly disabled?: boolean
  readonly onRemoveApp?: (appId: SynapseSystemAppId) => Promise<boolean>
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
  const launcherButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <TooltipProvider>
      <nav
        aria-label="Dock"
        data-track="app-shell-dock"
        className="flex min-h-0 flex-col"
      >
        <ScrollArea scrollbars="vertical">
          <div className="flex flex-col items-center gap-0">
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
                  launcherButtonRef={launcherButtonRef}
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
  launcherButtonRef,
}: {
  readonly active: boolean
  readonly app: AppShellDockApp
  readonly disabled: boolean
  readonly onManageDock?: () => void
  readonly onRemoveApp?: (appId: SynapseSystemAppId) => Promise<boolean>
  readonly onValueChange: (value: SynapseSystemAppId) => void
  readonly launcherButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const button = (
    <Button
      ref={app.id === REQUIRED_DOCK_APP_ID ? launcherButtonRef : undefined}
      type="button"
      variant="ghost"
      size="icon"
      className="relative size-12 shrink-0 hover:bg-transparent active:bg-transparent aria-[current=page]:bg-transparent aria-[current=page]:text-foreground dark:hover:bg-transparent"
      aria-label={app.name}
      aria-current={active ? "page" : undefined}
      onClick={() => onValueChange(app.id)}
    >
      <img src={app.icon} alt="" className="size-10 object-contain" draggable={false} />
      {active ? (
        <span
          data-slot="app-shell-dock-active-indicator"
          aria-hidden="true"
          className="absolute top-1/2 left-0 size-1 -translate-y-1/2 rounded-full bg-blue-500"
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
        <TooltipContent side="right">{app.name}</TooltipContent>
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
        <TooltipContent side="right">{app.name}</TooltipContent>
      </Tooltip>
      <ContextMenuContent collisionPadding={dockContextMenuCollisionPadding}>
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
              void onRemoveApp?.(appId).finally(() => {
                setTimeout(() => launcherButtonRef.current?.focus(), 0)
              })
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
