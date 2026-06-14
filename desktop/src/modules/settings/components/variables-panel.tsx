import { useCallback, useMemo, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FormDialog } from "@/components/form-dialog"
import type { SynapseVariable } from "@/types/config"

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/

type VariableFormState = {
  name: string
  value: string
  description: string
}

function VariableCard({
  variable,
  onEdit,
  onDelete,
}: {
  variable: SynapseVariable
  onEdit: (variable: SynapseVariable) => void
  onDelete: (variable: SynapseVariable) => void
}) {
  return (
    <div className="group rounded-lg bg-background px-3.5 py-3">
      <div className="flex items-center gap-2">
        <span className="truncate font-mono text-sm font-medium">{variable.name}</span>
        <div className="ml-auto flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="编辑变量"
            onClick={() => onEdit(variable)}
          >
            <Pencil className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-6"
            aria-label="删除变量"
            onClick={() => onDelete(variable)}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </div>
      <p className="mt-1 truncate text-xs text-muted-foreground">
        {variable.value ? "********" : <span className="italic">（空值）</span>}
      </p>
      {variable.description ? (
        <p className="mt-0.5 truncate text-xs text-muted-foreground/70">
          {variable.description}
        </p>
      ) : null}
    </div>
  )
}

function VariablesPanel() {
  const { config, updateConfig } = useAppConfig()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<SynapseVariable | null>(null)
  const [deletingVariable, setDeletingVariable] = useState<SynapseVariable | null>(null)
  const [form, setForm] = useState<VariableFormState>({ name: "", value: "", description: "" })
  const [formError, setFormError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const variables = useMemo(
    () => config.global.variables,
    [config.global.variables],
  )

  const handleAdd = useCallback(() => {
    setForm({ name: "", value: "", description: "" })
    setFormError(null)
    setIsAddOpen(true)
  }, [])

  const handleEdit = useCallback((variable: SynapseVariable) => {
    setForm({
      name: variable.name,
      value: variable.value,
      description: variable.description ?? "",
    })
    setFormError(null)
    setEditingVariable(variable)
  }, [])

  const handleSubmitAdd = useCallback(async () => {
    if (isSubmitting) return

    const name = form.name.trim()
    if (!name || !VARIABLE_NAME_REGEX.test(name)) {
      setFormError("变量名只能包含字母、数字和下划线。")
      return
    }

    const exists = variables.some((v) => v.name.toLowerCase() === name.toLowerCase())
    if (exists) {
      setFormError("已存在同名变量。")
      return
    }

    const newVariable: SynapseVariable = {
      name,
      value: form.value,
      ...(form.description.trim() ? { description: form.description.trim() } : undefined),
    }

    setIsSubmitting(true)
    try {
      await updateConfig({
        global: { variables: [...variables, newVariable] },
      })
      setIsAddOpen(false)
    } catch {
      setFormError("保存失败，请重试。")
    } finally {
      setIsSubmitting(false)
    }
  }, [form, updateConfig, variables, isSubmitting])

  const handleSubmitEdit = useCallback(async () => {
    if (!editingVariable || isSubmitting) return

    const name = form.name.trim()
    if (!name || !VARIABLE_NAME_REGEX.test(name)) {
      setFormError("变量名只能包含字母、数字和下划线。")
      return
    }

    const duplicate = variables.some(
      (v) =>
        v.name.toLowerCase() === name.toLowerCase()
        && v.name.toLowerCase() !== editingVariable.name.toLowerCase(),
    )
    if (duplicate) {
      setFormError("已存在同名变量。")
      return
    }

    const updated: SynapseVariable = {
      name,
      value: form.value,
      ...(form.description.trim() ? { description: form.description.trim() } : undefined),
    }

    const nextVariables = variables.map((v) =>
      v.name === editingVariable.name ? updated : v,
    )

    setIsSubmitting(true)
    try {
      await updateConfig({
        global: { variables: nextVariables },
      })
      setEditingVariable(null)
    } catch {
      setFormError("保存失败，请重试。")
    } finally {
      setIsSubmitting(false)
    }
  }, [editingVariable, form, updateConfig, variables, isSubmitting])

  const handleDelete = useCallback(async () => {
    if (!deletingVariable || isSubmitting) return

    const nextVariables = variables.filter((v) => v.name !== deletingVariable.name)
    setDeleting(true)

    try {
      await updateConfig({
        global: { variables: nextVariables },
      })
      setDeletingVariable(null)
    } catch {
      setFormError("删除失败，请重试。")
    } finally {
      setDeleting(false)
    }
  }, [deletingVariable, updateConfig, variables, isSubmitting])

  const formFields = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="variable-name">名称</Label>
        <Input
          id="variable-name"
          className="font-mono"
          placeholder="API_KEY"
          value={form.name}
          onChange={(e) => {
            setForm((prev) => ({ ...prev, name: e.target.value }))
            setFormError(null)
          }}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="variable-value">值</Label>
        <Input
          id="variable-value"
          type="password"
          placeholder="sk-proj-..."
          value={form.value}
          onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
        />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="variable-description">描述</Label>
        <Input
          id="variable-description"
          placeholder="用于访问 OpenAI 服务的密钥"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />
      </div>
      {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
    </div>
  )

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          在内容中使用 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{"${{ NAME }}"}</code> 占位符，安装时自动替换。
        </p>
        <Button variant="outline" size="sm" className="shrink-0" onClick={handleAdd}>
          <Plus className="size-3.5" />
          添加
        </Button>
      </div>

      {variables.length > 0 ? (
        <div className="grid grid-cols-2 gap-2">
          {variables.map((variable) => (
            <VariableCard
              key={variable.name}
              variable={variable}
              onEdit={handleEdit}
              onDelete={(nextVariable) => {
                setFormError(null)
                setDeletingVariable(nextVariable)
              }}
            />
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有变量</p>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <FormDialog
          title="添加变量"
          footer={
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "保存中..." : "添加"}</Button>
          }
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmitAdd()
          }}
        >
          {formFields}
        </FormDialog>
      </Dialog>

      <Dialog
        open={editingVariable !== null}
        onOpenChange={(open) => { if (!open) setEditingVariable(null) }}
      >
        <FormDialog
          title="修改变量"
          footer={
            <Button type="submit" disabled={isSubmitting}>{isSubmitting ? "保存中..." : "保存"}</Button>
          }
          onSubmit={(e) => {
            e.preventDefault()
            void handleSubmitEdit()
          }}
        >
          {formFields}
        </FormDialog>
      </Dialog>

      <AlertDialog
        open={deletingVariable !== null}
        onOpenChange={(open) => { if (!open) setDeletingVariable(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除变量</AlertDialogTitle>
            <AlertDialogDescription>
              确定删除变量 <span className="font-mono">{deletingVariable?.name}</span> 吗？
            </AlertDialogDescription>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={deleting} onClick={() => void handleDelete()}>
              {deleting ? "正在删除..." : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { VariablesPanel }
