import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type DriveRendererToolbarItem =
  | {
      readonly kind: 'status'
      readonly id: string
      readonly label: string
    }
  | {
      readonly kind: 'button'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly variant?: 'default' | 'outline' | 'secondary' | 'ghost'
      readonly disabled?: boolean
      readonly loading?: boolean
      readonly href?: string
      readonly external?: boolean
      readonly onClick?: () => void
    }
  | {
      readonly kind: 'toggle'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly pressed: boolean
      readonly disabled?: boolean
      readonly onPressedChange: (pressed: boolean) => void
    }
  | {
      readonly kind: 'menu'
      readonly id: string
      readonly label: string
      readonly icon?: LucideIcon
      readonly items: readonly DriveRendererToolbarMenuItem[]
    }

export type DriveRendererToolbarMenuItem = {
  readonly id: string
  readonly label: string
  readonly disabled?: boolean
  readonly onSelect: () => void
}

export type DriveRendererToolbarContextValue = {
  readonly items: readonly DriveRendererToolbarItem[]
  readonly registerItems: (scope: string, items: readonly DriveRendererToolbarItem[]) => () => void
  readonly clearScope: (scope: string) => void
}

const DriveRendererToolbarContext = createContext<DriveRendererToolbarContextValue | null>(null)

export function DriveRendererToolbarProvider({ children }: { readonly children: ReactNode }) {
  const [itemsByScope, setItemsByScope] = useState<ReadonlyMap<string, readonly DriveRendererToolbarItem[]>>(() => new Map())

  const clearScope = useCallback((scope: string) => {
    setItemsByScope((current) => {
      if (!current.has(scope)) return current
      const next = new Map(current)
      next.delete(scope)
      return next
    })
  }, [])

  const registerItems = useCallback((scope: string, items: readonly DriveRendererToolbarItem[]) => {
    setItemsByScope((current) => {
      const next = new Map(current)
      next.set(scope, items)
      return next
    })
    return () => clearScope(scope)
  }, [clearScope])

  const items = useMemo(
    () => Array.from(itemsByScope.values()).flat(),
    [itemsByScope],
  )

  const value = useMemo<DriveRendererToolbarContextValue>(() => ({
    items,
    registerItems,
    clearScope,
  }), [clearScope, items, registerItems])

  return (
    <DriveRendererToolbarContext.Provider value={value}>
      {children}
    </DriveRendererToolbarContext.Provider>
  )
}

export function useDriveRendererToolbar(): DriveRendererToolbarContextValue {
  const value = useContext(DriveRendererToolbarContext)
  if (!value) throw new Error('useDriveRendererToolbar must be used inside DriveRendererToolbarProvider')
  return value
}
