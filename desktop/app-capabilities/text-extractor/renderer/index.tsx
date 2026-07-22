import { useMemo, type FormEvent } from "react"
import { CircleAlert, Copy, FileText, FolderOpen, Save } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import { Button } from "../../../src/components/ui/button"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../src/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Textarea } from "../../../src/components/ui/textarea"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { TextExtractionResult } from "../shared/schema"
import {
  useTextExtractor,
  type TextExtractionPhase,
} from "./use-text-extractor"

const PREVIEW_BYTE_LIMIT = 200 * 1024

export function TextExtractorModule() {
  const {
    busy,
    cancelExtraction,
    chooseDocument,
    copyText,
    error,
    extractDocument,
    filePath,
    phase,
    result,
    saveText,
  } = useTextExtractor()
  const preview = useMemo(() => result ? createPreview(result.text) : null, [result])

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) {
      void cancelExtraction()
      return
    }
    void extractDocument()
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <form className="mx-auto grid w-full max-w-3xl gap-3 p-3 sm:p-5" onSubmit={submit} aria-busy={busy}>
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              <FieldGroup>
                <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                  <FieldLabel htmlFor="text-extractor-path">文档文件</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <InputGroup>
                      <InputGroupAddon><FileText /></InputGroupAddon>
                      <InputGroupInput
                        id="text-extractor-path"
                        value={filePath}
                        placeholder="选择 .pdf 或 .docx 文件"
                        readOnly
                        disabled={busy}
                      />
                    </InputGroup>
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full sm:w-24"
                      disabled={busy}
                      aria-label="选择文档文件"
                      onClick={() => void chooseDocument()}
                    >
                      <FolderOpen data-icon="inline-start" />
                      选择
                    </Button>
                  </div>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
              <Status phase={phase} hasFile={Boolean(filePath)} />
              <Button
                type="submit"
                variant={busy ? "outline" : "default"}
                className="w-full sm:w-28"
                disabled={!filePath}
              >
                {busy ? "取消提取" : "提取文本"}
              </Button>
            </CardFooter>
          </Card>

          {error ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>提取失败</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {result ? (
            <Card className="py-0">
              <CardHeader className="border-b py-3 sm:py-4">
                <div className="min-w-0">
                  <CardTitle><h2 id="text-extractor-result-title">提取结果</h2></CardTitle>
                  <CardDescription>{formatResultSummary(result)}</CardDescription>
                </div>
                <CardAction className="flex items-center gap-2">
                  <Button type="button" variant="outline" size="sm" disabled={!result.text} onClick={() => void copyText()}>
                    <Copy data-icon="inline-start" />
                    复制文本
                  </Button>
                  <Button type="button" variant="outline" size="sm" disabled={!result.text} onClick={() => void saveText()}>
                    <Save data-icon="inline-start" />
                    保存文本
                  </Button>
                </CardAction>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <ResultView result={result} preview={preview} />
              </CardContent>
            </Card>
          ) : null}
        </form>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function Status(props: { readonly phase: TextExtractionPhase; readonly hasFile: boolean }) {
  const label = props.phase === "waiting"
    ? "等待提取"
    : props.phase === "running"
      ? "提取中"
      : props.phase === "cancelled"
        ? "已取消"
        : props.phase === "error"
          ? "提取失败"
          : props.phase === "success"
            ? "提取完成"
            : props.hasFile
              ? "可开始提取"
              : "请选择文档"

  return (
    <div className="flex min-h-8 items-center gap-2 text-sm text-muted-foreground" role="status" aria-live="polite">
      {props.phase === "waiting" || props.phase === "running" ? <Spinner /> : null}
      <span>{label}</span>
    </div>
  )
}

function ResultView(props: {
  readonly result: TextExtractionResult
  readonly preview: { readonly text: string; readonly truncated: boolean } | null
}) {
  const hasText = props.result.text.length > 0

  return (
    <section className="flex flex-col gap-3" aria-labelledby="text-extractor-result-title">
      {hasText ? (
        <>
          <Textarea
            aria-label="提取文本预览"
            value={props.preview?.text ?? ""}
            readOnly
            spellCheck={false}
            className="min-h-64 resize-y font-mono text-sm"
          />
          {props.preview?.truncated ? (
            <p className="text-sm text-muted-foreground">仅显示前 200 KiB，复制和保存包含完整文本</p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">未提取到文本</p>
      )}
    </section>
  )
}

function createPreview(text: string): { readonly text: string; readonly truncated: boolean } {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(text)
  if (bytes.byteLength <= PREVIEW_BYTE_LIMIT) {
    return { text, truncated: false }
  }
  let end = PREVIEW_BYTE_LIMIT
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1
  return { text: new TextDecoder().decode(bytes.subarray(0, end)), truncated: true }
}

function formatResultSummary(result: TextExtractionResult): string {
  const parts = [result.format.toUpperCase()]
  if (result.format === "pdf" && result.pages !== undefined) parts.push(`${result.pages} 页`)
  parts.push(formatByteSize(new TextEncoder().encode(result.text).byteLength))
  return parts.join(" · ")
}

function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}
