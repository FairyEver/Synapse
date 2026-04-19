import { useMemo, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { useLocalIdentity } from "@/app-shell/identity-context"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { normalizeUserIdInput, validateUserIdInput } from "@/lib/user-id-input"

type AdoptIdentityDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AdoptIdentityDialog({
  open,
  onOpenChange,
}: AdoptIdentityDialogProps) {
  const { activeRepository } = useAppConfig()
  const { adoptExistingUserId } = useLocalIdentity()
  const [value, setValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const normalizedValue = useMemo(() => normalizeUserIdInput(value), [value])

  const handleSubmit = () => {
    if (!activeRepository) {
      setError("先选择当前目录，再接续已有身份。")
      return
    }

    setIsSubmitting(true)
    setError(null)

    void adoptExistingUserId(normalizedValue, activeRepository.uuid)
      .then(() => {
        setValue("")
        setError(null)
        onOpenChange(false)
      })
      .catch((submitError) => {
        setError(submitError instanceof Error ? submitError.message : "接续身份失败。")
      })
      .finally(() => {
        setIsSubmitting(false)
      })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>接续已有身份</DialogTitle>
          <DialogDescription>
            只在当前目录里校验这个 ID。Git 仓库会先检查远端连通性；如果这个 ID 是刚同步过来的，先手动同步仓库再试。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Label htmlFor="adopt-identity-user-id">用户 ID</Label>
          <Input
            id="adopt-identity-user-id"
            value={value}
            className="font-mono"
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setValue(event.target.value)
              setError(validateUserIdInput(event.target.value))
            }}
          />
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {!activeRepository ? (
            <p className="text-sm text-muted-foreground">先在 Settings 里选一个当前目录。</p>
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
            disabled={
              isSubmitting
              || !activeRepository
              || Boolean(validateUserIdInput(value))
            }
            onClick={handleSubmit}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="animate-spin" />
                校验中...
              </>
            ) : (
              "确认接续"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { AdoptIdentityDialog }
