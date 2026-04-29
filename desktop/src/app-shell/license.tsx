import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import type {
  SynapseLicenseActivationRequest,
  SynapseLicenseStatus,
} from "@/types/license"

interface LicenseContextValue {
  readonly error: string | null
  readonly isReady: boolean
  readonly status: SynapseLicenseStatus | null
  readonly activate: (payload: SynapseLicenseActivationRequest) => Promise<SynapseLicenseStatus>
  readonly renew: () => Promise<SynapseLicenseStatus>
  readonly refresh: () => Promise<void>
}

const LicenseContext = createContext<LicenseContextValue | null>(null)

export function LicenseProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<SynapseLicenseStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isReady, setIsReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const nextStatus = await requireBridgeDomain("license").getStatus()
      setStatus(nextStatus)
      setError(null)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "无法读取授权状态。")
    } finally {
      setIsReady(true)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const activate = useCallback(async (payload: SynapseLicenseActivationRequest) => {
    const nextStatus = await requireBridgeDomain("license").activate(payload)
    setStatus(nextStatus)
    setError(null)
    return nextStatus
  }, [])

  const renew = useCallback(async () => {
    const nextStatus = await requireBridgeDomain("license").renew()
    setStatus(nextStatus)
    setError(null)
    return nextStatus
  }, [])

  const value = useMemo<LicenseContextValue>(() => ({
    activate,
    error,
    isReady,
    refresh,
    renew,
    status,
  }), [activate, error, isReady, refresh, renew, status])

  return (
    <LicenseContext.Provider value={value}>
      {children}
    </LicenseContext.Provider>
  )
}

export function useLicense() {
  const value = useContext(LicenseContext)
  if (!value) {
    throw new Error("LicenseProvider is required")
  }
  return value
}
