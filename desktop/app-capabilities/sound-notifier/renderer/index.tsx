import { useCallback, useEffect, useMemo, useState } from "react"
import { CircleAlert, Minus, Play, Plus } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import {
  Field,
  FieldError,
  FieldLabel,
} from "../../../src/components/ui/field"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseSoundNotifierSettings } from "../../../src/types/sound-notifier"
import {
  SOUND_NOTIFIER_DEFAULT_INTERVAL_MS,
  SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT,
  SOUND_NOTIFIER_MAX_INTERVAL_MS,
  SOUND_NOTIFIER_MAX_REPEAT_COUNT,
  SOUND_NOTIFIER_MIN_INTERVAL_MS,
  SOUND_NOTIFIER_MIN_REPEAT_COUNT,
  SOUND_NOTIFIER_PRESETS,
  type SoundNotifierEventType,
} from "../shared/defaults"

const logger = createRendererLogger("sound-notifier.app")
const SOUND_NOTIFIER_UI_INTERVAL_STEP_MS = 100

export function SoundNotifierModule() {
  const soundNotifierBridge = useMemo(() => requireBridgeDomain("soundNotifier"), [])
  const [settings, setSettings] = useState<SynapseSoundNotifierSettings | null>(null)
  const [repeatCount, setRepeatCount] = useState(SOUND_NOTIFIER_DEFAULT_REPEAT_COUNT)
  const [intervalMs, setIntervalMs] = useState(SOUND_NOTIFIER_DEFAULT_INTERVAL_MS)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      const loaded = await soundNotifierBridge.getSettings()
      setSettings(loaded)
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
    })
  }, [reload, soundNotifierBridge])

  const preview = useCallback(async (eventType: SoundNotifierEventType) => {
    try {
      await soundNotifierBridge.preview({
        eventType,
        repeatCount,
        intervalMs,
      })
    } catch (error) {
      logger.error("Failed to preview sound notifier.", error)
      toast.error(errorMessage(error, "试听失败"))
    }
  }, [intervalMs, repeatCount, soundNotifierBridge])

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
            <Card className="rounded-lg py-0">
              <CardContent className="grid gap-8 p-4 sm:p-5">
                <section className="grid gap-3" aria-labelledby="sound-notifier-presets-heading">
                  <h2 id="sound-notifier-presets-heading" className="text-base font-medium text-foreground">
                    提醒类型
                  </h2>
                  <div className="overflow-hidden rounded-lg border bg-background" role="list">
                    {SOUND_NOTIFIER_PRESETS.map((preset) => (
                      <SoundPresetRow
                        key={preset.id}
                        name={preset.name}
                        description={preset.description}
                        onPreview={() => void preview(preset.eventType)}
                      />
                    ))}
                  </div>
                </section>

                <section className="grid gap-4" aria-labelledby="sound-notifier-preview-heading">
                  <h2 id="sound-notifier-preview-heading" className="text-base font-medium text-foreground">
                    试听参数
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <StepperField
                      label="循环次数"
                      value={repeatCount}
                      suffix="次"
                      decreaseLabel="减少循环次数"
                      increaseLabel="增加循环次数"
                      onDecrease={() => setRepeatCount((value) => Math.max(SOUND_NOTIFIER_MIN_REPEAT_COUNT, value - 1))}
                      onIncrease={() => setRepeatCount((value) => Math.min(SOUND_NOTIFIER_MAX_REPEAT_COUNT, value + 1))}
                    />
                    <StepperField
                      label="间隔"
                      value={intervalMs}
                      suffix="ms"
                      decreaseLabel="减少间隔"
                      increaseLabel="增加间隔"
                      onDecrease={() => setIntervalMs((value) =>
                        Math.max(SOUND_NOTIFIER_MIN_INTERVAL_MS, value - SOUND_NOTIFIER_UI_INTERVAL_STEP_MS)
                      )}
                      onIncrease={() => setIntervalMs((value) =>
                        Math.min(SOUND_NOTIFIER_MAX_INTERVAL_MS, value + SOUND_NOTIFIER_UI_INTERVAL_STEP_MS)
                      )}
                    />
                  </div>
                </section>
              </CardContent>
            </Card>
          ) : null}
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function StepperField(props: {
  label: string
  value: number
  suffix: string
  decreaseLabel: string
  increaseLabel: string
  onDecrease: () => void
  onIncrease: () => void
}) {
  return (
    <Field className="gap-2">
      <FieldLabel>{props.label}</FieldLabel>
      <div className="flex h-10 items-center overflow-hidden rounded-lg border bg-background">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-none transition-transform duration-150 ease-out active:scale-[0.96]"
          aria-label={props.decreaseLabel}
          onClick={props.onDecrease}
        >
          <Minus />
        </Button>
        <span className="min-w-0 flex-1 text-center text-sm tabular-nums">
          {props.value}
          {" "}
          {props.suffix}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-10 w-10 rounded-none transition-transform duration-150 ease-out active:scale-[0.96]"
          aria-label={props.increaseLabel}
          onClick={props.onIncrease}
        >
          <Plus />
        </Button>
      </div>
      <FieldError />
    </Field>
  )
}

function SoundPresetRow(props: {
  name: string
  description: string
  onPreview: () => void
}) {
  return (
    <Field
      orientation="horizontal"
      role="listitem"
      className="min-h-14 flex-wrap items-center gap-3 px-3 py-2.5 transition-[background-color] hover:bg-muted/50 sm:flex-nowrap sm:px-4 [&:not(:last-child)]:border-b"
    >
      <div className="grid min-w-0 flex-1 gap-1">
        <span className="truncate text-sm font-medium">{props.name}</span>
        <span className="text-sm text-muted-foreground">{props.description}</span>
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-10 px-3 transition-[scale,background-color,color] duration-150 ease-out active:scale-[0.96]"
          aria-label={`试听 ${props.name}`}
          onClick={props.onPreview}
        >
          <Play className="ml-px" data-icon="inline-start" />
          试听
        </Button>
      </div>
    </Field>
  )
}

function SoundNotifierSkeleton() {
  return (
    <Card className="rounded-lg py-0">
      <CardContent className="grid gap-4 p-4 sm:p-5">
        <Skeleton className="h-5 w-24" />
        <div className="overflow-hidden rounded-lg border">
          <Skeleton className="h-14 w-full rounded-none" />
          <Skeleton className="h-14 w-full rounded-none border-t" />
          <Skeleton className="h-14 w-full rounded-none border-t" />
          <Skeleton className="h-14 w-full rounded-none border-t" />
          <Skeleton className="h-14 w-full rounded-none border-t" />
        </div>
        <Skeleton className="h-8 w-full" />
      </CardContent>
    </Card>
  )
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback
}
