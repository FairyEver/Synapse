import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { CircleAlert, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
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
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "../../../src/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { SystemAppTopBarActionButton } from "../../../src/modules/apps/components/system-app-top-bar"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseQuickInputItem } from "../../../src/types/quick-input"

const logger = createRendererLogger("quick-input.app")

type QuickInputFormState = {
  readonly mode: "create" | "edit"
  readonly item: SynapseQuickInputItem | null
  readonly content: string
  readonly error: string
}

const emptyFormState: QuickInputFormState = {
  mode: "create",
  item: null,
  content: "",
  error: "",
}

export function QuickInputModule() {
  const [items, setItems] = useState<SynapseQuickInputItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<QuickInputFormState>(emptyFormState)
  const [deleteTarget, setDeleteTarget] = useState<SynapseQuickInputItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  const quickInputBridge = useMemo(() => requireBridgeDomain("quickInput"), [])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      setItems(await quickInputBridge.item.list())
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load quick input items.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [quickInputBridge])

  useEffect(() => {
    void reload()
    return quickInputBridge.item.onChanged((event) => {
      setItems(event.items)
    })
  }, [quickInputBridge, reload])

  const openCreateForm = () => {
    setForm(emptyFormState)
    setFormOpen(true)
  }

  const openEditForm = (item: SynapseQuickInputItem) => {
    setForm({
      mode: "edit",
      item,
      content: item.content,
      error: "",
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setForm(emptyFormState)
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving) return

    const content = form.content
    if (content.trim().length === 0) {
      setForm((current) => ({ ...current, error: "内容不能为空" }))
      return
    }

    try {
      setSaving(true)
      const saved = form.mode === "edit" && form.item
        ? await quickInputBridge.item.update({ id: form.item.id, content })
        : await quickInputBridge.item.create({ content })

      setItems((current) => mergeItem(current, saved))
      toast.success("已保存")
      closeForm()
    } catch (error) {
      const message = errorMessage(error, "保存失败")
      logger.error("Failed to save quick input item.", error)
      setForm((current) => ({ ...current, error: message }))
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget || deleting) return
    try {
      setDeleting(true)
      await quickInputBridge.item.delete({ id: deleteTarget.id })
      setItems((current) => current.filter((entry) => entry.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      logger.error("Failed to delete quick input item.", error)
      toast.error("删除失败")
    } finally {
      setDeleting(false)
    }
  }

  return (
    <SystemAppWindowShell
      actions={(
        <SystemAppTopBarActionButton type="button" onClick={openCreateForm}>
          <Plus data-icon="inline-start" />
          新增
        </SystemAppTopBarActionButton>
      )}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-4xl gap-3 p-3 sm:p-5">
          {loading ? (
            <QuickInputTableSkeleton />
          ) : items.length === 0 && loadError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription className="break-words">{loadError}</AlertDescription>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-2 w-fit"
                onClick={() => void reload()}
              >
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
            </Alert>
          ) : items.length === 0 ? (
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyTitle>暂无快捷输入</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={openCreateForm}>新增快捷输入</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <QuickInputTable
              items={items}
              onDelete={setDeleteTarget}
              onEdit={openEditForm}
            />
          )}
        </div>
      </ScrollArea>
      <QuickInputDialog
        form={form}
        open={formOpen}
        saving={saving}
        onContentChange={(content) => setForm((current) => ({ ...current, content, error: "" }))}
        onOpenChange={(open) => {
          if (open) {
            setFormOpen(true)
          } else {
            closeForm()
          }
        }}
        onSubmit={submitForm}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除快捷输入？</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={(event) => { event.preventDefault(); void deleteItem() }}
            >
              删除快捷输入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function QuickInputTableSkeleton() {
  return (
    <div className="rounded-md border bg-background">
      <div className="grid gap-3 p-3">
        <Skeleton className="h-4 w-20" />
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="grid gap-2 border-t pt-3 sm:grid-cols-[minmax(0,1fr)_4rem] sm:items-center">
            <Skeleton className="h-4 w-full max-w-xl" />
            <div className="flex justify-end gap-1">
              <Skeleton className="size-7" />
              <Skeleton className="size-7" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function QuickInputTable({
  items,
  onDelete,
  onEdit,
}: {
  readonly items: SynapseQuickInputItem[]
  readonly onDelete: (item: SynapseQuickInputItem) => void
  readonly onEdit: (item: SynapseQuickInputItem) => void
}) {
  return (
    <div className="rounded-md border bg-background">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>内容</TableHead>
            <TableHead className="w-24 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => {
            const preview = quickInputPreview(item.content)
            return (
              <TableRow key={item.id}>
                <TableCell className="min-w-0 whitespace-normal align-top">
                  <div className="whitespace-pre-wrap break-words leading-6">{item.content}</div>
                </TableCell>
                <TableCell className="align-top text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`编辑快捷输入：${preview}`}
                      onClick={() => onEdit(item)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`删除快捷输入：${preview}`}
                      onClick={() => onDelete(item)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function QuickInputDialog({
  form,
  open,
  saving,
  onContentChange,
  onOpenChange,
  onSubmit,
}: {
  readonly form: QuickInputFormState
  readonly open: boolean
  readonly saving: boolean
  readonly onContentChange: (content: string) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form className="grid gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{form.mode === "edit" ? "编辑快捷输入" : "新增快捷输入"}</DialogTitle>
            <DialogDescription className="sr-only">编辑 Agent 对话中可直接发送的快捷文本。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(form.error) || undefined}>
              <FieldLabel htmlFor="quick-input-content">内容</FieldLabel>
              <FieldContent>
                <Textarea
                  id="quick-input-content"
                  value={form.content}
                  onChange={(event) => onContentChange(event.target.value)}
                  disabled={saving}
                  className="min-h-36 resize-y"
                  aria-invalid={Boolean(form.error)}
                  autoFocus
                />
                {form.error ? <FieldError>{form.error}</FieldError> : null}
              </FieldContent>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              {saving ? "保存中" : "保存快捷输入"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function mergeItem(items: SynapseQuickInputItem[], item: SynapseQuickInputItem): SynapseQuickInputItem[] {
  const next = items.some((entry) => entry.id === item.id)
    ? items.map((entry) => entry.id === item.id ? item : entry)
    : [...items, item]
  return next.sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}

function quickInputPreview(content: string): string {
  const preview = content.replace(/\s+/g, " ").trim()
  return preview.length > 24 ? `${preview.slice(0, 24)}...` : preview
}
