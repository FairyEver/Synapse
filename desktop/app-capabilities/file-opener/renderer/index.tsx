import { useState, type FormEvent } from "react"
import { FileText } from "lucide-react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent, CardFooter } from "../../../src/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "../../../src/components/ui/input-group"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { startTrackedOperation } from "../../../src/lib/ui-tracking"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"

const logger = createRendererLogger("file-opener.app")

export function FileOpenerModule() {
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null)
  const canOpen = path.length > 0 && !busy

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canOpen) return
    const finishTracking = startTrackedOperation({ component: "file-opener", eventKey: "file-opener.file.open" })
    setBusy(true)
    setStatus(null)
    try {
      await requireBridgeDomain("fileOpener").file.open({ path })
      finishTracking("success")
      setStatus({ kind: "success", message: "已提交打开请求" })
    } catch (error) {
      finishTracking("failure")
      logger.error("File open request failed.", error)
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "打开文件失败" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SystemAppWindowShell>
      <ScrollArea className="h-full min-h-0">
        <form className="mx-auto w-full max-w-2xl p-3 sm:p-5" onSubmit={submit} aria-busy={busy} data-track="file-opener.file.open">
          <Card className="py-0">
            <CardContent className="p-4 sm:p-5">
              <FieldGroup>
                <Field className="gap-2 md:grid md:grid-cols-[7rem_minmax(0,1fr)] md:items-center">
                  <FieldLabel htmlFor="file-opener-path">文件路径</FieldLabel>
                  <InputGroup>
                    <InputGroupAddon><FileText /></InputGroupAddon>
                    <InputGroupInput
                      id="file-opener-path"
                      value={path}
                      placeholder="输入绝对路径"
                      onChange={(event) => {
                        setPath(event.target.value)
                        setStatus(null)
                      }}
                      disabled={busy}
                      autoFocus
                    />
                  </InputGroup>
                </Field>
              </FieldGroup>
            </CardContent>
            <CardFooter className="flex-col items-stretch justify-between gap-2 sm:flex-row sm:items-center">
              <OpenStatus busy={busy} hasPath={path.length > 0} status={status} />
              <Button type="submit" className="w-full sm:w-28" disabled={!canOpen}>
                {busy ? <Spinner data-icon="inline-start" /> : null}
                {busy ? "打开中" : "打开文件"}
              </Button>
            </CardFooter>
          </Card>
        </form>
      </ScrollArea>
    </SystemAppWindowShell>
  )
}

function OpenStatus({ busy, hasPath, status }: {
  readonly busy: boolean
  readonly hasPath: boolean
  readonly status: { readonly kind: "success" | "error"; readonly message: string } | null
}) {
  if (status) {
    return (
      <p
        className={status.kind === "error"
          ? "flex min-h-8 items-center text-sm text-destructive"
          : "flex min-h-8 items-center text-sm text-muted-foreground"}
        role={status.kind === "error" ? "alert" : "status"}
      >
        {status.message}
      </p>
    )
  }

  return (
    <p className="flex min-h-8 items-center text-sm text-muted-foreground" role="status" aria-live="polite">
      {busy ? "打开中" : hasPath ? "可打开" : "请输入文件路径"}
    </p>
  )
}
