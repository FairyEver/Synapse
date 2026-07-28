import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import type {
  FilePreviewToolbarItem,
  FilePreviewToolbarMenuItem,
} from '@/features/file-browser/preview/file-preview-toolbar'

export type DriveRendererToolbarItem = FilePreviewToolbarItem
export type DriveRendererToolbarMenuItem = FilePreviewToolbarMenuItem

export type DriveRendererToolbarContextValue = {
  readonly items: readonly DriveRendererToolbarItem[]
  readonly hasUnsavedChanges: boolean
  readonly registerItems: (scope: string, items: readonly DriveRendererToolbarItem[]) => () => void
  readonly registerUnsavedState: (scope: string, dirty: boolean) => () => void
  readonly clearScope: (scope: string) => void
}

const DriveRendererToolbarContext = createContext<DriveRendererToolbarContextValue | null>(null)
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

export function DriveRendererToolbarProvider({ children }: { readonly children: ReactNode }) {
  const [itemsByScope, setItemsByScope] = useState<ReadonlyMap<string, readonly DriveRendererToolbarItem[]>>(() => new Map())
  const [unsavedByScope, setUnsavedByScope] = useState<ReadonlyMap<string, boolean>>(() => new Map())

  const clearScope = useCallback((scope: string) => {
    setItemsByScope((current) => {
      if (!current.has(scope)) return current
      const next = new Map(current)
      next.delete(scope)
      return next
    })
    setUnsavedByScope((current) => {
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

  const registerUnsavedState = useCallback((scope: string, dirty: boolean) => {
    setUnsavedByScope((current) => {
      if (current.get(scope) === dirty) return current
      const next = new Map(current)
      next.set(scope, dirty)
      return next
    })
    return () => clearScope(scope)
  }, [clearScope])

  const items = useMemo(
    () => Array.from(itemsByScope.values()).flat(),
    [itemsByScope],
  )
  const hasUnsavedChanges = useMemo(
    () => Array.from(unsavedByScope.values()).some(Boolean),
    [unsavedByScope],
  )

  const value = useMemo<DriveRendererToolbarContextValue>(() => ({
    hasUnsavedChanges,
    items,
    registerItems,
    registerUnsavedState,
    clearScope,
  }), [clearScope, hasUnsavedChanges, items, registerItems, registerUnsavedState])

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

export function useOptionalDriveRendererToolbar(): DriveRendererToolbarContextValue | null {
  return useContext(DriveRendererToolbarContext)
}

export function useRegisterDriveRendererToolbarItems(
  scope: string,
  items: readonly DriveRendererToolbarItem[],
): void {
  const toolbar = useOptionalDriveRendererToolbar()
  const registerItems = toolbar?.registerItems
  useIsoLayoutEffect(() => {
    if (!registerItems) return undefined
    return registerItems(scope, items)
  }, [items, registerItems, scope])
}

export function useRegisterDriveRendererUnsavedState(scope: string, dirty: boolean): void {
  const toolbar = useOptionalDriveRendererToolbar()
  const registerUnsavedState = toolbar?.registerUnsavedState
  useIsoLayoutEffect(() => {
    if (!registerUnsavedState) return undefined
    return registerUnsavedState(scope, dirty)
  }, [dirty, registerUnsavedState, scope])
}
