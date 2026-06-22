import { useEffect, useMemo, type ReactNode } from "react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  useOptionalSystemAppHeaderSlot,
  type SystemAppHeaderSlotState,
  type SystemAppHeaderSlotTab,
} from "./system-app-header-slot"

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
}

function SystemAppWindowShell<T extends string>({
  tabs,
  value,
  onValueChange,
  actions,
  children,
}: SystemAppWindowShellProps<T>) {
  const hasTabs = tabs !== undefined
  const embeddedHeaderSlot = useOptionalSystemAppHeaderSlot()
  const setEmbeddedHeaderSlot = embeddedHeaderSlot?.setSlot
  const slotState = useMemo<SystemAppHeaderSlotState>(() => ({
    tabs: hasTabs ? tabs : undefined,
    value: hasTabs ? value : undefined,
    onValueChange: hasTabs ? (nextValue: string) => onValueChange(nextValue as T) : undefined,
    actions,
  }), [actions, hasTabs, onValueChange, tabs, value])

  useEffect(() => {
    if (!setEmbeddedHeaderSlot) return undefined
    setEmbeddedHeaderSlot(slotState)
    return () => {
      setEmbeddedHeaderSlot(null)
    }
  }, [setEmbeddedHeaderSlot, slotState])

  if (embeddedHeaderSlot) {
    return (
      <div className="h-full min-h-0 min-w-0 bg-surface">
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div
        data-system-app-window-toolbar
        className="grid min-h-10 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,max-content)_minmax(0,1fr)] items-center gap-2 border-b bg-background px-3"
      >
        <div data-system-app-window-left-spacer className="min-w-0" aria-hidden="true" />
        {hasTabs ? (
          <div data-system-app-window-tabs className="min-w-0 justify-self-center">
            <Tabs value={value} onValueChange={(next) => onValueChange(next as T)}>
              <TabsList>
                {tabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id} disabled={tab.disabled}>{tab.label}</TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        ) : (
          <div className="min-w-0" aria-hidden="true" />
        )}
        <div data-system-app-window-actions className="min-w-0 justify-self-end">
          {actions ? <div className="flex flex-wrap items-center justify-end gap-2">{actions}</div> : null}
        </div>
      </div>
      <div className="min-h-0 min-w-0 flex-1">
        {children}
      </div>
    </div>
  )
}

export { SystemAppWindowShell }
export type { SystemAppWindowTab }
