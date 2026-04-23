import { useEffect, useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useLocalIdentity } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeUserIdInput, validateUserIdInput } from "@/lib/user-id-input"

const logger = createRendererLogger("app.repo-id-recovery")

type RepoIdRecoveryDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function RepoIdRecoveryDialog({ open, onOpenChange }: RepoIdRecoveryDialogProps) {
  const activeRepository = useActiveRepository()
  const { adoptExistingUserId } = useLocalIdentity()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const formatError = useMemo(() => validateUserIdInput(value), [value])

  useEffect(() => {
    if (!open) {
      setValue("")
      setError(null)
      setIsSubmitting(false)
    }
  }, [open])

  const handleSubmit = () => {
    if (!activeRepository) {
      setError("先选择当前目录，再通过 ID 恢复。")
      return
    }

    const normalizedValue = normalizeUserIdInput(value)

    setIsSubmitting(true)
    setError(null)
    const startedAt = performance.now()
    logger.info("Repo id recovery submitted.", { repositoryUuid: activeRepository.uuid })

    void adoptExistingUserId(normalizedValue, activeRepository.uuid)
      .then(() => {
        logger.info("Repo id recovery succeeded.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          repositoryUuid: activeRepository.uuid,
        })
        setValue("")
        setError(null)
        onOpenChange(false)
      })
      .catch((submitError) => {
        logger.error("Repo id recovery failed.", {
          elapsedMs: Math.round(performance.now() - startedAt),
          error: submitError,
          repositoryUuid: activeRepository.uuid,
        })
        setError(submitError instanceof Error ? submitError.message : "恢复身份失败。")
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>通过 ID 恢复</DialogTitle>
          <DialogDescription>输入需要恢复的用户 ID。</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="repo-id-recovery-user-id">用户 ID</Label>
          <Input
            id="repo-id-recovery-user-id"
            value={value}
            className="font-mono"
            autoFocus
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(validateUserIdInput(event.target.value))
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !isSubmitting && !formatError && activeRepository) {
                event.preventDefault()
                handleSubmit()
              }
            }}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!activeRepository ? (
            <p className="text-sm text-muted-foreground">先选择当前目录，再通过 ID 恢复。</p>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            取消
          </Button>
          <Button
            type="button"
            disabled={isSubmitting || !activeRepository || Boolean(formatError)}
            onClick={handleSubmit}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="animate-spin" />
                校验中...
              </>
            ) : (
              "确认恢复"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { RepoIdRecoveryDialog }
