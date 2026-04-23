import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { FormDialog } from "@/components/form-dialog"
import type { SynapseVariable } from "@/types/config"

type VariableSubstitutionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  placeholders: string[]
  repositoryVariables: SynapseVariable[]
  repositoryUuid: string | null
  onConfirm: (substitutions: Record<string, string>, saveToRepo: boolean) => void
}

function matchVariable(
  name: string,
  variables: SynapseVariable[],
): SynapseVariable | undefined {
  const exact = variables.find((v) => v.name === name)
  if (exact) return exact
  return variables.find((v) => v.name.toLowerCase() === name.toLowerCase())
}

function VariableSubstitutionDialog({
  open,
  onOpenChange,
  placeholders,
  repositoryVariables,
  repositoryUuid,
  onConfirm,
}: VariableSubstitutionDialogProps) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [saveToRepo, setSaveToRepo] = useState(false)

  const initialValues = useMemo(() => {
    const result: Record<string, string> = {}
    for (const name of placeholders) {
      const matched = matchVariable(name, repositoryVariables)
      result[name] = matched?.value ?? ""
    }
    return result
  }, [placeholders, repositoryVariables])

  useEffect(() => {
    if (open) {
      setValues(initialValues)
      setSaveToRepo(false)
    }
  }, [open, initialValues])

  const handleValueChange = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }, [])

  const handleSubmit = useCallback(() => {
    onConfirm(values, saveToRepo)
  }, [onConfirm, saveToRepo, values])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialog
        title="变量替换"
        description="以下占位符将在安装时被替换。留空则保留原文。"
        footer={
          <div className="flex w-full items-center justify-between">
            <div className="flex items-center gap-2">
              <Switch
                id="save-to-repo"
                checked={saveToRepo}
                onCheckedChange={setSaveToRepo}
                disabled={!repositoryUuid}
              />
              <Label htmlFor="save-to-repo" className="text-sm font-normal">
                保存新变量到仓库
              </Label>
            </div>
            <Button type="submit">继续安装</Button>
          </div>
        }
        onSubmit={(e) => {
          e.preventDefault()
          handleSubmit()
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
                  placeholder="替换值"
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
