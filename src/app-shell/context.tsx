import { createContext, useContext } from "react"

export type AppTabId = "rules" | "skills" | "settings"

export type AppShellContextValue = {
  activeTab: AppTabId
  setActiveTab: (tab: AppTabId) => void
  requestRefresh: () => void
  refreshRequestCount: number
  lastRefreshRequestedAt: number | null
  isRefreshBlocked: boolean
  setRefreshBlock: (blockId: string, blocked: boolean) => void
}

const AppShellContext = createContext<AppShellContextValue | null>(null)

export const AppShellProvider = AppShellContext.Provider

export function useAppShell() {
  const context = useContext(AppShellContext)

  if (!context) {
    throw new Error("useAppShell must be used within AppShellProvider")
  }

  return context
}
