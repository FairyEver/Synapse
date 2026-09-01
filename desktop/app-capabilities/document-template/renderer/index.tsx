import { useMemo, useState, type ComponentProps, type FormEvent, type ReactNode } from "react"
import { CircleAlert, CircleCheck, FileJson, FileText, FolderOpen, FolderOutput } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import { Badge } from "../../../src/components/ui/badge"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
} from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { Label } from "../../../src/components/ui/label"
import { RadioGroup, RadioGroupItem } from "../../../src/components/ui/radio-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"

type JsonSource = "file" | "inline"

const logger = createRendererLogger("document-template.app")

export function DocumentTemplateModule() {
  const [templatePath, setTemplatePath] = useState("")
  const [dataPath, setDataPath] = useState("")
  const [inlineJson, setInlineJson] = useState("{\n  \n}")
  const [jsonSource, setJsonSource] = useState<JsonSource>("file")
  const [outputPath, setOutputPath] = useState("")
  const [overwrite, setOverwrite] = useState(false)
  const [busy, setBusy] = useState(false)
  const [resultPath, setResultPath] = useState("")
  const [formError, setFormError] = useState("")
  const [inlineJsonInvalid, setInlineJsonInvalid] = useState(false)
  const templateReady = templatePath.trim().length > 0
  const dataReady = jsonSource === "file" ? dataPath.trim().length > 0 : inlineJson.trim().length > 0
  const outputReady = outputPath.trim().length > 0
  const canGenerate = useMemo(() => {
    return templateReady && outputReady && dataReady && !busy
  }, [busy, dataReady, outputReady, templateReady])

  const clearStatus = () => {
    setFormError("")
    setInlineJsonInvalid(false)
    setResultPath("")
  }

  const chooseTemplate = async () => {
    const selected = await requireBridgeDomain("documentTemplate").template.choose()
    if (selected) {
      clearStatus()
      setTemplatePath(selected)
    }
  }

  const chooseJson = async () => {
    const selected = await requireBridgeDomain("documentTemplate").json.choose()
    if (selected) {
      clearStatus()
      setDataPath(selected)
    }
  }

  const chooseOutput = async () => {
    const selected = await requireBridgeDomain("documentTemplate").output.choose({
      defaultPath: outputPath.trim() || "output.docx",
    })
    if (selected) {
      clearStatus()
      setOutputPath(selected)
    }
  }

  const generate = async () => {
    setFormError("")
    setInlineJsonInvalid(false)
    setResultPath("")
    const jsonInput = buildJsonInput({
      dataPath,
      inlineJson,
      jsonSource,
      onInvalidInlineJson: (message) => {
        setInlineJsonInvalid(true)
        setFormError(message)
        toast.error(message)
      },
    })
    if (!jsonInput) return
    const finishTracking = startTrackedOperation({ component: "document-template", eventKey: "document-template.document.generate" })

    try {
      setBusy(true)
      const result = await requireBridgeDomain("documentTemplate").docx.generate({
        templatePath,
        outputPath,
        overwrite,
        ...jsonInput,
      })
      setResultPath(result.outputPath)
      finishTracking("success")
      toast.success("生成完成")
    } catch (error) {
      finishTracking("failure")
      const message = errorMessage(error, "生成失败")
      logger.error("Document generation failed.", error)
      setFormError(message)
      toast.error(message)
    } finally {
      setBusy(false)
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canGenerate) return
    void generate()
  }

  const revealGeneratedFile = async () => {
    if (!resultPath) return
    const finishTracking = startTrackedOperation({ component: "document-template", eventKey: "document-template.output.reveal" })
    try {
      await requireBridgeDomain("shell").showItemInFolder(resultPath)
      finishTracking("success")
    } catch (error) {
      finishTracking("failure")
      logger.error("Failed to reveal generated document.", error)
      toast.error(errorMessage(error, "无法在文件夹中查看"))
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <form className="mx-auto w-full max-w-3xl p-3 sm:p-5" onSubmit={submit} aria-busy={busy} data-track="document-template.document.generate">
          <Card className="py-0">
            <CardContent className="grid gap-5 p-4 sm:p-5">
              <FieldSet className="min-w-0 gap-4">
                <FieldGroup className="gap-4">
                  <FileRow
                    id="template-path"
                    label="Word 模板文件"
                    icon={<FileText className="size-4 text-muted-foreground" />}
                    value={templatePath}
                    placeholder="选择 .docx 文件"
                    onChoose={chooseTemplate}
                    disabled={busy}
                  />
                  <JsonInput
                    dataPath={dataPath}
                    inlineJson={inlineJson}
                    inlineJsonError={inlineJsonInvalid ? formError : ""}
                    jsonSource={jsonSource}
                    disabled={busy}
                    onChooseJson={chooseJson}
                    onInlineJsonChange={(value) => {
                      clearStatus()
                      setInlineJson(value)
                    }}
                    onJsonSourceChange={(value) => {
                      clearStatus()
                      setJsonSource(value)
                    }}
                  />
                  <FileRow
                    id="output-path"
                    label="输出文件"
                    icon={<FolderOutput className="size-4 text-muted-foreground" />}
                    value={outputPath}
                    placeholder="选择输出位置"
                    onChoose={chooseOutput}
                    disabled={busy}
                  />
                </FieldGroup>
              </FieldSet>

              <div className="grid gap-4 border-t pt-4">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <Field orientation="horizontal" className="items-center justify-between gap-3">
                    <FieldContent>
                      <FieldLabel htmlFor="overwrite-output">覆盖已存在文件</FieldLabel>
                    </FieldContent>
                    <Switch id="overwrite-output" checked={overwrite} disabled={busy} onCheckedChange={setOverwrite} />
                  </Field>
                  <Button type="submit" className="w-full sm:w-28" disabled={!canGenerate}>
                    {busy ? <Spinner data-icon="inline-start" /> : null}
                    {busy ? "生成中" : "生成文档"}
                  </Button>
                </div>
                <RunSummary
                  busy={busy}
                  canGenerate={canGenerate}
                  dataReady={dataReady}
                  error={formError}
                  outputReady={outputReady}
                  resultPath={resultPath}
                  templateReady={templateReady}
                  onRevealResult={revealGeneratedFile}
                />
              </div>
            </CardContent>
            <p className="sr-only" role="status" aria-live="polite">
              {busy ? "生成中" : resultPath ? "生成完成" : ""}
            </p>
          </Card>
        </form>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function JsonInput(props: {
  dataPath: string
  inlineJson: string
  inlineJsonError: string
  jsonSource: JsonSource
  disabled: boolean
  onChooseJson: () => Promise<void>
  onInlineJsonChange: (value: string) => void
  onJsonSourceChange: (value: JsonSource) => void
}) {
  return (
    <FieldSet className="gap-3">
      <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
        <FieldLabel id="json-source-label">JSON 数据</FieldLabel>
        <RadioGroup
          aria-labelledby="json-source-label"
          value={props.jsonSource}
          onValueChange={(value) => props.onJsonSourceChange(value as JsonSource)}
          className="flex w-auto items-center gap-4"
          disabled={props.disabled}
        >
          <JsonSourceOption id="json-source-file" value="file" label="文件" disabled={props.disabled} />
          <JsonSourceOption id="json-source-inline" value="inline" label="内联" disabled={props.disabled} />
        </RadioGroup>
      </Field>
      {props.jsonSource === "file" ? (
        <FileRow
          id="json-path"
          label="数据文件"
          icon={<FileJson className="size-4 text-muted-foreground" />}
          value={props.dataPath}
          placeholder="选择 .json 文件"
          onChoose={props.onChooseJson}
          disabled={props.disabled}
        />
      ) : (
        <Field className="md:grid md:grid-cols-[7rem_minmax(0,1fr)]" data-invalid={Boolean(props.inlineJsonError) || undefined}>
          <FieldLabel htmlFor="inline-json">内联 JSON</FieldLabel>
          <div className="grid gap-2">
            <Textarea
              id="inline-json"
              value={props.inlineJson}
              onChange={(event) => props.onInlineJsonChange(event.target.value)}
              disabled={props.disabled}
              aria-invalid={Boolean(props.inlineJsonError)}
              spellCheck={false}
              className="min-h-40 resize-y font-mono text-sm"
            />
            {props.inlineJsonError ? <FieldError>{props.inlineJsonError}</FieldError> : null}
          </div>
        </Field>
      )}
    </FieldSet>
  )
}

function JsonSourceOption(props: {
  id: string
  value: JsonSource
  label: string
  disabled: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={props.id} value={props.value} disabled={props.disabled} />
      <Label htmlFor={props.id} className="text-sm font-normal">{props.label}</Label>
    </div>
  )
}

function FileRow(props: {
  id: string
  label: string
  icon: ReactNode
  value: string
  placeholder: string
  onChoose: () => Promise<void>
  disabled: boolean
}) {
  return (
    <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
      <FieldLabel htmlFor={props.id}>{props.label}</FieldLabel>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <InputGroup>
          <InputGroupAddon>{props.icon}</InputGroupAddon>
          <InputGroupInput
            id={props.id}
            value={props.value}
            placeholder={props.placeholder}
            readOnly
            disabled={props.disabled}
          />
        </InputGroup>
        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-24"
          disabled={props.disabled}
          aria-label={`选择${props.label}`}
          onClick={() => void props.onChoose()}
        >
          <FolderOpen data-icon="inline-start" />
          选择
        </Button>
      </div>
    </Field>
  )
}

function RunSummary(props: {
  busy: boolean
  canGenerate: boolean
  dataReady: boolean
  error: string
  outputReady: boolean
  resultPath: string
  templateReady: boolean
  onRevealResult: () => Promise<void>
}) {
  const status = getRunStatus(props)

  return (
    <div className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">准备状态</span>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <RequirementRow label="模板" ready={props.templateReady} />
        <RequirementRow label="数据" ready={props.dataReady} />
        <RequirementRow label="输出" ready={props.outputReady} />
      </div>
      {props.error ? (
        <Alert variant="destructive">
          <CircleAlert />
          <AlertTitle>生成失败</AlertTitle>
          <AlertDescription>{props.error}</AlertDescription>
        </Alert>
      ) : null}
      {props.resultPath ? (
        <Alert className="gap-y-2 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start">
          <CircleCheck />
          <div className="min-w-0">
            <AlertTitle>生成完成</AlertTitle>
            <AlertDescription className="break-all">{props.resultPath}</AlertDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="col-start-2 w-fit sm:col-start-3 sm:row-start-1"
            onClick={() => void props.onRevealResult()}
          >
            <FolderOpen data-icon="inline-start" />
            在文件夹中查看
          </Button>
        </Alert>
      ) : null}
    </div>
  )
}

function RequirementRow(props: {
  label: string
  ready: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm sm:block">
      <span className="text-muted-foreground">{props.label}</span>
      <span className={props.ready ? "font-medium sm:mt-1 sm:block" : "text-muted-foreground sm:mt-1 sm:block"}>
        {props.ready ? "已选" : "待选"}
      </span>
    </div>
  )
}

function getRunStatus(input: {
  busy: boolean
  canGenerate: boolean
  error: string
  resultPath: string
}): { label: string; variant: ComponentProps<typeof Badge>["variant"] } {
  if (input.busy) return { label: "生成中", variant: "secondary" }
  if (input.error) return { label: "失败", variant: "destructive" }
  if (input.resultPath) return { label: "完成", variant: "secondary" }
  if (input.canGenerate) return { label: "就绪", variant: "secondary" }
  return { label: "未就绪", variant: "outline" }
}

function buildJsonInput(input: {
  dataPath: string
  inlineJson: string
  jsonSource: JsonSource
  onInvalidInlineJson: (message: string) => void
}): { dataPath: string } | { data: Record<string, unknown> } | null {
  if (input.jsonSource === "file") {
    return { dataPath: input.dataPath }
  }

  try {
    return { data: parseInlineJson(input.inlineJson) }
  } catch (error) {
    input.onInvalidInlineJson(
      error instanceof SyntaxError ? "JSON 数据格式无效" : errorMessage(error, "JSON 数据格式无效"),
    )
    return null
  }
}

function parseInlineJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 数据必须是对象")
  }
  return parsed as Record<string, unknown>
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}
