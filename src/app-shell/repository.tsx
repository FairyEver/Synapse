import { createContext, type ReactNode, useContext, useEffect, useState } from "react"
import {
  getRepositoryManager,
  resetRepositoryManager,
  type RepositoryManager,
  type RepositoryOperationState,
} from "@/app-shell/repository-manager"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("app.repository")

const RepositoryManagerContext = createContext<RepositoryManager | null>(null)

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const [manager] = useState(() => getRepositoryManager())
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    logger.info("Initializing RepositoryManager.")

    void manager
      .initialize()
      .then(() => {
        setIsReady(true)
        logger.info("RepositoryManager initialized.")
      })
      .catch((error) => {
        logger.error("Failed to initialize RepositoryManager.", error)
      })

    return () => {
      resetRepositoryManager()
    }
  }, [manager])

  if (!isReady) {
    // 可以在这里显示 loading 状态，或者让子组件处理未就绪状态
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
