import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react"
import {
  getRepositoryManager,
  resetRepositoryManager,
  type RepositoryManager,
  type RepositoryOperationState,
} from "@/app-shell/repository-manager"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"

const logger = createRendererLogger("app.repository")

const RepositoryManagerContext = createContext<RepositoryManager | null>(null)

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => getRepositoryManager())
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const initialize = useCallback(() => {
    setError(null)
    let isDisposed = false

    logger.info("Initializing RepositoryManager.")

    void manager
      .initialize()
      .then(() => {
        if (isDisposed) return
        setIsReady(true)
        logger.info("RepositoryManager initialized.")
      })
      .catch((err) => {
        if (isDisposed) return
        logger.error("Failed to initialize RepositoryManager.", err)
        setError("仓库管理器初始化失败")
      })

    return () => {
      isDisposed = true
    }
  }, [manager])

  useEffect(() => {
    const dispose = initialize()
    return () => {
      dispose()
      resetRepositoryManager()
    }
  }, [initialize])

  if (error) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" onClick={() => window.location.reload()}>
            重新加载
          </Button>
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <RepositoryManagerContext.Provider value={manager}>
        {children}
      </RepositoryManagerContext.Provider>
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
