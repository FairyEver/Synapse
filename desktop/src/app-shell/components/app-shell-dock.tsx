import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { SynapseSystemAppId, SynapseSystemAppManifest } from "@/modules/apps/types"

type AppShellDockApp = Pick<SynapseSystemAppManifest, "id" | "name" | "icon">

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseSystemAppId
  readonly onValueChange: (value: SynapseSystemAppId) => void
}

export function AppShellDock({
  apps,
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
                <Tooltip key={app.id}>
                  <TooltipTrigger asChild>
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
                  </TooltipTrigger>
                  <TooltipContent side="top">{app.name}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </ScrollArea>
      </nav>
    </TooltipProvider>
  )
}
