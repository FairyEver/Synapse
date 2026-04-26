import { useCallback, useEffect, useState } from "react"
import { Loader2, RefreshCw, RotateCcw, Save } from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { SettingsGroup } from "@/modules/settings/components/settings-group"
import type {
  SynapseCcConnectAttachmentSend,
  SynapseCcConnectLogLevel,
  SynapseCcConnectSettings,
  SynapseLocale,
} from "@/types/config"

const LANGUAGE_OPTIONS: SynapseLocale[] = ["en", "zh", "zh-TW", "ja", "es"]
const ATTACHMENT_OPTIONS: SynapseCcConnectAttachmentSend[] = ["", "on", "off"]
const LOG_LEVEL_OPTIONS: SynapseCcConnectLogLevel[] = ["debug", "info", "warn", "error"]

type CcConnectFormState = Omit<
  SynapseCcConnectSettings,
  | "lastReloadAt"
  | "lastRestartRequestedAt"
  | "idleTimeoutMins"
  | "thinkingMaxLen"
  | "toolMaxLen"
  | "streamPreviewIntervalMs"
  | "rateLimitMaxMessages"
  | "rateLimitWindowSecs"
> & {
  idleTimeoutMins: string
  thinkingMaxLen: string
  toolMaxLen: string
  streamPreviewIntervalMs: string
  rateLimitMaxMessages: string
  rateLimitWindowSecs: string
}

function formFromSettings(settings: SynapseCcConnectSettings): CcConnectFormState {
  return {
    language: settings.language,
    attachmentSend: settings.attachmentSend,
    logLevel: settings.logLevel,
    idleTimeoutMins: String(settings.idleTimeoutMins),
    thinkingMessages: settings.thinkingMessages,
    thinkingMaxLen: String(settings.thinkingMaxLen),
    toolMessages: settings.toolMessages,
    toolMaxLen: String(settings.toolMaxLen),
    streamPreviewEnabled: settings.streamPreviewEnabled,
    streamPreviewIntervalMs: String(settings.streamPreviewIntervalMs),
    rateLimitMaxMessages: String(settings.rateLimitMaxMessages),
    rateLimitWindowSecs: String(settings.rateLimitWindowSecs),
  }
}

function numberFromInput(value: string): number {
  return Number.parseInt(value.trim(), 10)
}

function CcConnectSettingsPanel() {
  const [form, setForm] = useState<CcConnectFormState | null>(null)
  const [rawToml, setRawToml] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartOpen, setRestartOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const config = requireBridgeDomain("config")
      const [settings, raw] = await Promise.all([
        config.getCcConnectSettings(),
        config.getCcConnectRawConfig(),
      ])
      setForm(formFromSettings(settings))
      setRawToml(raw.content)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "读取 CC Connect 设置失败。")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async () => {
    if (!form) {
      return
    }
    setSaving(true)
    setError(null)
    try {
      const settings = await requireBridgeDomain("config").updateCcConnectSettings({
        language: form.language,
        attachmentSend: form.attachmentSend,
        logLevel: form.logLevel,
        idleTimeoutMins: numberFromInput(form.idleTimeoutMins),
        thinkingMessages: form.thinkingMessages,
        thinkingMaxLen: numberFromInput(form.thinkingMaxLen),
        toolMessages: form.toolMessages,
        toolMaxLen: numberFromInput(form.toolMaxLen),
        streamPreviewEnabled: form.streamPreviewEnabled,
        streamPreviewIntervalMs: numberFromInput(form.streamPreviewIntervalMs),
        rateLimitMaxMessages: numberFromInput(form.rateLimitMaxMessages),
        rateLimitWindowSecs: numberFromInput(form.rateLimitWindowSecs),
      })
      const raw = await requireBridgeDomain("config").getCcConnectRawConfig()
      setForm(formFromSettings(settings))
      setRawToml(raw.content)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存 CC Connect 设置失败。")
    } finally {
      setSaving(false)
    }
  }, [form])

  const reload = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await requireBridgeDomain("config").reloadCcConnectConfig()
      await refresh()
    } catch (reloadError) {
      setError(reloadError instanceof Error ? reloadError.message : "重载失败。")
    } finally {
      setSaving(false)
    }
  }, [refresh])

  const restart = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await requireBridgeDomain("config").restartCcConnect({ confirmed: true })
      await refresh()
    } catch (restartError) {
      setError(restartError instanceof Error ? restartError.message : "重启请求失败。")
    } finally {
      setSaving(false)
      setRestartOpen(false)
    }
  }, [refresh])

  if (loading || !form) {
    return (
      <SettingsGroup>
        <div className="flex min-h-32 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </SettingsGroup>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 data-icon="inline-start" className="size-4 animate-spin" /> : <Save data-icon="inline-start" className="size-4" />}
          保存
        </Button>
        <Button type="button" variant="outline" onClick={() => void reload()} disabled={saving}>
          <RefreshCw data-icon="inline-start" className="size-4" />
          重载
        </Button>
        <Button type="button" variant="outline" onClick={() => setRestartOpen(true)} disabled={saving}>
          <RotateCcw data-icon="inline-start" className="size-4" />
          重启
        </Button>
      </div>

      <SettingsGroup>
        <SettingsFieldRow label="语言">
          <NativeSelect value={form.language} onChange={(event) => setForm({ ...form, language: event.currentTarget.value as SynapseLocale })}>
            {LANGUAGE_OPTIONS.map((language) => (
              <NativeSelectOption key={language} value={language}>{language}</NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingsFieldRow>
        <SettingsFieldRow label="附件回传">
          <NativeSelect value={form.attachmentSend} onChange={(event) => setForm({ ...form, attachmentSend: event.currentTarget.value as SynapseCcConnectAttachmentSend })}>
            {ATTACHMENT_OPTIONS.map((value) => (
              <NativeSelectOption key={value || "default"} value={value}>{value || "default"}</NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingsFieldRow>
        <SettingsFieldRow label="Idle Timeout">
          <Input inputMode="numeric" value={form.idleTimeoutMins} onChange={(event) => setForm({ ...form, idleTimeoutMins: event.currentTarget.value })} />
        </SettingsFieldRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsFieldRow label="Thinking">
          <Switch checked={form.thinkingMessages} onCheckedChange={(checked) => setForm({ ...form, thinkingMessages: checked })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Thinking Max">
          <Input inputMode="numeric" value={form.thinkingMaxLen} onChange={(event) => setForm({ ...form, thinkingMaxLen: event.currentTarget.value })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Tool Progress">
          <Switch checked={form.toolMessages} onCheckedChange={(checked) => setForm({ ...form, toolMessages: checked })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Tool Max">
          <Input inputMode="numeric" value={form.toolMaxLen} onChange={(event) => setForm({ ...form, toolMaxLen: event.currentTarget.value })} />
        </SettingsFieldRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsFieldRow label="Stream Preview">
          <Switch checked={form.streamPreviewEnabled} onCheckedChange={(checked) => setForm({ ...form, streamPreviewEnabled: checked })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Preview Interval">
          <Input inputMode="numeric" value={form.streamPreviewIntervalMs} onChange={(event) => setForm({ ...form, streamPreviewIntervalMs: event.currentTarget.value })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Rate Limit Max">
          <Input inputMode="numeric" value={form.rateLimitMaxMessages} onChange={(event) => setForm({ ...form, rateLimitMaxMessages: event.currentTarget.value })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Rate Limit Window">
          <Input inputMode="numeric" value={form.rateLimitWindowSecs} onChange={(event) => setForm({ ...form, rateLimitWindowSecs: event.currentTarget.value })} />
        </SettingsFieldRow>
        <SettingsFieldRow label="Log Level">
          <NativeSelect value={form.logLevel} onChange={(event) => setForm({ ...form, logLevel: event.currentTarget.value as SynapseCcConnectLogLevel })}>
            {LOG_LEVEL_OPTIONS.map((level) => (
              <NativeSelectOption key={level} value={level}>{level}</NativeSelectOption>
            ))}
          </NativeSelect>
        </SettingsFieldRow>
      </SettingsGroup>

      <SettingsGroup>
        <SettingsFieldRow label="Raw TOML" controlClassName="w-full md:max-w-3xl">
          <Textarea value={rawToml} readOnly rows={16} className="font-mono text-xs" />
        </SettingsFieldRow>
      </SettingsGroup>

      <AlertDialog open={restartOpen} onOpenChange={setRestartOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>重启 CC Connect</AlertDialogTitle>
            <AlertDialogDescription>确认后记录重启请求。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={saving} onClick={() => void restart()}>
              继续
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { CcConnectSettingsPanel }
