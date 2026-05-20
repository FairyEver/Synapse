import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormDialog } from "@/components/form-dialog"
import type { RepositoryVariableChangeSet } from "@/modules/content/lib/repository-variables"
import type { SynapseVariable } from "@/types/config"

type VariableSaveConfirmationDialogProps = {
  changes: RepositoryVariableChangeSet | null
  isSubmitting: boolean
  onOpenChange: (open: boolean) => void
  onSave: () => Promise<void> | void
  onSkip: () => Promise<void> | void
  open: boolean
}

type VariableSectionProps = {
  label: string
  variables: SynapseVariable[]
}

function VariableSection({ label, variables }: VariableSectionProps) {
  if (variables.length === 0) {
    return null
  }

  return (
    <div className="flex flex-col gap-2">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <ul className="flex flex-col gap-1">
        {variables.map((variable) => (
          <li key={variable.name} className="font-mono text-sm">
            {variable.name}
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
  const newVariables = changes?.newVariables ?? []
  const updatedVariables = changes?.updatedVariables ?? []
  const hasBothSections = newVariables.length > 0 && updatedVariables.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="保存变量变更"
        description="这些变量可在当前仓库复用。"
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
          <VariableSection label="新增变量" variables={newVariables} />
          {hasBothSections ? <Separator /> : null}
          <VariableSection label="更新变量" variables={updatedVariables} />
        </div>
      </FormDialog>
    </Dialog>
  )
}

export { VariableSaveConfirmationDialog }
