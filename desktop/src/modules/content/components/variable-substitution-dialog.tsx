import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormDialog } from "@/components/form-dialog"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"

type VariableSubstitutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  placeholders: string[]
  secrets: SecretSafeView[]
  initialValues: Record<string, string>
  onConfirm: (substitutions: Record<string, string>) => Promise<void> | void
}

function matchSecret(
  name: string,
  secrets: SecretSafeView[],
): SecretSafeView | undefined {
  const exact = secrets.find((v) => v.name === name)
  if (exact) return exact
  return secrets.find((v) => v.name.toLowerCase() === name.toLowerCase())
}

function VariableSubstitutionDialog({
  open,
  onOpenChange,
  placeholders,
  secrets,
  initialValues,
  onConfirm,
}: VariableSubstitutionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  const resolvedInitialValues = useMemo(() => {
    const result: Record<string, string> = {}
    for (const name of placeholders) {
      result[name] = initialValues[name] ?? ""
    }
    return result
  }, [initialValues, placeholders])

  useEffect(() => {
    if (open) {
      setValues(resolvedInitialValues)
      setIsSubmitting(false)
    }
  }, [open, resolvedInitialValues])

  const handleValueChange = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    setIsSubmitting(true)
    try {
      await onConfirm(values)
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, onConfirm, values])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="变量替换"
        description="留空则保留原文。"
        footer={
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "安装中..." : "继续安装"}
          </Button>
        }
        onSubmit={(e) => {
          e.preventDefault()
          void handleSubmit()
        }}
      >
        <div className="flex flex-col">
          {placeholders.map((name, index) => (
            <div key={name}>
              {index > 0 ? <Separator className="my-3" /> : null}
              <div className="flex flex-col gap-2">
                <Label className="font-mono text-xs text-muted-foreground">
                  {"${{ "}{name}{" }}"}
                </Label>
                <Input
                  placeholder={matchSecret(name, secrets)?.hasValue ? "已保存" : "替换值"}
                  disabled={isSubmitting}
                  value={values[name] ?? ""}
                  onChange={(e) => handleValueChange(name, e.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      </FormDialog>
    </Dialog>
  )
}

export { VariableSubstitutionDialog }
