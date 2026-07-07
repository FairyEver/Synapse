import { ArrowLeft, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  SystemAppHeaderSlotProvider,
  useSystemAppHeaderSlot,
} from "./system-app-header-slot"

type EmbeddedSystemAppShellProps = {
  readonly appName: string
  readonly children: ReactNode
  readonly mode?: "launcher" | "dock"
  readonly onBack?: () => void
  readonly onOpenWindow?: () => void
}

function EmbeddedSystemAppShell(props: EmbeddedSystemAppShellProps) {
  return (
    <SystemAppHeaderSlotProvider>
      <EmbeddedSystemAppShellInner {...props} />
    </SystemAppHeaderSlotProvider>
  )
}

function EmbeddedSystemAppShellInner({
  appName,
  children,
  mode = "launcher",
  onBack,
  onOpenWindow,
}: EmbeddedSystemAppShellProps) {
  const { slot } = useSystemAppHeaderSlot()
  const hasTabs = Boolean(slot?.tabs?.length && slot.value && slot.onValueChange)
  const hasActions = Boolean(slot?.actions)
  const launcherMode = mode === "launcher"
  const showHeader = launcherMode || hasTabs || hasActions

  if (!showHeader) {
    return (
      <div className="h-full min-h-0 min-w-0 bg-surface">
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        data-embedded-system-app-header
        className="grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 border-b bg-background px-3"
      >
        <div data-embedded-system-app-left className="flex min-w-0 items-center gap-2">
          {launcherMode ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="返回应用列表"
                onClick={onBack}
              >
                <ArrowLeft />
              </Button>
              <h2 className="truncate text-sm font-semibold">{appName}</h2>
            </>
          ) : null}
        </div>
        {hasTabs ? (
          <div data-embedded-system-app-tabs className="min-w-0 justify-self-center">
            <Tabs value={slot?.value} onValueChange={(next) => slot?.onValueChange?.(next)}>
              <TabsList>
                {slot?.tabs?.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : (
          <div className="min-w-0" aria-hidden="true" />
        )}
        <div data-embedded-system-app-actions className="min-w-0 justify-self-end">
          <div className="flex items-center justify-end gap-2 whitespace-nowrap">
            {slot?.actions}
            {launcherMode ? (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="新窗口打开"
                      onClick={onOpenWindow}
                    >
                      <ExternalLink />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>新窗口打开</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ) : null}
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export { EmbeddedSystemAppShell }
