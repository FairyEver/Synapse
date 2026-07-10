import { useCallback, useEffect, useId, useMemo, useState } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { SynapseSkillEnvDeclaration } from "@/types/installers"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"

type SkillEnvValuesDialogProps = {
  declarations: SynapseSkillEnvDeclaration[]
  initialValues: Record<string, string>
  isProjectScope: boolean
  onConfirm: (values: Record<string, string>) => Promise<void> | void
  onOpenChange: (open: boolean) => void
  open: boolean
  secrets: SecretSafeView[]
}

function matchSecret(name: string, secrets: SecretSafeView[]): SecretSafeView | undefined {
  return secrets.find((secret) => secret.name === name)
    ?? secrets.find((secret) => secret.name.toLowerCase() === name.toLowerCase())
}

function SkillEnvValuesDialog({
  declarations,
  initialValues,
  isProjectScope,
  onConfirm,
  onOpenChange,
  open,
  secrets,
}: SkillEnvValuesDialogProps) {
  const formId = useId()
  const [values, setValues] = useState<Record<string, string>>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const resolvedInitialValues = useMemo(() => Object.fromEntries(
    declarations.map(({ name }) => [name, initialValues[name] ?? ""]),
  ), [declarations, initialValues])

  useEffect(() => {
    if (open) {
      setValues(resolvedInitialValues)
      setIsSubmitting(false)
    }
  }, [open, resolvedInitialValues])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      await onConfirm(Object.fromEntries(
        declarations.map(({ name }) => [name, values[name] ?? ""]),
      ))
    } finally {
      setIsSubmitting(false)
    }
  }, [declarations, isSubmitting, onConfirm, values])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="Skill 配置"
        description="这些值会写入 Skill 目录中的 .env。"
        footer={(
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "安装中..." : "继续安装"}
          </Button>
        )}
        onSubmit={(event) => {
          event.preventDefault()
          void handleSubmit()
        }}
      >
        <div className="flex flex-col">
          {isProjectScope ? (
            <p className="mb-3 text-sm text-muted-foreground">
              请确认 .env 不会被提交到 Git。
            </p>
          ) : null}
          {declarations.map(({ name }, index) => {
            const inputId = `${formId}-${index}`
            return (
              <div key={name}>
                {index > 0 ? <Separator className="my-3" /> : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={inputId} className="font-mono text-xs text-muted-foreground">
                    {name}
                  </Label>
                  <Input
                    id={inputId}
                    placeholder={matchSecret(name, secrets)?.hasValue ? "已保存" : "配置值"}
                    disabled={isSubmitting}
                    value={values[name] ?? ""}
                    onChange={(event) => {
                      setValues((current) => ({ ...current, [name]: event.target.value }))
                    }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </FormDialog>
    </Dialog>
  )
}

export { SkillEnvValuesDialog }
