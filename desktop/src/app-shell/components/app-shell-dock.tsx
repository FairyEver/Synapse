import { Fragment, useRef, type RefObject } from "react"
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
import { systemAppPresentation } from "@/modules/apps/app-presentation"
import { REQUIRED_DOCK_APP_ID } from "@/modules/apps/dock"
import { DockAppMenuItems } from "@/modules/apps/components/dock-app-menu-items"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"
import type { SynapseAppId } from "@synapse/shared"

type AppShellDockApp = Pick<SynapseSystemAppManifest, "id" | "name">
const ignoreDockPin = () => undefined
const dockContextMenuCollisionPadding = 12

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseAppId
  readonly onValueChange: (value: SynapseAppId) => void
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
        className="flex w-full min-h-0 flex-col"
      >
        <ScrollArea scrollbars="vertical">
          <div className="flex flex-col items-center gap-1 px-1.5 py-1">
            {apps.map((app, index) => (
              <Fragment key={app.id}>
                {app.id === REQUIRED_DOCK_APP_ID && index > 0 && (
                  <div aria-hidden="true" className="my-1 w-6 border-t border-sidebar-border" />
                )}
                <DockButton
                  app={app}
                  active={app.id === value}
                  disabled={disabled}
                  onManageDock={onManageDock}
                  onRemoveApp={onRemoveApp}
                  onValueChange={onValueChange}
                  launcherButtonRef={launcherButtonRef}
                />
              </Fragment>
            ))}
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
  readonly onValueChange: (value: SynapseAppId) => void
  readonly launcherButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const Icon = systemAppPresentation[app.id].icon
  const button = (
    <Button
      ref={app.id === REQUIRED_DOCK_APP_ID ? launcherButtonRef : undefined}
      type="button"
      variant="ghost"
      size="icon-lg"
      className="size-10 text-muted-foreground aria-[current=page]:bg-selected aria-[current=page]:text-foreground aria-[current=page]:hover:bg-selected"
      aria-label={app.name}
      aria-current={active ? "page" : undefined}
      onClick={() => onValueChange(app.id)}
    >
      <Icon aria-hidden="true" className="size-5" strokeWidth={active ? 2.25 : 1.75} />
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
