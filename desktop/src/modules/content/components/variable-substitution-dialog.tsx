import { useCallback, useEffect, useId, useMemo, useState } from "react"
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
import { FormDialog } from "@/components/form-dialog"
import type { SecretSafeView } from "../../../../app-capabilities/secrets/shared/schema"

type VariableSubstitutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  placeholders: string[]
  secrets: SecretSafeView[]
  initialValues: Record<string, string>
  onConfirm: (
    substitutions: Record<string, string>,
    secretNames: Record<string, string>,
  ) => Promise<void> | void
  showOneShotWarning?: boolean
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
  showOneShotWarning = false,
}: VariableSubstitutionDialogProps) {
  const formId = useId()
  const [values, setValues] = useState<Record<string, string>>({})
  const [replacedSecretNames, setReplacedSecretNames] = useState<Set<string>>(new Set())
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
      setReplacedSecretNames(new Set())
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
      const confirmedValues: Record<string, string> = {}
      const confirmedSecretNames: Record<string, string> = {}
      for (const name of placeholders) {
        const secret = matchSecret(name, secrets)
        const reusing = secret?.hasValue && !replacedSecretNames.has(name)
        if (reusing) confirmedSecretNames[name] = secret.name
        else confirmedValues[name] = values[name] ?? ""
      }
      await onConfirm(confirmedValues, confirmedSecretNames)
    } finally {
      setIsSubmitting(false)
    }
  }, [isSubmitting, onConfirm, placeholders, replacedSecretNames, secrets, values])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!isSubmitting) onOpenChange(next)
      }}
    >
      <FormDialog
        title="变量替换"
        description={showOneShotWarning ? "安装后无法同步；留空则保留原文。" : "留空则保留原文。"}
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
          {placeholders.map((name, index) => {
            const inputId = `${formId}-${index}`
            const savedSecret = matchSecret(name, secrets)
            const reusing = Boolean(savedSecret?.hasValue) && !replacedSecretNames.has(name)
            return (
              <div key={name}>
                {index > 0 ? <Separator className="my-3" /> : null}
                <div className="flex flex-col gap-2">
                  <Label htmlFor={inputId} className="font-mono text-xs text-muted-foreground">
                    {"${{ "}{name}{" }}"}
                  </Label>
                  <InputGroup>
                    <InputGroupInput
                      id={inputId}
                      placeholder={reusing ? "已保存" : "替换值"}
                      disabled={isSubmitting || reusing}
                      value={reusing ? "" : values[name] ?? ""}
                      onChange={(event) => handleValueChange(name, event.target.value)}
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
                            handleValueChange(name, "")
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

export { VariableSubstitutionDialog }
