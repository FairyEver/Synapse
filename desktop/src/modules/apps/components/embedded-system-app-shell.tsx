import { ArrowLeft, ExternalLink } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  SystemAppHeaderSlotProvider,
  useSystemAppHeaderSlot,
} from "./system-app-header-slot"
import { SystemAppTopBar, SystemAppTopBarActionButton } from "./system-app-top-bar"

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
      <SystemAppTopBar
        data-embedded-system-app-header
        leftSlotProps={{ "data-embedded-system-app-left": true }}
        left={launcherMode ? (
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
        center={hasTabs ? (
          <>
            <Tabs value={slot?.value} onValueChange={(next) => slot?.onValueChange?.(next)}>
              <TabsList>
                {slot?.tabs?.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </>
        ) : undefined}
        centerSlotProps={hasTabs ? { "data-embedded-system-app-tabs": true } : undefined}
        actions={(
          <>
            {slot?.actions}
            {launcherMode && onOpenWindow ? (
              <SystemAppTopBarActionButton
                iconOnly
                type="button"
                aria-label="新窗口打开"
                tooltip="新窗口打开"
                onClick={onOpenWindow}
              >
                <ExternalLink />
              </SystemAppTopBarActionButton>
            ) : null}
          </>
        )}
        actionsSlotProps={{ "data-embedded-system-app-actions": true }}
      />
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export { EmbeddedSystemAppShell }
