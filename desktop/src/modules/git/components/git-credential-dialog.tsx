import { useEffect, useState, type FormEvent } from "react"
import { ExternalLinkIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseGitProvider } from "@/types/git"

export type GitCredentialDialogMode = "generic" | "github-token"

export type GitCredentialSubmitInput = {
  readonly username: string
  readonly password: string
}

type GitCredentialDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly host: string
  readonly mode: GitCredentialDialogMode
  readonly provider: SynapseGitProvider
  readonly tokenUrl?: string | null
  readonly onSubmit: (input: GitCredentialSubmitInput) => Promise<string | null | void>
}

function titleForMode(mode: GitCredentialDialogMode): string {
  return mode === "github-token" ? "使用访问令牌" : "登录仓库"
}

function secretLabelForMode(mode: GitCredentialDialogMode): string {
  return mode === "github-token" ? "访问令牌" : "密码"
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function GitCredentialDialog({
  open,
  onOpenChange,
  host,
  mode,
  tokenUrl,
  onSubmit,
}: GitCredentialDialogProps) {
  const [username, setUsername] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const title = titleForMode(mode)
  const secretLabel = secretLabelForMode(mode)

  useEffect(() => {
    if (!open) {
      setUsername("")
      setPassword("")
      setError(null)
      setBusy(false)
    }
  }, [open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const trimmedUsername = username.trim()
    const trimmedPassword = password.trim()
    if (!trimmedUsername) {
      setError("请输入账号。")
      setPassword("")
      return
    }
    if (!trimmedPassword) {
      setError(`请输入${secretLabel}。`)
      return
    }

    setBusy(true)
    try {
      const submitError = await onSubmit({
        password,
        username: trimmedUsername,
      })
      setPassword("")
      if (submitError) {
        setError(submitError)
        return
      }
      onOpenChange(false)
    } catch (err) {
      setPassword("")
      setError(errorMessage(err, "保存凭据失败。"))
    } finally {
      setBusy(false)
    }
  }

  const openTokenPage = async () => {
    if (!tokenUrl) return
    setError(null)
    try {
      await requireSynapseBridge().shell.openExternal(tokenUrl)
    } catch (err) {
      setError(errorMessage(err, "打开令牌页面失败。"))
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!busy) onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} data-track="git-credential-dialog">
      <DialogContent className="sm:max-w-md" showCloseButton={!busy} aria-describedby={undefined}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="git-credential-host">主机</FieldLabel>
              <Input id="git-credential-host" value={host} readOnly disabled={busy} />
            </Field>
            <Field data-invalid={error === "请输入账号。" ? true : undefined}>
              <FieldLabel htmlFor="git-credential-username">账号</FieldLabel>
              <Input
                id="git-credential-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
                disabled={busy}
                aria-invalid={error === "请输入账号。"}
              />
            </Field>
            <Field data-invalid={error?.includes(secretLabel) ? true : undefined}>
              <FieldLabel htmlFor="git-credential-password">{secretLabel}</FieldLabel>
              <Input
                id="git-credential-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                disabled={busy}
                aria-invalid={error?.includes(secretLabel)}
              />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            {mode === "github-token" && tokenUrl ? (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => void openTokenPage()}>
                <ExternalLinkIcon data-icon="inline-start" />
                打开令牌页面
              </Button>
            ) : null}
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              保存
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
