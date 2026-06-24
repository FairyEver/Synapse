import { useEffect, useMemo, useState, type FormEvent } from "react"
import { Clipboard, Download, FolderOpen, FolderOutput, Image, MousePointer2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { Input } from "../../../src/components/ui/input"
import { RadioGroup, RadioGroupItem } from "../../../src/components/ui/radio-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { ScreenshotArtifact, ScreenshotCaptureInput, ScreenshotRegion } from "../shared/schema"

type CaptureMode = "fullscreen" | "region"
type BusyAction = "capture" | "copy" | "save" | null

const logger = createRendererLogger("screenshot.app")

const DEFAULT_REGION: ScreenshotRegion = {
  x: 0,
  y: 0,
  width: 800,
  height: 600,
}

export function ScreenshotModule() {
  const [mode, setMode] = useState<CaptureMode>("fullscreen")
  const [region, setRegion] = useState<ScreenshotRegion>(DEFAULT_REGION)
  const [outputPath, setOutputPath] = useState("")
  const [artifact, setArtifact] = useState<ScreenshotArtifact | null>(null)
  const [hideCurrentWindow, setHideCurrentWindow] = useState(false)
  const [previewUrl, setPreviewUrl] = useState("")
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  const [error, setError] = useState("")
  const captureReady = mode === "fullscreen" || regionReady(region)
  const canCopy = artifact !== null && busyAction === null
  const canSave = artifact !== null && outputPath.trim().length > 0 && busyAction === null

  useEffect(() => {
    if (!artifact) {
      setPreviewUrl("")
      return undefined
    }
    const url = URL.createObjectURL(new Blob([arrayBufferFromBytes(artifact.bytes)], { type: artifact.mimeType }))
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [artifact])

  const captureInput = useMemo<ScreenshotCaptureInput>(() => {
    return mode === "region"
      ? { mode, region, hideCurrentWindow }
      : { mode, hideCurrentWindow }
  }, [hideCurrentWindow, mode, region])

  const runCapture = async () => {
    if (!captureReady) return
    setBusyAction("capture")
    setError("")
    try {
      const next = await requireBridgeDomain("screenshot").capture(captureInput)
      setArtifact(next)
      toast.success("截图完成")
    } catch (captureError) {
      handleError(captureError, "截图失败", setError)
    } finally {
      setBusyAction(null)
    }
  }

  const copyToClipboard = async () => {
    if (!artifact) return
    setBusyAction("copy")
    setError("")
    try {
      await requireBridgeDomain("screenshot").copyArtifactToClipboard(artifact)
      toast.success("已复制")
    } catch (copyError) {
      handleError(copyError, "复制失败", setError)
    } finally {
      setBusyAction(null)
    }
  }

  const chooseOutput = async () => {
    const selected = await requireBridgeDomain("screenshot").chooseOutputFile({
      defaultPath: outputPath.trim() || "screenshot.png",
    })
    if (selected) {
      setOutputPath(selected)
      setError("")
    }
  }

  const saveToFile = async () => {
    if (!canSave || !artifact) return
    setBusyAction("save")
    setError("")
    try {
      await requireBridgeDomain("screenshot").saveArtifact({
        artifact,
        outputPath,
      })
      toast.success("已保存")
    } catch (saveError) {
      handleError(saveError, "保存失败", setError)
    } finally {
      setBusyAction(null)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void runCapture()
  }

  const pickRegion = async () => {
    setBusyAction("capture")
    setError("")
    try {
      const next = await requireBridgeDomain("screenshot").startInteractiveCapture({ hideCurrentWindow })
      if (!next) return
      setMode("region")
      if (next.capture.region) {
        setRegion(next.capture.region)
      }
      setArtifact(next)
      toast.success("截图完成")
    } catch (pickError) {
      handleError(pickError, "截图失败", setError)
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <form className="mx-auto w-full max-w-3xl p-3 sm:p-5" onSubmit={submit} aria-busy={Boolean(busyAction)}>
          <Card className="py-0">
            <CardContent className="grid gap-5 p-4 sm:p-5">
              <FieldSet className="gap-4">
                <FieldGroup className="gap-4">
                  <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                    <FieldLabel id="screenshot-mode-label">模式</FieldLabel>
                    <RadioGroup
                      aria-labelledby="screenshot-mode-label"
                      value={mode}
                      onValueChange={(value) => setMode(value as CaptureMode)}
                      className="flex w-auto items-center gap-4"
                      disabled={Boolean(busyAction)}
                    >
                      <ModeOption id="screenshot-mode-fullscreen" value="fullscreen" label="全屏" disabled={Boolean(busyAction)} />
                      <ModeOption id="screenshot-mode-region" value="region" label="区域" disabled={Boolean(busyAction)} />
                    </RadioGroup>
                  </Field>
                  {mode === "region" ? (
                    <RegionFields
                      region={region}
                      disabled={Boolean(busyAction)}
                      onChange={setRegion}
                      onPickRegion={pickRegion}
                    />
                  ) : null}
                  <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                    <FieldLabel htmlFor="screenshot-hide-window">隐藏当前窗口</FieldLabel>
                    <Switch
                      id="screenshot-hide-window"
                      checked={hideCurrentWindow}
                      onCheckedChange={(checked) => setHideCurrentWindow(checked === true)}
                      disabled={Boolean(busyAction)}
                    />
                  </Field>
                  <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                    <FieldLabel htmlFor="screenshot-output">保存位置</FieldLabel>
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                      <InputGroup>
                        <InputGroupAddon>
                          <FolderOutput className="size-4 text-muted-foreground" />
                        </InputGroupAddon>
                        <InputGroupInput
                          id="screenshot-output"
                          value={outputPath}
                          placeholder="选择保存位置"
                          readOnly
                          disabled={Boolean(busyAction)}
                        />
                      </InputGroup>
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full sm:w-24"
                        onClick={chooseOutput}
                        disabled={Boolean(busyAction)}
                        aria-label="选择保存位置"
                      >
                        <FolderOpen data-icon="inline-start" />
                        选择
                      </Button>
                    </div>
                  </Field>
                </FieldGroup>
              </FieldSet>

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                <Button type="submit" disabled={!captureReady || busyAction !== null}>
                  {busyAction === "capture" ? <Spinner data-icon="inline-start" /> : <Image data-icon="inline-start" />}
                  截图
                </Button>
                <Button type="button" variant="outline" onClick={copyToClipboard} disabled={!canCopy}>
                  {busyAction === "copy" ? <Spinner data-icon="inline-start" /> : <Clipboard data-icon="inline-start" />}
                  复制
                </Button>
                <Button type="button" variant="outline" onClick={saveToFile} disabled={!canSave}>
                  {busyAction === "save" ? <Spinner data-icon="inline-start" /> : <Download data-icon="inline-start" />}
                  保存到文件
                </Button>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              {artifact ? (
                <div className="grid gap-3 border-t pt-4">
                  <div className="grid gap-1 text-sm text-muted-foreground">
                    <p>{artifact.width} x {artifact.height}</p>
                    <p className="break-all">{artifact.tempPath}</p>
                  </div>
                  {previewUrl && artifact.bytes.byteLength > 0 ? (
                    <div className="overflow-hidden rounded-lg bg-muted">
                      <img src={previewUrl} alt="截图预览" className="max-h-96 w-full object-contain" />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </form>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function ModeOption(props: {
  readonly id: string
  readonly value: CaptureMode
  readonly label: string
  readonly disabled: boolean
}) {
  return (
    <label htmlFor={props.id} className="flex items-center gap-2 text-sm">
      <RadioGroupItem id={props.id} value={props.value} disabled={props.disabled} />
      {props.label}
    </label>
  )
}

function RegionFields(props: {
  readonly region: ScreenshotRegion
  readonly disabled: boolean
  readonly onChange: (region: ScreenshotRegion) => void
  readonly onPickRegion: () => void
}) {
  const update = (key: keyof ScreenshotRegion, value: string) => {
    props.onChange({
      ...props.region,
      [key]: Number(value),
    })
  }

  return (
    <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
      <FieldLabel>坐标</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" data-testid="screenshot-region-fields">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <CoordinateInput id="screenshot-region-x" label="X" value={props.region.x} disabled={props.disabled} onChange={(value) => update("x", value)} />
          <CoordinateInput id="screenshot-region-y" label="Y" value={props.region.y} disabled={props.disabled} onChange={(value) => update("y", value)} />
          <CoordinateInput id="screenshot-region-width" label="W" value={props.region.width} disabled={props.disabled} onChange={(value) => update("width", value)} />
          <CoordinateInput id="screenshot-region-height" label="H" value={props.region.height} disabled={props.disabled} onChange={(value) => update("height", value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-24"
          onClick={props.onPickRegion}
          disabled={props.disabled}
          data-testid="screenshot-region-pick"
        >
          <MousePointer2 data-icon="inline-start" />
          框选
        </Button>
      </div>
    </Field>
  )
}

function CoordinateInput(props: {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return (
    <label htmlFor={props.id} className="grid gap-1 text-xs text-muted-foreground">
      {props.label}
      <Input
        id={props.id}
        type="number"
        value={Number.isFinite(props.value) ? String(props.value) : ""}
        onChange={(event) => props.onChange(event.target.value)}
        disabled={props.disabled}
        className="text-right"
      />
    </label>
  )
}

function regionReady(region: ScreenshotRegion): boolean {
  return Number.isFinite(region.x)
    && Number.isFinite(region.y)
    && Number.isFinite(region.width)
    && region.width > 0
    && Number.isFinite(region.height)
    && region.height > 0
}

function handleError(error: unknown, fallback: string, setError: (message: string) => void): void {
  const message = error instanceof Error && error.message ? error.message : fallback
  logger.error(fallback, error)
  setError(message)
  toast.error(message)
}

function arrayBufferFromBytes(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}
