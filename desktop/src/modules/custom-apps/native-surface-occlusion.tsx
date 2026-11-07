import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react"

import { getSynapseBridge } from "@/lib/electron-bridge"

type OcclusionContextValue = {
  readonly acquire: () => () => void
}

const NativeSurfaceOcclusionContext = createContext<OcclusionContextValue | null>(null)

export function NativeSurfaceOcclusionProvider({ children }: { readonly children: ReactNode }) {
  const countRef = useRef(0)

  const setOccluded = useCallback((occluded: boolean) => {
    const customApps = getSynapseBridge()?.customApps
    void customApps?.view.setOccluded(occluded)
  }, [])

  const acquire = useCallback(() => {
    countRef.current += 1
    if (countRef.current === 1) setOccluded(true)
    let released = false
    return () => {
      if (released) return
      released = true
      countRef.current = Math.max(0, countRef.current - 1)
      if (countRef.current === 0) setOccluded(false)
    }
  }, [setOccluded])

  const value = useMemo(() => ({ acquire }), [acquire])
  return (
    <NativeSurfaceOcclusionContext.Provider value={value}>
      {children}
    </NativeSurfaceOcclusionContext.Provider>
  )
}

export function useNativeSurfaceOcclusion(open = true): void {
  const context = useContext(NativeSurfaceOcclusionContext)
  useEffect(() => {
    if (!open) return undefined
    return context?.acquire()
  }, [context, open])
}

export function NativeSurfaceOcclusionBoundary({ open = true }: { readonly open?: boolean }) {
  useNativeSurfaceOcclusion(open)
  return null
}
