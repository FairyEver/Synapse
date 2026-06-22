import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react"

type SystemAppHeaderSlotTab = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
}

type SystemAppHeaderSlotState = {
  readonly tabs?: readonly SystemAppHeaderSlotTab[]
  readonly value?: string
  readonly onValueChange?: (value: string) => void
  readonly actions?: ReactNode
}

type SystemAppHeaderSlotContextValue = {
  readonly slot: SystemAppHeaderSlotState | null
  readonly setSlot: (slot: SystemAppHeaderSlotState | null) => void
}

const SystemAppHeaderSlotContext = createContext<SystemAppHeaderSlotContextValue | null>(null)

function SystemAppHeaderSlotProvider({ children }: { readonly children: ReactNode }) {
  const [slot, setSlotState] = useState<SystemAppHeaderSlotState | null>(null)
  const setSlot = useCallback((nextSlot: SystemAppHeaderSlotState | null) => {
    setSlotState(nextSlot)
  }, [])
  const value = useMemo(
    () => ({ slot, setSlot }),
    [setSlot, slot],
  )

  return (
    <SystemAppHeaderSlotContext.Provider value={value}>
      {children}
    </SystemAppHeaderSlotContext.Provider>
  )
}

function useOptionalSystemAppHeaderSlot(): SystemAppHeaderSlotContextValue | null {
  return useContext(SystemAppHeaderSlotContext)
}

function useSystemAppHeaderSlot(): SystemAppHeaderSlotContextValue {
  const context = useOptionalSystemAppHeaderSlot()
  if (!context) {
    throw new Error("System app header slot is not available.")
  }
  return context
}

export {
  SystemAppHeaderSlotProvider,
  useOptionalSystemAppHeaderSlot,
  useSystemAppHeaderSlot,
}
export type {
  SystemAppHeaderSlotState,
  SystemAppHeaderSlotTab,
}
