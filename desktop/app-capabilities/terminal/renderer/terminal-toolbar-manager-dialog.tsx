import { useEffect, useState, type FormEvent } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"

import { createRendererLogger } from "../../../src/app-shell/logging"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../src/components/ui/alert-dialog"
import { Button } from "../../../src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from "../../../src/components/ui/empty"
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Spinner } from "../../../src/components/ui/spinner"
import { Switch } from "../../../src/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../src/components/ui/table"
import type {
  SynapseTerminalCreateCustomToolbarActionInput,
  SynapseTerminalCustomToolbarAction,
  SynapseTerminalUpdateCustomToolbarActionInput,
} from "../../../src/types/terminal"
import {
  TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH,
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH,
  TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT,
} from "../shared/schema"

const logger = createRendererLogger("terminal.toolbar-manager")

type ToolbarActionForm = {
  readonly mode: "create" | "edit"
  readonly id: string | null
  readonly label: string
  readonly content: string
  readonly pressEnter: boolean
}

type FormErrors = {
  readonly label?: string
  readonly content?: string
  readonly request?: string
}

const EMPTY_FORM: ToolbarActionForm = {
  mode: "create",
  id: null,
  label: "",
  content: "",
  pressEnter: true,
}

export function TerminalToolbarManagerDialog({
  actions,
  open,
  onCreate,
  onDelete,
  onOpenChange,
  onUpdate,
}: {
  readonly actions: readonly SynapseTerminalCustomToolbarAction[]
  readonly open: boolean
  readonly onCreate: (input: SynapseTerminalCreateCustomToolbarActionInput) => Promise<void>
  readonly onDelete: (id: string) => Promise<void>
  readonly onOpenChange: (open: boolean) => void
  readonly onUpdate: (input: SynapseTerminalUpdateCustomToolbarActionInput) => Promise<void>
}) {
  const [form, setForm] = useState<ToolbarActionForm | null>(null)
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<SynapseTerminalCustomToolbarAction | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!open) {
      setForm(null)
      setErrors({})
      setDeleteTarget(null)
    }
  }, [open])

  const formTitle = form?.mode === "edit" ? "编辑快捷输入" : "新增快捷输入"
  const canCreate = actions.length < TERMINAL_CUSTOM_TOOLBAR_ACTION_LIMIT

  const editAction = (action: SynapseTerminalCustomToolbarAction) => {
    setErrors({})
    setForm({
      mode: "edit",
      id: action.id,
      label: action.label,
      content: action.content,
      pressEnter: action.pressEnter,
    })
  }

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!form || saving) return
    const nextErrors = validateForm(form)
    if (nextErrors.label || nextErrors.content) {
      setErrors(nextErrors)
      return
    }
    const input = {
      label: form.label.trim(),
      content: form.content.trim(),
      pressEnter: form.pressEnter,
    }
    try {
      setSaving(true)
      setErrors({})
      if (form.mode === "edit" && form.id) await onUpdate({ id: form.id, ...input })
      else await onCreate(input)
      toast.success("已保存")
      setForm(null)
    } catch (error) {
      logger.error("Failed to save a custom terminal toolbar action.", error)
      setErrors({ request: "保存失败" })
      toast.error("保存失败")
    } finally {
      setSaving(false)
    }
  }

  const deleteAction = async () => {
    if (!deleteTarget || deleting) return
    try {
      setDeleting(true)
      await onDelete(deleteTarget.id)
      setDeleteTarget(null)
    } catch (error) {
      logger.error("Failed to delete a custom terminal toolbar action.", error)
      toast.error("删除失败")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!saving && !deleting) onOpenChange(nextOpen) }}>
        <DialogContent className="sm:max-w-2xl">
          {form ? (
            <form className="grid gap-4" onSubmit={submit}>
              <DialogHeader>
                <DialogTitle>{formTitle}</DialogTitle>
                <DialogDescription className="sr-only">设置按钮名称、输入内容和回车行为。</DialogDescription>
              </DialogHeader>
              <FieldGroup>
                <Field data-invalid={Boolean(errors.label) || undefined}>
                  <FieldLabel htmlFor="terminal-toolbar-action-label">名称</FieldLabel>
                  <FieldContent>
                    <Input
                      id="terminal-toolbar-action-label"
                      value={form.label}
                      maxLength={TERMINAL_CUSTOM_TOOLBAR_ACTION_LABEL_MAX_LENGTH}
                      aria-invalid={Boolean(errors.label)}
                      disabled={saving}
                      autoFocus
                      onChange={(event) => {
                        setForm((current) => current ? { ...current, label: event.target.value } : current)
                        setErrors((current) => ({ ...current, label: undefined, request: undefined }))
                      }}
                    />
                    {errors.label ? <FieldError>{errors.label}</FieldError> : null}
                  </FieldContent>
                </Field>
                <Field data-invalid={Boolean(errors.content) || undefined}>
                  <FieldLabel htmlFor="terminal-toolbar-action-content">输入内容</FieldLabel>
                  <FieldContent>
                    <Input
                      id="terminal-toolbar-action-content"
                      value={form.content}
                      maxLength={TERMINAL_CUSTOM_TOOLBAR_ACTION_CONTENT_MAX_LENGTH}
                      aria-invalid={Boolean(errors.content)}
                      disabled={saving}
                      onChange={(event) => {
                        setForm((current) => current ? { ...current, content: event.target.value } : current)
                        setErrors((current) => ({ ...current, content: undefined, request: undefined }))
                      }}
                    />
                    {errors.content ? <FieldError>{errors.content}</FieldError> : null}
                  </FieldContent>
                </Field>
                <Field orientation="horizontal" className="items-center justify-between gap-3">
                  <FieldLabel htmlFor="terminal-toolbar-action-enter">输入后按回车</FieldLabel>
                  <Switch
                    id="terminal-toolbar-action-enter"
                    checked={form.pressEnter}
                    disabled={saving}
                    onCheckedChange={(pressEnter) => {
                      setForm((current) => current ? { ...current, pressEnter } : current)
                      setErrors((current) => ({ ...current, request: undefined }))
                    }}
                  />
                </Field>
                {errors.request ? <FieldError>{errors.request}</FieldError> : null}
              </FieldGroup>
              <DialogFooter>
                <Button type="button" variant="outline" disabled={saving} onClick={() => setForm(null)}>
                  取消
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? <Spinner data-icon="inline-start" /> : null}
                  {saving ? "保存中" : "保存"}
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>自定义快捷输入</DialogTitle>
                <DialogDescription className="sr-only">管理终端快捷栏中的自定义按钮。</DialogDescription>
              </DialogHeader>
              {actions.length ? (
                <ScrollArea className="max-h-80 rounded-md border">
                  <Table className="table-fixed">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-36">名称</TableHead>
                        <TableHead>输入内容</TableHead>
                        <TableHead className="w-20">行为</TableHead>
                        <TableHead className="w-20 text-right">操作</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {actions.map((action) => (
                        <TableRow key={action.id}>
                          <TableCell className="truncate font-medium">{action.label}</TableCell>
                          <TableCell className="truncate font-mono text-xs" title={action.content}>{action.content}</TableCell>
                          <TableCell>{action.pressEnter ? "回车" : "仅输入"}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`编辑快捷输入：${action.label}`}
                                onClick={() => editAction(action)}
                              >
                                <Pencil />
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`删除快捷输入：${action.label}`}
                                onClick={() => setDeleteTarget(action)}
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              ) : (
                <Empty className="min-h-40">
                  <EmptyHeader>
                    <EmptyTitle>暂无自定义快捷输入</EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button type="button" variant="outline" onClick={() => setForm(EMPTY_FORM)}>
                      新增快捷输入
                    </Button>
                  </EmptyContent>
                </Empty>
              )}
              {actions.length ? (
                <DialogFooter>
                  <Button type="button" disabled={!canCreate} onClick={() => setForm(EMPTY_FORM)}>
                    <Plus data-icon="inline-start" />
                    新增
                  </Button>
                </DialogFooter>
              ) : null}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => { if (!nextOpen && !deleting) setDeleteTarget(null) }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除快捷输入？</AlertDialogTitle>
            <AlertDialogDescription>删除“{deleteTarget?.label}”后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => { event.preventDefault(); void deleteAction() }}
            >
              删除快捷输入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function validateForm(form: ToolbarActionForm): FormErrors {
  const label = form.label.trim()
  const content = form.content.trim()
  return {
    ...(!label ? { label: "名称不能为空" } : {}),
    ...(!content ? { content: "输入内容不能为空" } : {}),
  }
}
