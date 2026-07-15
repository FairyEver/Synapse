import { useCallback, useEffect, useId, useMemo, useState } from "react"

import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { SynapseSkillEnvDeclaration } from "@/types/installers"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"

type SkillEnvValuesDialogProps = {
  declarations: SynapseSkillEnvDeclaration[]
  initialValues: Record<string, string>
  isProjectScope: boolean
  onConfirm: (
    values: Record<string, string>,
    secretNames: Record<string, string>,
  ) => Promise<void> | void
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
  const [replacedSecretNames, setReplacedSecretNames] = useState<Set<string>>(new Set())
  const [isSubmitting, setIsSubmitting] = useState(false)
  const resolvedInitialValues = useMemo(() => Object.fromEntries(
    declarations.map(({ name }) => [name, initialValues[name] ?? ""]),
  ), [declarations, initialValues])

  useEffect(() => {
    if (open) {
      setValues(resolvedInitialValues)
      setReplacedSecretNames(new Set())
      setIsSubmitting(false)
    }
  }, [open, resolvedInitialValues])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return

    setIsSubmitting(true)
    try {
      const confirmedValues: Record<string, string> = {}
      const confirmedSecretNames: Record<string, string> = {}
      for (const { name } of declarations) {
        const secret = matchSecret(name, secrets)
        const reusing = secret?.hasValue && !replacedSecretNames.has(name)
        if (reusing) confirmedSecretNames[name] = secret.name
        else confirmedValues[name] = values[name] ?? ""
      }
      await onConfirm(confirmedValues, confirmedSecretNames)
    } finally {
      setIsSubmitting(false)
    }
  }, [declarations, isSubmitting, onConfirm, replacedSecretNames, secrets, values])

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
            const savedSecret = matchSecret(name, secrets)
            const reusing = Boolean(savedSecret?.hasValue) && !replacedSecretNames.has(name)
            return (
              <div key={name}>
                {index > 0 ? <Separator className="my-3" /> : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={inputId} className="font-mono text-xs text-muted-foreground">
                    {name}
                  </Label>
                  <InputGroup>
                    <InputGroupInput
                      id={inputId}
                      placeholder={reusing ? "已保存" : "配置值"}
                      disabled={isSubmitting || reusing}
                      value={reusing ? "" : values[name] ?? ""}
                      onChange={(event) => {
                        setValues((current) => ({ ...current, [name]: event.target.value }))
                      }}
                    />
                    {savedSecret?.hasValue ? (
                      <InputGroupAddon align="inline-end">
                        <InputGroupButton
                          disabled={isSubmitting}
                          onClick={() => {
                            setReplacedSecretNames((current) => {
                              const next = new Set(current)
                              if (reusing) next.add(name)
                              else next.delete(name)
                              return next
                            })
                            setValues((current) => ({ ...current, [name]: "" }))
                          }}
                        >
                          {reusing ? "替换" : "使用已保存"}
                        </InputGroupButton>
                      </InputGroupAddon>
                    ) : null}
                  </InputGroup>
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
