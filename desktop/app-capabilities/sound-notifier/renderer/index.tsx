import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleAlert, Play } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "../../../src/components/ui/field"
import { RadioGroup, RadioGroupItem } from "../../../src/components/ui/radio-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Slider } from "../../../src/components/ui/slider"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseSoundNotifierSettings } from "../../../src/types/sound-notifier"
import { SOUND_NOTIFIER_PRESETS, type SoundNotifierPresetId } from "../shared/defaults"

const logger = createRendererLogger("sound-notifier.app")

export function SoundNotifierModule() {
  const soundNotifierBridge = useMemo(() => requireBridgeDomain("soundNotifier"), [])
  const [settings, setSettings] = useState<SynapseSoundNotifierSettings | null>(null)
  const [volumeDraft, setVolumeDraft] = useState(70)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      const loaded = await soundNotifierBridge.getSettings()
      setSettings(loaded)
      setVolumeDraft(loaded.volume)
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load sound notifier settings.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [soundNotifierBridge])

  useEffect(() => {
    void reload()
    return soundNotifierBridge.onChanged((event) => {
      setSettings(event.settings)
      setVolumeDraft(event.settings.volume)
    })
  }, [reload, soundNotifierBridge])

  const updateSettings = useCallback(async (patch: Partial<SynapseSoundNotifierSettings>) => {
    try {
      const updated = await soundNotifierBridge.updateSettings(patch)
      setSettings(updated)
      setVolumeDraft(updated.volume)
    } catch (error) {
      logger.error("Failed to update sound notifier settings.", error)
      toast.error(errorMessage(error, "保存失败"))
    }
  }, [soundNotifierBridge])

  const preview = useCallback(async (presetId?: SoundNotifierPresetId) => {
    try {
      await soundNotifierBridge.preview({
        ...(presetId ? { presetId } : {}),
        volume: volumeDraft,
      })
    } catch (error) {
      logger.error("Failed to preview sound notifier.", error)
      toast.error(errorMessage(error, "试听失败"))
    }
  }, [soundNotifierBridge, volumeDraft])

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-3 p-3 sm:p-5">
          {loading ? (
            <SoundNotifierSkeleton />
          ) : loadError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription className="break-words">{loadError}</AlertDescription>
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
            <FieldGroup className="rounded-lg border bg-card p-4">
              <Field orientation="horizontal" className="items-center justify-between">
                <FieldContent>
                  <FieldLabel htmlFor="sound-notifier-enabled">MCP 播放</FieldLabel>
                </FieldContent>
                <Switch
                  id="sound-notifier-enabled"
                  checked={settings.enabled}
                  onCheckedChange={(enabled) => void updateSettings({ enabled })}
                  aria-label="MCP 播放"
                />
              </Field>

              <FieldSet>
                <FieldLabel>默认声音</FieldLabel>
                <RadioGroup
                  value={settings.selectedPresetId}
                  onValueChange={(selectedPresetId) =>
                    void updateSettings({ selectedPresetId: selectedPresetId as SoundNotifierPresetId })}
                >
                  {SOUND_NOTIFIER_PRESETS.map((preset) => (
                    <Field
                      key={preset.id}
                      orientation="horizontal"
                      className="items-center rounded-lg border bg-background p-3"
                    >
                      <RadioGroupItem id={`sound-notifier-${preset.id}`} value={preset.id} />
                      <FieldLabel htmlFor={`sound-notifier-${preset.id}`} className="min-w-0 flex-1">
                        {preset.name}
                      </FieldLabel>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void preview(preset.id)}
                      >
                        <Play data-icon="inline-start" />
                        试听
                      </Button>
                    </Field>
                  ))}
                </RadioGroup>
              </FieldSet>

              <Field>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="sound-notifier-volume">音量</FieldLabel>
                  <span className="text-sm tabular-nums text-muted-foreground">{volumeDraft}</span>
                </div>
                <Slider
                  id="sound-notifier-volume"
                  min={0}
                  max={100}
                  step={1}
                  value={[volumeDraft]}
                  onValueChange={(value) => setVolumeDraft(value[0] ?? settings.volume)}
                  onValueCommit={(value) => void updateSettings({ volume: value[0] ?? settings.volume })}
                  aria-label="音量"
                />
                <FieldError />
              </Field>

              <div className="flex justify-end">
                <Button type="button" onClick={() => void preview()}>
                  <Play data-icon="inline-start" />
                  试听默认声音
                </Button>
              </div>
            </FieldGroup>
          ) : null}
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function SoundNotifierSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <Skeleton className="h-8 w-32" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-12 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}
