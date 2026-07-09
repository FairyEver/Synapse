import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormDialog } from "@/components/form-dialog"
import type { UserSecretChangeSet } from "@/modules/content/lib/repository-variables"
import type { SecretUpsertInput } from "../../../../app-capabilities/secrets/shared/schema"

type VariableSaveConfirmationDialogProps = {
  changes: UserSecretChangeSet | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => Promise<void> | void
  onSkip: () => Promise<void> | void
  open: boolean
}

type SecretSectionProps = {
  label: string
  secrets: SecretUpsertInput[]
}

function SecretSection({ label, secrets }: SecretSectionProps) {
  if (secrets.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <ul className="flex flex-col gap-1">
        {secrets.map((secret) => (
          <li key={secret.name} className="font-mono text-sm">
            {secret.name}
          </li>
        ))}
      </ul>
    </div>
  )
}

function VariableSaveConfirmationDialog({
  changes,
  isSubmitting,
  onOpenChange,
  onSave,
  onSkip,
  open,
}: VariableSaveConfirmationDialogProps) {
  const newSecrets = changes?.newSecrets ?? []
  const updatedSecrets = changes?.updatedSecrets ?? []
  const hasBothSections = newSecrets.length > 0 && updatedSecrets.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="保存密钥"
        description="这些密钥可在之后安装内容时复用。"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => { void onSkip() }}
            >
              仅本次使用
            </Button>
            <Button
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "保存中..." : "保存并继续"}
            </Button>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault()
          void onSave()
        }}
      >
        <div className="flex flex-col gap-2">
          <SecretSection label="新增密钥" secrets={newSecrets} />
          {hasBothSections ? <Separator /> : null}
          <SecretSection label="更新密钥" secrets={updatedSecrets} />
        </div>
      </FormDialog>
    </Dialog>
  )
}

export { VariableSaveConfirmationDialog }
