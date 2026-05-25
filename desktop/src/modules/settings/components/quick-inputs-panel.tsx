import { useCallback, useState } from "react"
import { ArrowUpToLine, Pencil, Plus, Trash2 } from "lucide-react"

import { FormDialog } from "@/components/form-dialog"
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
import {
  Field,
  FieldLabel,
} from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseQuickInput } from "@/types/config"
import {
  createQuickInput,
  deleteQuickInput,
  pinQuickInputToTop,
  quickInputPreview,
  updateQuickInput,
  updateQuickInputDirectSend,
} from "../quick-inputs"

type QuickInputsPanelProps = {
  readonly quickInputs: readonly SynapseQuickInput[]
  readonly onSave: (quickInputs: SynapseQuickInput[]) => Promise<boolean>
}

type DialogMode =
  | { type: "add" }
  | { type: "edit"; item: SynapseQuickInput }
  | null

function QuickInputsPanel({ quickInputs, onSave }: QuickInputsPanelProps) {
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [content, setContent] = useState("")
  const [directSend, setDirectSend] = useState(true)
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingItem, setDeletingItem] = useState<SynapseQuickInput | null>(null)
  const [saving, setSaving] = useState(false)

  const openAddDialog = useCallback(() => {
    setDialogMode({ type: "add" })
    setContent("")
    setDirectSend(true)
    setFormError(null)
  }, [])

  const openEditDialog = useCallback((item: SynapseQuickInput) => {
    setDialogMode({ type: "edit", item })
    setContent(item.content)
    setDirectSend(item.directSend)
    setFormError(null)
  }, [])

  const closeDialog = useCallback(() => {
    if (saving) {
      return
    }
    setDialogMode(null)
    setContent("")
    setDirectSend(true)
    setFormError(null)
  }, [saving])

  const saveDialog = useCallback(async () => {
    if (!dialogMode || saving) {
      return
    }

    if (content.trim().length === 0) {
      setFormError("内容不能为空。")
      return
    }

    const nextItems = dialogMode.type === "add"
      ? [...quickInputs, createQuickInput(content, directSend)]
      : updateQuickInput(quickInputs, dialogMode.item.id, content, directSend)

    setSaving(true)
    try {
      const saved = await onSave(nextItems)
      if (saved) {
        setDialogMode(null)
        setContent("")
        setDirectSend(true)
        setFormError(null)
      }
    } finally {
      setSaving(false)
    }
  }, [content, dialogMode, directSend, onSave, quickInputs, saving])

  const pinItem = useCallback(async (item: SynapseQuickInput) => {
    if (saving) {
      return
    }

    setSaving(true)
    try {
      await onSave(pinQuickInputToTop(quickInputs, item.id))
    } finally {
      setSaving(false)
    }
  }, [onSave, quickInputs, saving])

  const toggleDirectSend = useCallback(async (item: SynapseQuickInput, nextValue: boolean) => {
    if (saving) {
      return
    }

    setSaving(true)
    try {
      await onSave(updateQuickInputDirectSend(quickInputs, item.id, nextValue))
    } finally {
      setSaving(false)
    }
  }, [onSave, quickInputs, saving])

  const deleteItem = useCallback(async () => {
    if (!deletingItem || saving) {
      return
    }

    setSaving(true)
    try {
      const saved = await onSave(deleteQuickInput(quickInputs, deletingItem.id))
      if (saved) {
        setDeletingItem(null)
      }
    } finally {
      setSaving(false)
    }
  }, [deletingItem, onSave, quickInputs, saving])

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium">片段</h2>
        <Button type="button" variant="outline" size="sm" onClick={openAddDialog}>
          <Plus />
          新增
        </Button>
      </div>

      {quickInputs.length > 0 ? (
        <div className="flex flex-col gap-2">
          {quickInputs.map((item, index) => (
            <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg bg-background px-3 py-2">
              <p className="min-w-0 flex-1 truncate text-sm">{quickInputPreview(item.content)}</p>
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">直接发送</span>
                  <Switch
                    size="sm"
                    aria-label={`直接发送：${quickInputPreview(item.content)}`}
                    checked={item.directSend}
                    disabled={saving}
                    onCheckedChange={(checked) => void toggleDirectSend(item, checked)}
                  />
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="编辑片段"
                    onClick={() => openEditDialog(item)}
                  >
                    <Pencil />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="置顶片段"
                    disabled={index === 0 || saving}
                    onClick={() => void pinItem(item)}
                  >
                    <ArrowUpToLine />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="删除片段"
                    onClick={() => setDeletingItem(item)}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有片段</p>
      )}

      <Dialog
        open={dialogMode !== null}
        onOpenChange={(open) => {
          if (!open) {
            closeDialog()
          }
        }}
      >
        <FormDialog
          title={dialogMode?.type === "edit" ? "编辑片段" : "新增片段"}
          footer={(
            <Button type="submit" disabled={saving}>
              {saving ? "保存中..." : dialogMode?.type === "edit" ? "保存" : "添加"}
            </Button>
          )}
          onSubmit={(event) => {
            event.preventDefault()
            void saveDialog()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="quick-input-content">内容</Label>
            <Textarea
              id="quick-input-content"
              value={content}
              aria-invalid={formError ? true : undefined}
              onChange={(event) => {
                setContent(event.target.value)
                setFormError(null)
              }}
            />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
            <Field orientation="horizontal" className="items-center justify-between gap-3">
              <FieldLabel htmlFor="quick-input-direct-send">直接发送</FieldLabel>
              <Switch
                id="quick-input-direct-send"
                aria-label="直接发送"
                checked={directSend}
                onCheckedChange={setDirectSend}
              />
            </Field>
          </div>
        </FormDialog>
      </Dialog>

      <AlertDialog
        open={deletingItem !== null}
        onOpenChange={(open) => {
          if (!open && !saving) {
            setDeletingItem(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除片段</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条片段吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={saving} onClick={() => void deleteItem()}>
              {saving ? "正在删除..." : "删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

export { QuickInputsPanel }
