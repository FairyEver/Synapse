import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react"
import {
  getRepositoryManager,
  resetRepositoryManager,
  type RepositoryManager,
  type RepositoryOperationState,
} from "@/app-shell/repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { LoaderCircle } from "lucide-react"

const logger = createRendererLogger("app.repository")

const RepositoryManagerContext = createContext<RepositoryManager | null>(null)

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => getRepositoryManager())
  const [initError, setInitError] = useState<string | null>(null)
  const [isRetrying, setIsRetrying] = useState(false)

  const initialize = useCallback(() => {
    setInitError(null)
    setIsRetrying(true)

    void manager
      .initialize()
      .then(() => {
        logger.info("RepositoryManager initialized.")
      })
      .catch((error) => {
        logger.error("Failed to initialize RepositoryManager.", error)
        setInitError(error instanceof Error ? error.message : "初始化失败。")
      })
      .finally(() => {
        setIsRetrying(false)
      })
  }, [manager])

  useEffect(() => {
    logger.info("Initializing RepositoryManager.")
    initialize()

    return () => {
      resetRepositoryManager()
    }
  }, [initialize])

  if (initError) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background px-6 py-10">
        <div className="flex w-full max-w-md flex-col gap-4 rounded-xl border border-border bg-card p-6">
          <h1 className="text-lg font-medium text-foreground">无法初始化</h1>
          <p className="text-sm text-muted-foreground">{initError}</p>
          <Button variant="outline" disabled={isRetrying} onClick={initialize}>
            {isRetrying ? <LoaderCircle className="mr-2 size-4 animate-spin" /> : null}
            重试
          </Button>
        </div>
      </main>
    )
  }

  return (
    <RepositoryManagerContext.Provider value={manager}>
      {children}
    </RepositoryManagerContext.Provider>
  )
}

function useRepositoryManager(): RepositoryManager {
  const context = useContext(RepositoryManagerContext)

  if (!context) {
    throw new Error("useRepositoryManager must be used within RepositoryManagerProvider.")
  }

  return context
}

export {
  RepositoryManagerProvider,
  useRepositoryManager,
}

export type { RepositoryOperationState } from "@/app-shell/repository-manager"
