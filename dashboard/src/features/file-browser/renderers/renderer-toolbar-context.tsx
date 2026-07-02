import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export type FileRendererToolbarItem =
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
      readonly onClick?: () => void
    }

export type FileRendererToolbarContextValue = {
  readonly items: readonly FileRendererToolbarItem[]
  readonly registerItems: (scope: string, items: readonly FileRendererToolbarItem[]) => () => void
  readonly clearScope: (scope: string) => void
}

const FileRendererToolbarContext = createContext<FileRendererToolbarContextValue | null>(null)
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function FileRendererToolbarProvider({ children }: { readonly children: ReactNode }) {
  const [itemsByScope, setItemsByScope] = useState<ReadonlyMap<string, readonly FileRendererToolbarItem[]>>(() => new Map())

  const clearScope = useCallback((scope: string) => {
    setItemsByScope((current) => {
      if (!current.has(scope)) return current
      const next = new Map(current)
      next.delete(scope)
      return next
    })
  }, [])

  const registerItems = useCallback((scope: string, items: readonly FileRendererToolbarItem[]) => {
    setItemsByScope((current) => {
      const next = new Map(current)
      next.set(scope, items)
      return next
    })
    return () => clearScope(scope)
  }, [clearScope])

  const items = useMemo(() => Array.from(itemsByScope.values()).flat(), [itemsByScope])
  const value = useMemo<FileRendererToolbarContextValue>(() => ({
    items,
    registerItems,
    clearScope,
  }), [clearScope, items, registerItems])

  return (
    <FileRendererToolbarContext.Provider value={value}>
      {children}
    </FileRendererToolbarContext.Provider>
  )
}

export function useFileRendererToolbar(): FileRendererToolbarContextValue {
  const value = useContext(FileRendererToolbarContext)
  if (!value) throw new Error('useFileRendererToolbar must be used inside FileRendererToolbarProvider')
  return value
}

export function useOptionalFileRendererToolbar(): FileRendererToolbarContextValue | null {
  return useContext(FileRendererToolbarContext)
}

export function useRegisterFileRendererToolbarItems(
  scope: string,
  items: readonly FileRendererToolbarItem[],
): void {
  const toolbar = useOptionalFileRendererToolbar()
  const registerItems = toolbar?.registerItems
  useIsoLayoutEffect(() => {
    if (!registerItems) return undefined
    return registerItems(scope, items)
  }, [items, registerItems, scope])
}
