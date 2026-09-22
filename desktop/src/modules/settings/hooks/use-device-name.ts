import { useCallback, useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import { liveDeviceNameSchema } from "@/types/live-device-settings"

const logger = createRendererLogger("settings.device-name")

export function useDeviceName() {
  const [draft, setDraft] = useState("")
  const [saved, setSaved] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(null)
    const bridge = getSynapseBridge()?.live
    const request = bridge ? bridge.getDeviceSettings() : Promise.reject(new Error("桌面连接不可用"))
    void request.then(({ name }) => {
      if (active) {
        setDraft(name)
        setSaved(name)
      }
    }).catch((cause: unknown) => {
      logger.warn("Failed to load device name.", { cause })
      if (active) setError("读取设备名称失败，请重试")
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [revision])

  const save = useCallback(async () => {
    if (saving || loading) return
    const parsed = liveDeviceNameSchema.safeParse(draft)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "设备名称无效")
      return
    }
    setSaving(true)
    setError(null)
    try {
      const bridge = getSynapseBridge()?.live
      if (!bridge) throw new Error("桌面连接不可用")
      const result = await bridge.setDeviceName({ name: parsed.data })
      setSaved(result.name)
      setDraft(result.name)
      logger.info("Device name saved.")
    } catch (cause) {
      logger.warn("Failed to save device name.", { cause })
      setError("保存设备名称失败，请重试")
    } finally {
      setSaving(false)
    }
  }, [draft, loading, saving])

  return {
    draft, loading, saving, error, save,
    canSave: !loading && !saving && draft.trim() !== saved,
    loadFailed: !loading && !saved && Boolean(error),
    retry: () => setRevision((value) => value + 1),
    change: (value: string) => {
      setDraft(value)
      setError(null)
    },
  }
}
