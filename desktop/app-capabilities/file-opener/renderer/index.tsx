import { useState, type FormEvent } from "react"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Button } from "../../../src/components/ui/button"
import { Card, CardContent } from "../../../src/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Spinner } from "../../../src/components/ui/spinner"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"

const logger = createRendererLogger("file-opener.app")

export function FileOpenerModule() {
  const [path, setPath] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<{ kind: "success" | "error"; message: string } | null>(null)

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy || path.length === 0) return
    setBusy(true)
    setStatus(null)
    try {
      await requireBridgeDomain("fileOpener").file.open({ path })
      setStatus({ kind: "success", message: "已提交打开请求" })
    } catch (error) {
      logger.error("File open request failed.", error)
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "打开文件失败" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SystemAppWindowShell>
      <div className="grid h-full place-items-center p-4">
        <Card className="w-full max-w-xl py-0">
          <CardContent className="p-5">
            <form className="grid gap-4" onSubmit={submit} aria-busy={busy}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="file-opener-path">文件路径</FieldLabel>
                  <Input
                    id="file-opener-path"
                    value={path}
                    onChange={(event) => {
                      setPath(event.target.value)
                      setStatus(null)
                    }}
                    disabled={busy}
                    autoFocus
                  />
                </Field>
              </FieldGroup>
              <Button type="submit" disabled={busy || path.length === 0}>
                {busy ? <Spinner /> : null}
                打开
              </Button>
              {status ? (
                <p
                  className={status.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}
                  role={status.kind === "error" ? "alert" : "status"}
                >
                  {status.message}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>
      </div>
    </SystemAppWindowShell>
  )
}

