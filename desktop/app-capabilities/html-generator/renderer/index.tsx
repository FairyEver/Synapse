import { useMemo, useRef, useState } from "react"
import { Copy, FolderOpen } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import { Field, FieldError, FieldLabel } from "../../../src/components/ui/field"
import { InputGroup, InputGroupInput } from "../../../src/components/ui/input-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import { getSynapseBridge, requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import {
  HTML_GENERATION_DATA_MAX_BYTES,
  HTML_GENERATION_INPUT_MAX_BYTES,
  HTML_GENERATION_TEMPLATE_MAX_BYTES,
  type HtmlGenerationFileResult,
  type HtmlGenerationResult,
  type JsonObject,
} from "../shared/schema"

type TabId = "html" | "file"
type RunState<T> = {
  readonly busy: boolean
  readonly error: { readonly message: string; readonly line?: number } | null
  readonly result: T | null
}

const EMPTY_RUN_STATE = { busy: false, error: null, result: null } as const
const TABS = [
  { id: "html", label: "生成 HTML" },
  { id: "file", label: "生成文件" },
] as const
const logger = createRendererLogger("html-generator.app")

export function HtmlGeneratorModule() {
  const [activeTab, setActiveTab] = useState<TabId>("html")
  const [template, setTemplate] = useState("")
  const [dataText, setDataText] = useState("{}")
  const [outputPath, setOutputPath] = useState("")
  const [overwrite, setOverwrite] = useState(false)
  const [templateTouched, setTemplateTouched] = useState(false)
  const [outputTouched, setOutputTouched] = useState(false)
  const [htmlRun, setHtmlRun] = useState<RunState<HtmlGenerationResult>>(EMPTY_RUN_STATE)
  const [fileRun, setFileRun] = useState<RunState<HtmlGenerationFileResult>>(EMPTY_RUN_STATE)
  const revisionRef = useRef(0)
  const htmlRequestRef = useRef(0)
  const fileRequestRef = useRef(0)
  const anyBusy = htmlRun.busy || fileRun.busy
  const templateBytes = utf8Size(template)
  const parsedData = useMemo(() => parseJsonObject(dataText), [dataText])
  const dataBytes = parsedData.ok ? utf8Size(JSON.stringify(parsedData.data)) : null
  const inputBytes = parsedData.ok ? utf8Size(JSON.stringify({ template, data: parsedData.data })) : null
  const templateError = template.length === 0
    ? (templateTouched ? "请输入 EJS 模板。" : "")
    : !isWellFormedUnicode(template)
      ? "EJS 模板包含无效 Unicode。"
      : templateBytes > HTML_GENERATION_TEMPLATE_MAX_BYTES
        ? "EJS 模板超过 256 KiB。"
        : ""
  const dataError = parsedData.ok
    ? dataBytes !== null && dataBytes > HTML_GENERATION_DATA_MAX_BYTES
      ? "JSON 数据超过 512 KiB。"
      : ""
    : parsedData.message
  const inputError = inputBytes !== null && inputBytes > HTML_GENERATION_INPUT_MAX_BYTES
    ? "模板与数据合计超过 768 KiB。"
    : ""
  const pathError = validateOutputPath(outputPath, getSynapseBridge()?.platform ?? "darwin")
  const commonReady = template.length > 0 && !templateError && !dataError && !inputError && parsedData.ok
  const canGenerateHtml = commonReady && !htmlRun.busy
  const canGenerateFile = commonReady && outputPath.length > 0 && !pathError && !fileRun.busy

  const invalidateShared = () => {
    revisionRef.current += 1
    setHtmlRun(EMPTY_RUN_STATE)
    setFileRun(EMPTY_RUN_STATE)
  }

  const generateHtml = async () => {
    setTemplateTouched(true)
    if (!canGenerateHtml || !parsedData.ok) return
    const revision = revisionRef.current
    const requestId = ++htmlRequestRef.current
    setHtmlRun({ busy: true, error: null, result: null })
    try {
      const response = await requireBridgeDomain("htmlGenerator").ejs.generate({
        template,
        data: parsedData.data,
      })
      if (revision !== revisionRef.current || requestId !== htmlRequestRef.current) return
      setHtmlRun(response.ok
        ? { busy: false, error: null, result: response.result }
        : { busy: false, error: response.error, result: null })
    } catch (error) {
      logger.error("HTML generation failed.", error)
      if (revision === revisionRef.current && requestId === htmlRequestRef.current) {
        setHtmlRun({ busy: false, error: { message: errorMessage(error) }, result: null })
      }
    }
  }

  const generateFile = async () => {
    setTemplateTouched(true)
    setOutputTouched(true)
    if (!canGenerateFile || !parsedData.ok) return
    const revision = revisionRef.current
    const requestId = ++fileRequestRef.current
    setFileRun({ busy: true, error: null, result: null })
    try {
      const response = await requireBridgeDomain("htmlGenerator").ejsFile.generate({
        template,
        data: parsedData.data,
        outputPath,
        overwrite,
      })
      if (revision !== revisionRef.current || requestId !== fileRequestRef.current) return
      setFileRun(response.ok
        ? { busy: false, error: null, result: response.result }
        : { busy: false, error: response.error, result: null })
    } catch (error) {
      logger.error("HTML file generation failed.", error)
      if (revision === revisionRef.current && requestId === fileRequestRef.current) {
        setFileRun({ busy: false, error: { message: errorMessage(error) }, result: null })
      }
    }
  }

  const chooseOutput = async () => {
    try {
      const selected = await requireBridgeDomain("htmlGenerator").output.choose({
        defaultPath: outputPath || "output.html",
      })
      if (!selected) return
      setOutputPath(selected)
      setOutputTouched(true)
      setFileRun(EMPTY_RUN_STATE)
    } catch (error) {
      logger.error("HTML output selection failed.", error)
      setFileRun({ busy: false, error: { message: errorMessage(error) }, result: null })
    }
  }

  const copyText = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast.success("已复制")
  }

  const currentResult = activeTab === "html" ? htmlRun.result : fileRun.result
  const actions = currentResult ? (
    <SystemAppTopBarActionButton
      onClick={() => void copyText(activeTab === "html"
        ? (htmlRun.result?.html ?? "")
        : (fileRun.result?.output.path ?? ""))}
    >
      <Copy data-icon="inline-start" />
      {activeTab === "html" ? "复制 HTML" : "复制路径"}
    </SystemAppTopBarActionButton>
  ) : undefined

  return (
    <SystemAppWindowShell tabs={TABS} value={activeTab} onValueChange={setActiveTab} actions={actions}>
      <ScrollArea className="h-full min-h-0">
        <main className="mx-auto grid w-full max-w-6xl gap-5 p-4 sm:p-6">
          <div className="grid gap-5 lg:grid-cols-2">
            <Field data-invalid={Boolean(templateError)}>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="html-generator-template">EJS 模板</FieldLabel>
                <p className="text-xs text-muted-foreground">EJS 模板会执行 JavaScript，仅使用可信内容</p>
              </div>
              <Textarea
                id="html-generator-template"
                value={template}
                onChange={(event) => {
                  invalidateShared()
                  setTemplate(event.target.value)
                }}
                onBlur={() => setTemplateTouched(true)}
                disabled={anyBusy}
                aria-invalid={Boolean(templateError)}
                className="min-h-72 resize-y font-mono text-sm"
                spellCheck={false}
                autoFocus
              />
              {templateError ? <FieldError>{templateError}</FieldError> : null}
              <p className="text-xs text-muted-foreground">{formatBytes(templateBytes)} / 256 KiB</p>
            </Field>

            <Field data-invalid={Boolean(dataError)}>
              <FieldLabel htmlFor="html-generator-data">JSON 数据</FieldLabel>
              <Textarea
                id="html-generator-data"
                value={dataText}
                onChange={(event) => {
                  invalidateShared()
                  setDataText(event.target.value)
                }}
                disabled={anyBusy}
                aria-invalid={Boolean(dataError)}
                className="min-h-72 resize-y font-mono text-sm"
                spellCheck={false}
              />
              {dataError ? <FieldError>{dataError}</FieldError> : null}
              {dataBytes !== null && !dataError ? (
                <p className="text-xs text-muted-foreground">{formatBytes(dataBytes)} / 512 KiB</p>
              ) : null}
            </Field>
          </div>

          {activeTab === "file" ? (
            <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <Field data-invalid={outputTouched && Boolean(pathError)}>
                <FieldLabel htmlFor="html-generator-output">输出文件</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    id="html-generator-output"
                    value={outputPath}
                    onChange={(event) => {
                      setOutputPath(event.target.value)
                      setFileRun(EMPTY_RUN_STATE)
                    }}
                    onBlur={() => setOutputTouched(true)}
                    disabled={fileRun.busy}
                    aria-invalid={outputTouched && Boolean(pathError)}
                  />
                  <Button type="button" variant="outline" className="mr-1" disabled={fileRun.busy} onClick={() => void chooseOutput()}>
                    <FolderOpen data-icon="inline-start" />
                    选择
                  </Button>
                </InputGroup>
                {outputTouched && pathError ? <FieldError>{pathError}</FieldError> : null}
              </Field>
              <Field orientation="horizontal" className="h-8 items-center gap-3">
                <FieldLabel htmlFor="html-generator-overwrite">覆盖已存在文件</FieldLabel>
                <Switch
                  id="html-generator-overwrite"
                  checked={overwrite}
                  disabled={fileRun.busy}
                  onCheckedChange={(checked) => {
                    setOverwrite(checked === true)
                    setFileRun(EMPTY_RUN_STATE)
                  }}
                />
              </Field>
            </div>
          ) : null}

          {inputError ? <p className="text-sm text-destructive" role="alert">{inputError}</p> : null}
          {activeTab === "html" && htmlRun.error ? <RunError error={htmlRun.error} /> : null}
          {activeTab === "file" && fileRun.error ? <RunError error={fileRun.error} /> : null}

          <div className="flex justify-end">
            {activeTab === "html" ? (
              <Button disabled={!canGenerateHtml} onClick={() => void generateHtml()}>
                {htmlRun.busy ? <Spinner data-icon="inline-start" /> : null}
                {htmlRun.busy ? "生成中" : "生成 HTML"}
              </Button>
            ) : (
              <Button disabled={!canGenerateFile} onClick={() => void generateFile()}>
                {fileRun.busy ? <Spinner data-icon="inline-start" /> : null}
                {fileRun.busy ? "生成并写入中" : "生成 HTML 文件"}
              </Button>
            )}
          </div>

          {activeTab === "html" && htmlRun.result ? (
            <section className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-sm font-medium">HTML 源码</h2>
                <span className="text-xs text-muted-foreground">{htmlRun.result.size} 字节</span>
              </div>
              <Textarea readOnly value={htmlRun.result.html} className="min-h-72 resize-y font-mono text-sm" spellCheck={false} />
            </section>
          ) : null}

          {activeTab === "file" && fileRun.result ? <FileResult result={fileRun.result} /> : null}
        </main>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function RunError({ error }: { readonly error: { readonly message: string; readonly line?: number } }) {
  return (
    <Alert variant="destructive">
      <AlertDescription>{error.line ? `${error.message} 第 ${error.line} 行` : error.message}</AlertDescription>
    </Alert>
  )
}

function FileResult({ result }: { readonly result: HtmlGenerationFileResult }) {
  const { output } = result
  return (
    <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
      <dt className="text-muted-foreground">路径</dt><dd className="break-all font-mono">{output.path}</dd>
      <dt className="text-muted-foreground">格式</dt><dd>{output.format}</dd>
      <dt className="text-muted-foreground">字节数</dt><dd>{output.size}</dd>
      <dt className="text-muted-foreground">已覆盖</dt><dd>{output.overwritten ? "是" : "否"}</dd>
    </dl>
  )
}

function parseJsonObject(value: string): { readonly ok: true; readonly data: JsonObject } | { readonly ok: false; readonly message: string } {
  try {
    const parsed = JSON.parse(value) as unknown
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, message: "JSON 数据必须是顶层对象。" }
    }
    return { ok: true, data: parsed as JsonObject }
  } catch {
    return { ok: false, message: "JSON 数据格式无效。" }
  }
}

function validateOutputPath(value: string, platform: string): string {
  if (!value) return "请选择输出文件。"
  const absolute = platform === "win32"
    ? /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value)
    : value.startsWith("/")
  if (!absolute) return "输出文件必须使用当前系统的绝对路径。"
  if (!/(?:^|[\\/])[^\\/]+\.(?:html|htm)$/i.test(value)) return "输出文件必须使用 .html 或 .htm 扩展名。"
  return ""
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false
    }
  }
  return true
}

function utf8Size(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function formatBytes(value: number): string {
  return value.toLocaleString("en-US") + " B"
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "HTML 生成失败。"
}
