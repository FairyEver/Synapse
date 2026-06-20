import { useEffect, useState, type FormEvent } from "react"
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

type GitSshKeyDialogProps = {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly defaultEmail?: string | null
  readonly onGenerate: (input: { readonly email: string }) => Promise<string | null | void>
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export function GitSshKeyDialog({
  open,
  onOpenChange,
  defaultEmail,
  onGenerate,
}: GitSshKeyDialogProps) {
  const [email, setEmail] = useState(defaultEmail ?? "")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setEmail(defaultEmail ?? "")
      setError(null)
      setBusy(false)
      return
    }
    setError(null)
    setBusy(false)
  }, [defaultEmail, open])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const trimmedEmail = email.trim()
    if (!trimmedEmail) {
      setError("请输入邮箱。")
      return
    }

    setBusy(true)
    try {
      const submitError = await onGenerate({ email: trimmedEmail })
      if (submitError) {
        setError(submitError)
        return
      }
      onOpenChange(false)
    } catch (err) {
      setError(errorMessage(err, "生成 SSH 密钥失败。"))
    } finally {
      setBusy(false)
    }
  }

  const handleOpenChange = (nextOpen: boolean) => {
    if (!busy) onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} data-track="git-ssh-key-dialog">
      <DialogContent className="sm:max-w-md" showCloseButton={!busy} aria-describedby={undefined}>
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>生成 SSH 密钥</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={error === "请输入邮箱。" ? true : undefined}>
              <FieldLabel htmlFor="git-ssh-key-email">邮箱</FieldLabel>
              <Input
                id="git-ssh-key-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={busy}
                aria-invalid={error === "请输入邮箱。"}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="git-ssh-key-path">路径</FieldLabel>
              <Input id="git-ssh-key-path" value="~/.ssh/id_ed25519.pub" readOnly disabled={busy} />
            </Field>
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Spinner data-icon="inline-start" /> : null}
              生成
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
