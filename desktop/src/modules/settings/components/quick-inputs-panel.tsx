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
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { SynapseQuickInput } from "@/types/config"
import {
  createQuickInput,
  deleteQuickInput,
  pinQuickInputToTop,
  quickInputPreview,
  updateQuickInput,
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
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingItem, setDeletingItem] = useState<SynapseQuickInput | null>(null)
  const [saving, setSaving] = useState(false)

  const openAddDialog = useCallback(() => {
    setDialogMode({ type: "add" })
    setContent("")
    setFormError(null)
  }, [])

  const openEditDialog = useCallback((item: SynapseQuickInput) => {
    setDialogMode({ type: "edit", item })
    setContent(item.content)
    setFormError(null)
  }, [])

  const closeDialog = useCallback(() => {
    if (saving) {
      return
    }
    setDialogMode(null)
    setContent("")
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
      ? [...quickInputs, createQuickInput(content)]
      : updateQuickInput(quickInputs, dialogMode.item.id, content)

    setSaving(true)
    try {
      const saved = await onSave(nextItems)
      if (saved) {
        setDialogMode(null)
        setContent("")
        setFormError(null)
      }
    } finally {
      setSaving(false)
    }
  }, [content, dialogMode, onSave, quickInputs, saving])

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
        <h2 className="text-sm font-medium">快速输入</h2>
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
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="编辑快速输入"
                  onClick={() => openEditDialog(item)}
                >
                  <Pencil />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="置顶快速输入"
                  disabled={index === 0 || saving}
                  onClick={() => void pinItem(item)}
                >
                  <ArrowUpToLine />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="删除快速输入"
                  onClick={() => setDeletingItem(item)}
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">还没有快速输入</p>
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
          title={dialogMode?.type === "edit" ? "编辑快速输入" : "新增快速输入"}
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
            <AlertDialogTitle>删除快速输入</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条快速输入吗？</AlertDialogDescription>
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
