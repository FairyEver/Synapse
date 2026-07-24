import { useState, type FormEvent } from "react"
import { FilePenLine, FolderOpen } from "lucide-react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent, CardFooter } from "../../../src/components/ui/card"
import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../src/components/ui/select"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import {
  DEFAULT_TEXT_FILE_ENCODING,
  DEFAULT_TEXT_FILE_OVERWRITE,
  TEXT_FILE_ENCODINGS,
  type TextFileEncoding,
  type TextFileWriteResult,
} from "../shared/schema"

const logger = createRendererLogger("text-file-writer.app")

type WriteStatus =
  | { readonly kind: "success"; readonly result: TextFileWriteResult }
  | { readonly kind: "error"; readonly message: string }

export function TextFileWriterModule() {
  const [text, setText] = useState("")
  const [path, setPath] = useState("")
  const [encoding, setEncoding] = useState<TextFileEncoding>(DEFAULT_TEXT_FILE_ENCODING)
  const [overwrite, setOverwrite] = useState<boolean>(DEFAULT_TEXT_FILE_OVERWRITE)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<WriteStatus | null>(null)
  const canWrite = path.length > 0 && !busy

  const clearStatus = () => setStatus(null)

  const chooseOutput = async () => {
    try {
      const selected = await requireBridgeDomain("textFileWriter").output.choose({
        defaultPath: path || "output.md",
      })
      if (selected) {
        clearStatus()
        setPath(selected)
      }
    } catch (error) {
      logger.error("Text file output selection failed.", error)
      setStatus({ kind: "error", message: errorMessage(error) })
    }
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canWrite) return
    setBusy(true)
    clearStatus()
    try {
      const response = await requireBridgeDomain("textFileWriter").file.write({
        text,
        path,
        encoding,
        overwrite,
      })
      setStatus(response.ok
        ? { kind: "success", result: response.result }
        : { kind: "error", message: response.error.message })
    } catch (error) {
      logger.error("Text file write failed.", error)
      setStatus({ kind: "error", message: errorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const revealResult = async () => {
    if (status?.kind !== "success") return
    try {
      await requireBridgeDomain("shell").showItemInFolder(status.result.path)
    } catch (error) {
      logger.error("Text file reveal failed.", error)
      setStatus({ kind: "error", message: "无法在文件夹中显示文件。" })
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <form className="mx-auto w-full max-w-3xl p-3 sm:p-5" onSubmit={submit} aria-busy={busy}>
          <Card className="py-0">
            <CardContent className="grid gap-5 p-4 sm:p-5">
              <FieldGroup className="gap-4">
                <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)]">
                  <FieldLabel htmlFor="text-file-writer-text">文本内容</FieldLabel>
                  <Textarea
                    id="text-file-writer-text"
                    value={text}
                    onChange={(event) => {
                      clearStatus()
                      setText(event.target.value)
                    }}
                    disabled={busy}
                    className="min-h-64 resize-y font-mono text-sm"
                    spellCheck={false}
                    autoFocus
                  />
                </Field>
                <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                  <FieldLabel htmlFor="text-file-writer-path">文件路径</FieldLabel>
                  <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                    <InputGroup>
                      <InputGroupAddon><FilePenLine className="size-4 text-muted-foreground" /></InputGroupAddon>
                      <InputGroupInput
                        id="text-file-writer-path"
                        value={path}
                        onChange={(event) => {
                          clearStatus()
                          setPath(event.target.value)
                        }}
                        disabled={busy}
                        placeholder="绝对路径"
                      />
                    </InputGroup>
                    <Button type="button" variant="outline" disabled={busy} onClick={() => void chooseOutput()}>
                      <FolderOpen data-icon="inline-start" />
                      选择
                    </Button>
                  </div>
                </Field>
              </FieldGroup>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field orientation="horizontal" className="items-center justify-between gap-3">
                  <FieldContent>
                    <FieldLabel htmlFor="text-file-writer-encoding">字符编码</FieldLabel>
                  </FieldContent>
                  <Select
                    value={encoding}
                    disabled={busy}
                    onValueChange={(value) => {
                      clearStatus()
                      setEncoding(value as TextFileEncoding)
                    }}
                  >
                    <SelectTrigger id="text-file-writer-encoding" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEXT_FILE_ENCODINGS.map((value) => (
                        <SelectItem key={value} value={value}>{encodingLabel(value)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field orientation="horizontal" className="items-center justify-between gap-3">
                  <FieldContent><FieldLabel htmlFor="text-file-writer-overwrite">覆盖已存在文件</FieldLabel></FieldContent>
                  <Switch
                    id="text-file-writer-overwrite"
                    checked={overwrite}
                    disabled={busy}
                    onCheckedChange={(checked) => {
                      clearStatus()
                      setOverwrite(checked === true)
                    }}
                  />
                </Field>
              </div>
            </CardContent>
            <CardFooter className="flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center">
              <WriteSummary busy={busy} path={path} status={status} onReveal={revealResult} />
              <Button type="submit" className="w-full sm:w-28" disabled={!canWrite}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {busy ? "写入中" : "写入文件"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function WriteSummary({ busy, path, status, onReveal }: {
  readonly busy: boolean
  readonly path: string
  readonly status: WriteStatus | null
  readonly onReveal: () => Promise<void>
}) {
  if (status?.kind === "error") {
    return <p className="flex min-h-8 items-center text-sm text-destructive" role="alert">{status.message}</p>
  }
  if (status?.kind === "success") {
    return (
      <div className="flex min-h-8 min-w-0 flex-1 items-center justify-between gap-3" role="status">
        <p className="min-w-0 truncate text-sm text-muted-foreground">已写入 {status.result.size} 字节</p>
        <Button type="button" variant="ghost" size="sm" onClick={() => void onReveal()}>在文件夹中显示</Button>
      </div>
    )
  }
  return (
    <p className="flex min-h-8 items-center text-sm text-muted-foreground" role="status" aria-live="polite">
      {busy ? "写入中" : path ? "可写入" : "请输入文件路径"}
    </p>
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "文本写入文件失败。"
}

function encodingLabel(encoding: TextFileEncoding): string {
  return encoding === "utf8" ? "UTF-8" : "UTF-16 LE"
}
