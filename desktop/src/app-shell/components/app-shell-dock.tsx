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

export function AppShellDock({ apps, value, onValueChange }: AppShellDockProps) {
  return (
    <TooltipProvider>
      <nav data-track="app-shell-dock" className="flex min-w-0 justify-center overflow-hidden">
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
                      className="aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                      aria-label={app.name}
                      aria-current={active ? "page" : undefined}
                      onClick={() => onValueChange(app.id)}
                    >
                      <img src={app.icon} alt="" className="size-5 object-cover" draggable={false} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{app.name}</TooltipContent>
                </Tooltip>
              )
            })}
          </div>
        </ScrollArea>
      </nav>
    </TooltipProvider>
  )
}
