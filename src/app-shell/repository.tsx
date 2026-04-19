import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type {
  SynapseCreateLocalRepositoryResult,
  SynapseRepositoryInitializationPreview,
  SynapseRepositoryInitializationResult,
  SynapsePendingPushState,
  SynapseRepositoryLocalState,
  SynapseRepositoryOperationKind,
  SynapseRepositoryOperationResult,
} from "@/types/repository"

type RepositoryOperationState = {
  operation: SynapseRepositoryOperationKind | null
  isRunning: boolean
  statusText: string | null
  percent: number | null
  completedAt: string | null
}

type RepositoryManagerContextValue = {
  checkInitializationPreview: (
    repositoryUuid: string,
  ) => Promise<SynapseRepositoryInitializationPreview>
  chooseDirectory: () => Promise<string | null>
  createLocalRepository: (options: {
    name: string
    parentPath: string
  }) => Promise<SynapseCreateLocalRepositoryResult>
  initializeStructure: (
    repositoryUuid: string,
  ) => Promise<SynapseRepositoryInitializationResult>
  hasRepositoryBridge: boolean
  operations: Record<string, RepositoryOperationState>
  pendingPushes: Record<string, SynapsePendingPushState>
  states: Record<string, SynapseRepositoryLocalState>
  flushPendingPushes: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  refreshPendingPushes: (repositoryUuid: string) => Promise<void>
  runMaintenance: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  syncRepository: (repositoryUuid: string) => Promise<SynapseRepositoryOperationResult>
  waitForBackgroundPush: (repositoryUuid: string, timeoutMs?: number) => Promise<void>
  refreshRepositoryStates: () => Promise<void>
}

const RepositoryManagerContext = createContext<RepositoryManagerContextValue | null>(null)
const logger = createRendererLogger("app.repository")
const DEFAULT_BACKGROUND_PUSH_TIMEOUT_MS = 120000

function createFallbackRepositoryState(repositoryUuid: string): SynapseRepositoryLocalState {
  return {
    repositoryUuid,
    localPath: "",
    status: "missing",
    isGitRepository: false,
    gitRootPath: null,
  }
}

function createOperationState(
  value: Partial<RepositoryOperationState> = {},
): RepositoryOperationState {
  return {
    operation: null,
    isRunning: false,
    statusText: null,
    percent: null,
    completedAt: null,
    ...value,
  }
}

function getPreparingStatusText(operation: SynapseRepositoryOperationKind): string {
  switch (operation) {
    case "push":
      return "正在准备推送..."
    case "initialize":
      return "正在准备初始化..."
    case "maintenance":
      return "正在准备整理..."
    default:
      return "正在准备同步..."
  }
}

function getCompletedStatusText(operation: SynapseRepositoryOperationKind): string {
  switch (operation) {
    case "push":
      return "同步完成。"
    case "initialize":
      return "初始化完成。"
    case "maintenance":
      return "整理完成。"
    default:
      return "仓库同步完成。"
  }
}

function toStateMap(
  repositoryStates: SynapseRepositoryLocalState[],
): Record<string, SynapseRepositoryLocalState> {
  return Object.fromEntries(
    repositoryStates.map((state) => [state.repositoryUuid, state]),
  )
}

function filterRecordByRepositoryIds<T>(
  record: Record<string, T>,
  repositoryIds: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).filter(([repositoryUuid]) => repositoryIds.has(repositoryUuid)),
  )
}

async function readRepositoryStates(
  repositoryUuids: string[],
): Promise<SynapseRepositoryLocalState[]> {
  const bridge = getSynapseBridge()

  if (!bridge) {
    logger.warn("Repository bridge is unavailable while reading states.")
    return repositoryUuids.map(createFallbackRepositoryState)
  }

  return bridge.repository.getStates()
}

function RepositoryManagerProvider({ children }: { children: ReactNode }) {
  const { config } = useAppConfig()
  const [states, setStates] = useState<Record<string, SynapseRepositoryLocalState>>({})
  const [operations, setOperations] = useState<Record<string, RepositoryOperationState>>({})
  const [pendingPushes, setPendingPushes] = useState<Record<string, SynapsePendingPushState>>({})
  const hasRepositoryBridge = Boolean(getSynapseBridge())
  const operationsRef = useRef<Record<string, RepositoryOperationState>>({})

  const repositoryIds = useMemo(
    () => config.repositories.map((repository) => repository.uuid),
    [config.repositories],
  )

  useEffect(() => {
    operationsRef.current = operations
  }, [operations])

  const refreshRepositoryStates = useCallback(async () => {
    logger.debug("Refreshing repository states.", {
      repositoryCount: repositoryIds.length,
    })
    const nextStates = await readRepositoryStates(repositoryIds)

    setStates(toStateMap(nextStates))
    logger.debug("Repository states refreshed.", {
      repositoryCount: nextStates.length,
    })
  }, [repositoryIds])

  useEffect(() => {
    const repositoryIdSet = new Set(repositoryIds)

    setStates((currentStates) => filterRecordByRepositoryIds(currentStates, repositoryIdSet))
    setOperations((currentOperations) => filterRecordByRepositoryIds(currentOperations, repositoryIdSet))
    setPendingPushes((currentPendingPushes) => filterRecordByRepositoryIds(currentPendingPushes, repositoryIdSet))
  }, [repositoryIds])

  useEffect(() => {
    logger.info("Repository bridge status resolved.", {
      hasRepositoryBridge,
    })
  }, [hasRepositoryBridge])

  useEffect(() => {
    void refreshRepositoryStates().catch((error) => {
      logger.error("Failed to refresh repository states.", error)
    })
  }, [refreshRepositoryStates])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.repository.onProgress((progressEvent) => {
      setOperations((currentOperations) => ({
        ...currentOperations,
        [progressEvent.repositoryUuid]: createOperationState({
          ...currentOperations[progressEvent.repositoryUuid],
          operation: progressEvent.operation,
          isRunning: true,
          statusText: progressEvent.statusText,
          percent: progressEvent.percent,
        }),
      }))
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.repository.onUpdated((updatedEvent) => {
      logger.info("Received repository updated event.", updatedEvent)
      setOperations((currentOperations) => ({
        ...currentOperations,
        [updatedEvent.repositoryUuid]: createOperationState({
          ...currentOperations[updatedEvent.repositoryUuid],
          operation: updatedEvent.operation,
          isRunning: false,
          statusText: updatedEvent.error
            ? (updatedEvent.message ?? null)
            : (updatedEvent.message ?? getCompletedStatusText(updatedEvent.operation)),
          percent: updatedEvent.error ? null : 100,
          completedAt: updatedEvent.completedAt,
        }),
      }))

      void refreshRepositoryStates().catch((error) => {
        logger.error("Failed to refresh repository states after repository update.", error)
      })
    })

    return () => {
      unsubscribe?.()
    }
  }, [refreshRepositoryStates])

  const refreshPendingPushes = useCallback(
    async (repositoryUuid: string) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        return
      }

      const nextPendingPushes = await bridge.repository.getPendingPushes(repositoryUuid)

      setPendingPushes((currentPendingPushes) => ({
        ...currentPendingPushes,
        [repositoryUuid]: nextPendingPushes,
      }))
    },
    [],
  )

  const checkInitializationPreview = useCallback(
    async (repositoryUuid: string) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        throw new Error("当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。")
      }

      return bridge.repository.checkInitializationPreview(repositoryUuid)
    },
    [],
  )

  const initializeStructure = useCallback(
    async (repositoryUuid: string) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        throw new Error("当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。")
      }

      const result = await bridge.repository.initializeStructure(repositoryUuid)

      setStates((currentStates) => ({
        ...currentStates,
        [repositoryUuid]: result.repository,
      }))
      setOperations((currentOperations) => ({
        ...currentOperations,
        [repositoryUuid]: createOperationState({
          ...currentOperations[repositoryUuid],
          operation: "initialize",
          isRunning: false,
          statusText: result.message ?? "初始化完成。",
          percent: 100,
          completedAt: result.initializedAt,
        }),
      }))

      await refreshPendingPushes(repositoryUuid)

      return result
    },
    [refreshPendingPushes],
  )

  const chooseDirectory = useCallback(async () => {
    const bridge = getSynapseBridge()

    if (!bridge) {
      return null
    }

    return bridge.repository.chooseDirectory()
  }, [])

  const createLocalRepository = useCallback(
    async (options: { name: string; parentPath: string }) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        throw new Error("当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。")
      }

      return bridge.repository.createLocalRepository(options)
    },
    [],
  )

  useEffect(() => {
    if (!config.activeRepoUuid) {
      return
    }

    void refreshPendingPushes(config.activeRepoUuid).catch((error) => {
      logger.error("Failed to refresh pending pushes.", error)
    })
  }, [config.activeRepoUuid, refreshPendingPushes])

  useEffect(() => {
    const unsubscribe = getSynapseBridge()?.repository.onPendingPushesUpdated((updatedEvent) => {
      setPendingPushes((currentPendingPushes) => ({
        ...currentPendingPushes,
        [updatedEvent.repositoryUuid]: updatedEvent.pendingPushes,
      }))
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const runRepositoryOperation = useCallback(
    async (repositoryUuid: string, operation: SynapseRepositoryOperationKind) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        const errorMessage = "当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。"
        logger.error("Repository operation requested without repository bridge.", {
          repositoryUuid,
          operation,
        })

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation,
            isRunning: false,
            statusText: null,
            percent: null,
          }),
        }))

        throw new Error(errorMessage)
      }

      setOperations((currentOperations) => ({
        ...currentOperations,
        [repositoryUuid]: createOperationState({
          ...currentOperations[repositoryUuid],
          operation,
          isRunning: true,
          statusText: getPreparingStatusText(operation),
          percent: 0,
        }),
      }))

      try {
        logger.info("Starting repository operation.", {
          repositoryUuid,
          operation,
        })
        const result =
          operation === "sync"
            ? await bridge.repository.sync(repositoryUuid)
            : operation === "maintenance"
              ? await bridge.repository.runMaintenance(repositoryUuid)
            : await bridge.repository.flushPendingPushes(repositoryUuid)

        setStates((currentStates) => ({
          ...currentStates,
          [repositoryUuid]: result.repository,
        }))

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation: result.operation,
            isRunning: false,
            statusText: result.message ?? getCompletedStatusText(result.operation),
            percent: 100,
            completedAt: result.completedAt,
          }),
        }))

        logger.info("Repository operation completed.", {
          repositoryUuid,
          operation: result.operation,
          completedAt: result.completedAt,
        })
        return result
      } catch (error) {
        const message = error instanceof Error ? error.message : "Git 仓库操作失败。"
        logger.error("Repository operation failed.", {
          repositoryUuid,
          operation,
          error,
        })

        setOperations((currentOperations) => ({
          ...currentOperations,
          [repositoryUuid]: createOperationState({
            ...currentOperations[repositoryUuid],
            operation,
            isRunning: false,
            statusText: null,
            percent: null,
          }),
        }))

        throw error
      }
    },
    [],
  )

  const waitForBackgroundPush = useCallback(
    async (repositoryUuid: string, timeoutMs = DEFAULT_BACKGROUND_PUSH_TIMEOUT_MS) => {
      const bridge = getSynapseBridge()

      if (!bridge) {
        throw new Error("当前运行实例还没有加载仓库能力桥接。请重新加载窗口或重启 Synapse 后再试。")
      }

      return new Promise<void>((resolve, reject) => {
        let settled = false

        const cleanup = () => {
          window.clearTimeout(timeoutId)
          unsubscribeUpdated()
        }

        const settle = (callback: () => void) => {
          if (settled) {
            return
          }

          settled = true
          cleanup()
          callback()
        }

        const timeoutId = window.setTimeout(() => {
          settle(() => {
            reject(new Error("等待仓库同步超时，请稍后查看右上角同步状态。"))
          })
        }, timeoutMs)

        const unsubscribeUpdated = bridge.repository.onUpdated((updatedEvent) => {
          if (updatedEvent.repositoryUuid !== repositoryUuid || updatedEvent.operation !== "push") {
            return
          }

          if (updatedEvent.error) {
            settle(() => {
              reject(new Error(updatedEvent.error ?? updatedEvent.message ?? "同步变更失败。"))
            })
            return
          }

          settle(resolve)
        })

        void bridge.repository.getPendingPushes(repositoryUuid)
          .then((pendingState) => {
            const isPushRunning =
              operationsRef.current[repositoryUuid]?.isRunning
              && operationsRef.current[repositoryUuid]?.operation === "push"

            if (pendingState.count === 0 && !isPushRunning) {
              settle(resolve)
            }
          })
          .catch((error) => {
            settle(() => {
              reject(error instanceof Error ? error : new Error("读取同步状态失败。"))
            })
          })
      })
    },
    [],
  )

  const value = useMemo<RepositoryManagerContextValue>(
    () => ({
      checkInitializationPreview,
      chooseDirectory,
      createLocalRepository,
      initializeStructure,
      hasRepositoryBridge,
      operations,
      pendingPushes,
      states,
      flushPendingPushes: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "push"),
      refreshPendingPushes,
      runMaintenance: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "maintenance"),
      syncRepository: (repositoryUuid: string) => runRepositoryOperation(repositoryUuid, "sync"),
      waitForBackgroundPush,
      refreshRepositoryStates,
    }),
    [
      checkInitializationPreview,
      chooseDirectory,
      createLocalRepository,
      hasRepositoryBridge,
      initializeStructure,
      operations,
      pendingPushes,
      refreshPendingPushes,
      refreshRepositoryStates,
      runRepositoryOperation,
      states,
      waitForBackgroundPush,
    ],
  )

  return (
    <RepositoryManagerContext.Provider value={value}>
      {children}
    </RepositoryManagerContext.Provider>
  )
}

function useRepositoryManager(): RepositoryManagerContextValue {
  const context = useContext(RepositoryManagerContext)

  if (!context) {
    throw new Error("useRepositoryManager must be used within RepositoryManagerProvider.")
  }

  return context
}

export {
  RepositoryManagerProvider,
  useRepositoryManager,
  type RepositoryOperationState,
}
