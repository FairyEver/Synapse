import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react"
import { Pencil, Pin, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
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
import { Spinner } from "../../../src/components/ui/spinner"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
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
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<QuickInputFormState>(emptyFormState)

  const quickInputBridge = useMemo(() => requireBridgeDomain("quickInput"), [])

  const reload = useCallback(async () => {
    try {
      setItems(await quickInputBridge.list())
    } catch (error) {
      logger.error("Failed to load quick input items.", error)
      toast.error("加载失败")
    } finally {
      setLoading(false)
    }
  }, [quickInputBridge])

  useEffect(() => {
    void reload()
    return quickInputBridge.onChanged((event) => {
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
        ? await quickInputBridge.update({ id: form.item.id, content })
        : await quickInputBridge.create({ content })

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

  const pinToTop = async (item: SynapseQuickInputItem) => {
    try {
      setItems(await quickInputBridge.pinToTop({ id: item.id }))
    } catch (error) {
      logger.error("Failed to pin quick input item.", error)
      toast.error("置顶失败")
    }
  }

  const deleteItem = async (item: SynapseQuickInputItem) => {
    try {
      await quickInputBridge.delete({ id: item.id })
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (error) {
      logger.error("Failed to delete quick input item.", error)
      toast.error("删除失败")
    }
  }

  return (
    <SystemAppWindowShell
      actions={(
        <Button type="button" onClick={openCreateForm}>
          <Plus data-icon="inline-start" />
          新增
        </Button>
      )}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-3 p-3 sm:p-5">
          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-muted-foreground">
              <Spinner />
            </div>
          ) : items.length === 0 ? (
            <Empty className="min-h-48">
              <EmptyHeader>
                <EmptyTitle>暂无快捷输入</EmptyTitle>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" variant="outline" onClick={openCreateForm}>新增</Button>
              </EmptyContent>
            </Empty>
          ) : (
            <div className="grid gap-2">
              {items.map((item) => (
                <QuickInputRow
                  key={item.id}
                  item={item}
                  onDelete={() => void deleteItem(item)}
                  onEdit={() => openEditForm(item)}
                  onPin={() => void pinToTop(item)}
                />
              ))}
            </div>
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
    </SystemAppWindowShell>
  )
}

function QuickInputRow({
  item,
  onDelete,
  onEdit,
  onPin,
}: {
  readonly item: SynapseQuickInputItem
  readonly onDelete: () => void
  readonly onEdit: () => void
  readonly onPin: () => void
}) {
  return (
    <div className="grid gap-3 rounded-lg border bg-background p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
      <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6">{item.content}</p>
      <div className="flex shrink-0 items-center gap-1 sm:justify-end">
        <Button type="button" variant="ghost" size="icon" aria-label="编辑" onClick={onEdit}>
          <Pencil />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="置顶" onClick={onPin}>
          <Pin />
        </Button>
        <Button type="button" variant="ghost" size="icon" aria-label="删除" onClick={onDelete}>
          <Trash2 />
        </Button>
      </div>
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
              保存
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
