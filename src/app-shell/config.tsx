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
import type { SynapseConfig, SynapseConfigPatch, SynapseRepositoryConfig } from "@/types/config"
import { applySynapseConfigPatch, createDefaultConfig, getActiveRepositoryConfig } from "@/lib/config"

type AppConfigContextValue = {
  config: SynapseConfig
  activeRepository: SynapseRepositoryConfig | null
  error: string | null
  isReady: boolean
  refreshConfig: () => Promise<SynapseConfig>
  updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
}

const AppConfigContext = createContext<AppConfigContextValue | null>(null)

async function readConfigFromBridge(): Promise<SynapseConfig> {
  const bridge = window.synapse?.config

  if (!bridge) {
    return createDefaultConfig()
  }

  return bridge.get()
}

async function updateConfigThroughBridge(
  config: SynapseConfig,
  patch: SynapseConfigPatch,
): Promise<SynapseConfig> {
  const bridge = window.synapse?.config

  if (!bridge) {
    return applySynapseConfigPatch(config, patch)
  }

  return bridge.update(patch)
}

function AppConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<SynapseConfig>(() => createDefaultConfig())
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedRef = useRef(false)
  const configRef = useRef(config)

  useEffect(() => {
    configRef.current = config
  }, [config])

  const refreshConfig = useCallback(async () => {
    const nextConfig = await readConfigFromBridge()

    setConfig(nextConfig)
    setError(null)
    setIsReady(true)

    return nextConfig
  }, [])

  const updateConfig = useCallback(
    async (patch: SynapseConfigPatch) => {
      const nextConfig = await updateConfigThroughBridge(configRef.current, patch)

      setConfig(nextConfig)
      setError(null)
      setIsReady(true)

      return nextConfig
    },
    [],
  )

  useEffect(() => {
    if (hasLoadedRef.current) {
      return
    }

    hasLoadedRef.current = true

    void refreshConfig().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "加载本地配置失败")
      setIsReady(true)
    })
  }, [refreshConfig])

  const value = useMemo<AppConfigContextValue>(
    () => ({
      config,
      activeRepository: getActiveRepositoryConfig(config),
      error,
      isReady,
      refreshConfig,
      updateConfig,
    }),
    [config, error, isReady, refreshConfig, updateConfig],
  )

  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>
}

function useAppConfig(): AppConfigContextValue {
  const context = useContext(AppConfigContext)

  if (!context) {
    throw new Error("useAppConfig must be used within AppConfigProvider.")
  }

  return context
}

export { AppConfigProvider, useAppConfig }
