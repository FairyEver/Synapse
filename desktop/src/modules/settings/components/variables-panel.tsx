import { Fragment, useCallback, useMemo, useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { useActiveRepository } from "@/app-shell/use-repository-manager"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { FormDialog } from "@/components/form-dialog"
import type { SynapseConfig, SynapseVariable } from "@/types/config"

const VARIABLE_NAME_REGEX = /^[A-Za-z0-9_]+$/

function createVariablesPatch(
  config: SynapseConfig,
  repositoryUuid: string,
  nextVariables: SynapseVariable[],
) {
  return {
    repositories: config.repositories.map((repo) =>
      repo.uuid === repositoryUuid
        ? { ...repo, variables: nextVariables.length > 0 ? nextVariables : undefined }
        : repo,
    ),
  }
}

type VariableFormState = {
  name: string
  value: string
  description: string
}

function VariablesPanel() {
  const { config, updateConfig } = useAppConfig()
  const activeRepository = useActiveRepository()
  const [isAddOpen, setIsAddOpen] = useState(false)
  const [editingVariable, setEditingVariable] = useState<SynapseVariable | null>(null)
  const [deletingVariable, setDeletingVariable] = useState<SynapseVariable | null>(null)
  const [form, setForm] = useState<VariableFormState>({ name: "", value: "", description: "" })
  const [formError, setFormError] = useState<string | null>(null)

  const variables = useMemo(
    () => activeRepository?.variables ?? [],
    [activeRepository],
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
    if (!activeRepository) return

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

    await updateConfig(
      createVariablesPatch(config, activeRepository.uuid, [...variables, newVariable]),
    )
    setIsAddOpen(false)
  }, [activeRepository, config, form, updateConfig, variables])

  const handleSubmitEdit = useCallback(async () => {
    if (!activeRepository || !editingVariable) return

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

    await updateConfig(
      createVariablesPatch(config, activeRepository.uuid, nextVariables),
    )
    setEditingVariable(null)
  }, [activeRepository, config, editingVariable, form, updateConfig, variables])

  const handleDelete = useCallback(async () => {
    if (!activeRepository || !deletingVariable) return

    const nextVariables = variables.filter((v) => v.name !== deletingVariable.name)

    await updateConfig(
      createVariablesPatch(config, activeRepository.uuid, nextVariables),
    )
    setDeletingVariable(null)
  }, [activeRepository, config, deletingVariable, updateConfig, variables])

  if (!activeRepository) {
    return (
      <p className="text-sm text-muted-foreground">请先选择一个仓库。</p>
    )
  }

  const formFields = (
    <div className="flex flex-col gap-4">
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
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Badge variant="secondary">{activeRepository.name}</Badge>
        <Button variant="outline" size="sm" onClick={handleAdd}>
          <Plus className="size-3.5" />
          添加变量
        </Button>
      </div>

      {variables.length === 0 ? (
        <Card className="bg-background">
          <CardContent className="flex flex-col items-center gap-3 py-8">
            <p className="text-sm text-muted-foreground">
              还没有变量。在内容中使用 <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{"${{ NAME }}"}</code> 占位符，安装时自动替换。
            </p>
            <Button variant="outline" size="sm" onClick={handleAdd}>
              <Plus className="size-3.5" />
              添加变量
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-background">
          <CardContent className="p-0">
            {variables.map((variable, index) => (
              <Fragment key={variable.name}>
                {index > 0 ? <Separator /> : null}
                <div className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-mono text-sm">{variable.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {variable.value || <span className="italic">（空）</span>}
                    </p>
                    {variable.description ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {variable.description}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(variable)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeletingVariable(variable)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </Fragment>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <FormDialog
          title="添加变量"
          footer={
            <Button type="submit">添加</Button>
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
            <Button type="submit">保存</Button>
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
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { VariablesPanel }
