import { useMemo, useState, type ReactNode } from "react"
import { FileJson, FileText, FolderOutput, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { requireBridgeDomain } from "@/lib/electron-bridge"
import { SystemAppWindowShell } from "@/modules/apps/components/system-app-window-shell"

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
  const canGenerate = useMemo(() => {
    const hasJson = jsonSource === "file" ? dataPath.trim().length > 0 : inlineJson.trim().length > 0
    return templatePath.trim().length > 0 && outputPath.trim().length > 0 && hasJson && !busy
  }, [busy, dataPath, inlineJson, jsonSource, outputPath, templatePath])

  const chooseTemplate = async () => {
    const selected = await requireBridgeDomain("documentTemplate").chooseTemplateFile()
    if (selected) setTemplatePath(selected)
  }

  const chooseJson = async () => {
    const selected = await requireBridgeDomain("documentTemplate").chooseJsonFile()
    if (selected) setDataPath(selected)
  }

  const chooseOutput = async () => {
    const selected = await requireBridgeDomain("documentTemplate").chooseOutputFile({
      defaultPath: outputPath.trim() || "output.docx",
    })
    if (selected) setOutputPath(selected)
  }

  const generate = async () => {
    try {
      setBusy(true)
      setResultPath("")
      const jsonInput = jsonSource === "file"
        ? { dataPath }
        : { data: parseInlineJson(inlineJson) }
      const result = await requireBridgeDomain("documentTemplate").generateDocx({
        templatePath,
        outputPath,
        overwrite,
        ...jsonInput,
      })
      setResultPath(result.outputPath)
      toast.success("生成完成")
    } catch (error) {
      logger.error("Document generation failed.", error)
      toast.error(error instanceof Error ? error.message : "生成失败")
    } finally {
      setBusy(false)
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid max-w-3xl gap-4 p-4">
          <div className="grid gap-3">
            <FileRow
              id="template-path"
              label="Word 模板文件"
              icon={<FileText className="size-4 text-muted-foreground" />}
              value={templatePath}
              onChoose={chooseTemplate}
            />
            <JsonInput
              dataPath={dataPath}
              inlineJson={inlineJson}
              jsonSource={jsonSource}
              onChooseJson={chooseJson}
              onInlineJsonChange={setInlineJson}
              onJsonSourceChange={setJsonSource}
            />
            <FileRow
              id="output-path"
              label="输出文件"
              icon={<FolderOutput className="size-4 text-muted-foreground" />}
              value={outputPath}
              onChoose={chooseOutput}
            />
          </div>
          <div className="flex items-center justify-between border-t pt-3">
            <Label htmlFor="overwrite-output" className="text-sm font-normal">覆盖已存在文件</Label>
            <Switch id="overwrite-output" checked={overwrite} onCheckedChange={setOverwrite} />
          </div>
          <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-sm text-muted-foreground">{resultPath}</p>
            <Button type="button" disabled={!canGenerate} onClick={() => void generate()}>
              {busy ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
              {busy ? "生成中" : "生成"}
            </Button>
          </div>
        </div>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function JsonInput(props: {
  dataPath: string
  inlineJson: string
  jsonSource: JsonSource
  onChooseJson: () => Promise<void>
  onInlineJsonChange: (value: string) => void
  onJsonSourceChange: (value: JsonSource) => void
}) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-3">
        <Label>JSON 数据</Label>
        <RadioGroup
          value={props.jsonSource}
          onValueChange={(value) => props.onJsonSourceChange(value as JsonSource)}
          className="flex w-auto items-center gap-3"
        >
          <JsonSourceOption id="json-source-file" value="file" label="文件" />
          <JsonSourceOption id="json-source-inline" value="inline" label="内联" />
        </RadioGroup>
      </div>
      {props.jsonSource === "file" ? (
        <FileRow
          id="json-path"
          label="JSON 文件"
          icon={<FileJson className="size-4 text-muted-foreground" />}
          value={props.dataPath}
          onChoose={props.onChooseJson}
          hideLabel
        />
      ) : (
        <Textarea
          aria-label="内联 JSON"
          value={props.inlineJson}
          onChange={(event) => props.onInlineJsonChange(event.target.value)}
          className="min-h-36 font-mono text-sm"
        />
      )}
    </div>
  )
}

function JsonSourceOption(props: {
  id: string
  value: JsonSource
  label: string
}) {
  return (
    <div className="flex items-center gap-2">
      <RadioGroupItem id={props.id} value={props.value} />
      <Label htmlFor={props.id} className="text-sm font-normal">{props.label}</Label>
    </div>
  )
}

function FileRow(props: {
  id: string
  label: string
  icon: ReactNode
  value: string
  onChoose: () => Promise<void>
  hideLabel?: boolean
}) {
  return (
    <div className="grid gap-1.5">
      {props.hideLabel ? null : <Label htmlFor={props.id}>{props.label}</Label>}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
        <div className="relative">
          <div className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2">{props.icon}</div>
          <Input id={props.id} value={props.value} readOnly className="pl-8" />
        </div>
        <Button type="button" variant="outline" onClick={() => void props.onChoose()}>选择</Button>
      </div>
    </div>
  )
}

function parseInlineJson(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON 数据必须是对象")
  }
  return parsed as Record<string, unknown>
}
