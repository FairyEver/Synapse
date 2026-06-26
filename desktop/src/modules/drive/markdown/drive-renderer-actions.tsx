import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"

export type DriveRendererAction = {
  readonly id: string
  readonly label: string
  readonly badge?: number
  readonly disabled?: boolean
  readonly onClick: () => void
}

type DriveRendererActionsContextValue = {
  readonly actions: readonly DriveRendererAction[]
  readonly registerAction: (action: DriveRendererAction) => () => void
}

const DriveRendererActionsContext = createContext<DriveRendererActionsContextValue | null>(null)

export function DriveRendererActionsProvider({ children }: { readonly children: ReactNode }) {
  const [actionsById, setActionsById] = useState<ReadonlyMap<string, DriveRendererAction>>(() => new Map())

  const registerAction = useCallback((action: DriveRendererAction) => {
    setActionsById((current) => {
      const next = new Map(current)
      next.set(action.id, action)
      return next
    })

    return () => {
      setActionsById((current) => {
        if (current.get(action.id) !== action) return current
        const next = new Map(current)
        next.delete(action.id)
        return next
      })
    }
  }, [])

  const value = useMemo<DriveRendererActionsContextValue>(() => ({
    actions: Array.from(actionsById.values()),
    registerAction,
  }), [actionsById, registerAction])

  return (
    <DriveRendererActionsContext.Provider value={value}>
      {children}
    </DriveRendererActionsContext.Provider>
  )
}

export function useDriveRendererActions(): DriveRendererActionsContextValue {
  const value = useContext(DriveRendererActionsContext)
  if (!value) throw new Error("DriveRendererActionsProvider is missing.")
  return value
}
