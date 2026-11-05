import { useEffect, useMemo, type ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useOptionalSystemAppHeaderSlot,
  type SystemAppHeaderSlotState,
  type SystemAppHeaderSlotTab,
} from "./system-app-header-slot"
import { SystemAppTopBar } from "./system-app-top-bar"

type SystemAppWindowTab<T extends string = string> = SystemAppHeaderSlotTab & {
  readonly id: T
}

type SystemAppWindowShellTabProps<T extends string = string> = {
  readonly tabs: readonly SystemAppWindowTab<T>[]
  readonly value: T
  readonly onValueChange: (value: T) => void
}

type SystemAppWindowShellSingleViewProps = {
  readonly tabs?: undefined
  readonly value?: never
  readonly onValueChange?: never
}

type SystemAppWindowShellProps<T extends string = string> = (SystemAppWindowShellTabProps<T> | SystemAppWindowShellSingleViewProps) & {
  readonly actions?: ReactNode
  readonly children: ReactNode
  readonly embeddedLeftAddon?: ReactNode
  readonly left?: ReactNode
  readonly headerMode?: SystemAppHeaderSlotState["headerMode"]
  readonly immersive?: boolean
}

function SystemAppWindowShell<T extends string>({
  tabs,
  value,
  onValueChange,
  actions,
  children,
  embeddedLeftAddon,
  left,
  headerMode = "default",
  immersive = false,
}: SystemAppWindowShellProps<T>) {
  const hasTabs = tabs !== undefined
  const embeddedHeaderSlot = useOptionalSystemAppHeaderSlot()
  const setEmbeddedHeaderSlot = embeddedHeaderSlot?.setSlot
  const slotState = useMemo<SystemAppHeaderSlotState>(() => immersive ? { immersive: true } : ({
    headerMode,
    left: headerMode === "replace" ? left : undefined,
    leftAddon: embeddedLeftAddon,
    tabs: hasTabs ? tabs : undefined,
    value: hasTabs ? value : undefined,
    onValueChange: hasTabs ? (nextValue: string) => onValueChange(nextValue as T) : undefined,
    actions,
  }), [actions, embeddedLeftAddon, hasTabs, headerMode, immersive, left, onValueChange, tabs, value])

  useEffect(() => {
    if (!setEmbeddedHeaderSlot) return undefined
    setEmbeddedHeaderSlot(slotState)
    return () => {
      setEmbeddedHeaderSlot(null)
    }
  }, [setEmbeddedHeaderSlot, slotState])

  if (embeddedHeaderSlot) {
    return (
      <div data-system-app-immersive={immersive || undefined} className="h-full min-h-0 min-w-0 bg-surface">
        {children}
      </div>
    )
  }

  if (immersive || (!hasTabs && !actions && !left && headerMode !== "replace")) {
    return (
      <div data-system-app-immersive={immersive || undefined} className="h-full min-h-0 min-w-0 bg-surface">
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <SystemAppTopBar
        data-system-app-window-toolbar
        left={left}
        leftSlotProps={left ? {
          "data-system-app-window-left": true,
        } : {
          "data-system-app-window-left-spacer": true,
          "aria-hidden": true,
        }}
        center={hasTabs ? (
          <>
            <Tabs value={value} onValueChange={(next) => onValueChange(next as T)}>
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>{tab.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </>
        ) : undefined}
        centerSlotProps={hasTabs ? { "data-system-app-window-tabs": true } : undefined}
        actions={actions}
        actionsSlotProps={{ "data-system-app-window-actions": true }}
      />
      <div className="min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export { SystemAppWindowShell }
export type { SystemAppWindowTab }
