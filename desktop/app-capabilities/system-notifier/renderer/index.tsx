import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CircleAlert } from "lucide-react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertTitle } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type {
  SynapseSystemNotifierSettings,
  SynapseSystemNotifierSettingsPatch,
} from "../../../src/types/system-notifier"

const logger = createRendererLogger("system-notifier.app")

export function SystemNotifierModule() {
  const bridge = useMemo(() => requireBridgeDomain("systemNotifier"), [])
  const [settings, setSettings] = useState<SynapseSystemNotifierSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState(false)
  const testingRef = useRef(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setLoadError(false)
    setSaveError(false)
    setTestError(false)
    try {
      setSettings(await bridge.settings.get())
    } catch {
      logger.error("System notifier settings load failed.")
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }, [bridge])

  useEffect(() => {
    void reload()
  }, [reload])

  const updateSettings = useCallback(async (patch: SynapseSystemNotifierSettingsPatch) => {
    if (!settings || saving) return
    const finishTracking = startTrackedOperation({ component: "system-notifier", eventKey: "system-notifier.settings.update" })
    const previous = settings
    setSaveError(false)
    setTestError(false)
    setSettings({ ...settings, ...patch })
    setSaving(true)
    try {
      setSettings(await bridge.settings.update(patch))
      finishTracking("success")
    } catch {
      finishTracking("failure")
      logger.error("System notifier settings update failed.")
      setSettings(previous)
      setSaveError(true)
    } finally {
      setSaving(false)
    }
  }, [bridge, saving, settings])

  const testNotification = useCallback(async () => {
    if (testingRef.current || saving) return
    const finishTracking = startTrackedOperation({ component: "system-notifier", eventKey: "system-notifier.notification.test" })
    testingRef.current = true
    setTestError(false)
    setTesting(true)
    try {
      await bridge.notification.test()
      finishTracking("success")
    } catch {
      finishTracking("failure")
      logger.error("System notifier test IPC failed.")
      setTestError(true)
    } finally {
      testingRef.current = false
      setTesting(false)
    }
  }, [bridge, saving])

  return (
    <SystemAppWindowShell>
      <div className="mx-auto flex h-full w-full max-w-lg items-center p-3 sm:p-5">
        {loading ? (
          <SystemNotifierSkeleton />
        ) : loadError ? (
          <Alert variant="destructive">
            <CircleAlert />
            <AlertTitle>加载失败</AlertTitle>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 w-fit"
              onClick={() => void reload()}
            >
              重试
            </Button>
          </Alert>
        ) : settings ? (
          <Card className="w-full rounded-lg py-0">
            <CardContent className="grid gap-4 p-4 sm:p-5">
              <SettingRow
                id="system-notifier-enabled"
                label="启用通知"
                checked={settings.enabled}
                disabled={saving}
                onCheckedChange={(enabled) => void updateSettings({ enabled })}
              />
              <SettingRow
                id="system-notifier-silent"
                label="静音通知"
                checked={settings.silent}
                disabled={saving}
                onCheckedChange={(silent) => void updateSettings({ silent })}
              />
              <Button
                data-track="system-notifier.notification.test"
                type="button"
                variant="outline"
                disabled={saving || testing}
                aria-busy={testing}
                onClick={() => void testNotification()}
              >
                发送测试通知
              </Button>
              {saveError ? (
                <p className="text-sm text-destructive" role="alert">保存失败</p>
              ) : null}
              {testError ? (
                <p className="text-sm text-destructive" role="alert">
                  无法发起测试，请重试
                </p>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </SystemAppWindowShell>
  )
}

function SettingRow(props: {
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly disabled: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={props.id} className="text-sm font-medium">
        {props.label}
      </label>
      <Switch
        id={props.id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={(checked) => props.onCheckedChange(checked === true)}
      />
    </div>
  )
}

function SystemNotifierSkeleton() {
  return (
    <Card className="w-full rounded-lg py-0">
      <CardContent className="grid gap-4 p-4 sm:p-5">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-9 w-full" />
      </CardContent>
    </Card>
  )
}
