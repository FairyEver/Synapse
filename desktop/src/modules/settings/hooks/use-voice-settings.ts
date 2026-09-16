import { useCallback, useEffect, useState } from "react"

import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseVoiceSettings, SynapseVoiceSettingsPatch } from "@/types/voice"

const logger = createRendererLogger("voice-settings")

/**
 * 腾讯云语音识别的配置读写。
 *
 * SecretKey 只写不读：主进程回传的是 `hasSecretKey`，不是密钥本身。所以表单里那
 * 一格留空表示「不改」，要清掉得显式点清除。
 */
function useVoiceSettings() {
  const [settings, setSettings] = useState<SynapseVoiceSettings | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const bridge = getSynapseBridge()?.voice
    if (!bridge) {
      setIsLoading(false)
      return undefined
    }
    let mounted = true
    void bridge.settings.get()
      .then((next) => { if (mounted) setSettings(next) })
      .catch((cause: unknown) => {
        logger.warn("Failed to read voice settings.", { error: cause })
        if (mounted) setError("读取失败")
      })
      .finally(() => { if (mounted) setIsLoading(false) })
    return () => { mounted = false }
  }, [])

  const save = useCallback(async (patch: SynapseVoiceSettingsPatch): Promise<boolean> => {
    const bridge = getSynapseBridge()?.voice
    if (!bridge) return false
    setIsSaving(true)
    setError(null)
    try {
      setSettings(await bridge.settings.update(patch))
      return true
    } catch (cause: unknown) {
      logger.warn("Failed to save voice settings.", { error: cause })
      setError("保存失败")
      return false
    } finally {
      setIsSaving(false)
    }
  }, [])

  return { settings, isLoading, isSaving, error, save }
}

export { useVoiceSettings }
