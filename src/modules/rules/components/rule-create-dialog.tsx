import { useEffect, useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
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
import { FormDialog } from "@/components/form-dialog"
import { Button } from "@/components/ui/button"
import { Dialog } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { getContentIconOption } from "@/lib/content-appearance"
import { getCategoryDefinitions } from "@/lib/content-categories"
import { ContentBackgroundPicker } from "@/modules/content/components/content-background-picker"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import { ContentIconPicker } from "@/modules/content/components/content-icon-picker"
import type { CreateRulePayload, RuleCreateFieldErrors } from "@/modules/rules/types"
import {
  createEmptyRulePayload,
  isCreateRulePayloadDirty,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
} from "@/modules/rules/utils"

type RuleCreateDialogProps = {
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreateRulePayload) => Promise<void> | void
  open: boolean
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="text-sm text-destructive">{message}</p>
}

function RuleCreateDialog({ onOpenChange, onSubmit, open }: RuleCreateDialogProps) {
  const categoryOptions = useMemo(() => getCategoryDefinitions("rule"), [])
  const [form, setForm] = useState<CreateRulePayload>(() => createEmptyRulePayload())
  const [errors, setErrors] = useState<RuleCreateFieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setForm(createEmptyRulePayload())
      setErrors({})
      setIsSubmitting(false)
      setIsDiscardConfirmOpen(false)
      setSubmitError(null)
    }
  }, [open])

  const selectedIconOption = form.icon ? getContentIconOption(form.icon) : null
  const previewIconOption = selectedIconOption ?? getContentIconOption("sparkles")

  const updateField = <K extends keyof CreateRulePayload>(field: K, value: CreateRulePayload[K]) => {
    const nextForm = {
      ...form,
      [field]: value,
    }

    setForm(nextForm)
    setSubmitError(null)

    if (Object.keys(errors).length > 0) {
      setErrors(validateCreateRulePayload(nextForm))
    }
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    if (isSubmitting) {
      return
    }

    if (isCreateRulePayloadDirty(form)) {
      setIsDiscardConfirmOpen(true)
      return
    }

    onOpenChange(false)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateCreateRulePayload(form)

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await onSubmit(normalizeCreateRulePayload(form))
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "提交 Rule 失败。")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <AlertDialog open={isDiscardConfirmOpen} onOpenChange={setIsDiscardConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃当前填写内容？</AlertDialogTitle>
            <AlertDialogDescription>
              当前还没有提交，关闭后已填写的 Rule 内容会被清空。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setIsDiscardConfirmOpen(false)
                onOpenChange(false)
              }}
            >
              放弃
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <FormDialog
          title="新建 Rule"
          description="填好内容后提交审核。"
          contentClassName="sm:max-w-4xl"
          footer={(
            <>
              {submitError ? (
                <p className="text-sm text-destructive sm:mr-auto">{submitError}</p>
              ) : null}
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => handleDialogOpenChange(false)}
                >
                  取消
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? "正在提交..." : "提交审核"}
                </Button>
              </div>
            </>
          )}
          onSubmit={handleSubmit}
        >
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-create-title">标题</Label>
                <Input
                  id="rule-create-title"
                  value={form.title}
                  aria-invalid={errors.title ? "true" : undefined}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="例如：PR 评审规范"
                />
                <FieldError message={errors.title} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-create-description">简介</Label>
                <Textarea
                  id="rule-create-description"
                  value={form.description}
                  aria-invalid={errors.description ? "true" : undefined}
                  className="min-h-24"
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="例如：适用于 PR 评审的提交要求。"
                />
                <FieldError message={errors.description} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-create-category">分类</Label>
                <Select
                  value={form.category || undefined}
                  onValueChange={(value) => updateField("category", value)}
                >
                  <SelectTrigger
                    id="rule-create-category"
                    aria-invalid={errors.category ? "true" : undefined}
                    className="w-full"
                  >
                    <SelectValue placeholder="选择分类" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {categoryOptions.map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldError message={errors.category} />
              </div>

              <div className="flex flex-col gap-3">
                <Label>图标</Label>
                <ContentIconPicker
                  value={form.icon}
                  onValueChange={(value) => updateField("icon", value)}
                />
                <FieldError message={errors.icon} />
              </div>

              <div className="flex flex-col gap-3">
                <Label>背景色</Label>
                <ContentBackgroundPicker
                  value={form.iconBg}
                  onValueChange={(value) => updateField("iconBg", value)}
                />
                <FieldError message={errors.iconBg} />
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="rule-create-content">正文</Label>
                <Textarea
                  id="rule-create-content"
                  value={form.content}
                  aria-invalid={errors.content ? "true" : undefined}
                  className="min-h-56"
                  onChange={(event) => updateField("content", event.target.value)}
                  placeholder="输入或粘贴 Rule 正文。"
                />
                <FieldError message={errors.content} />
              </div>
            </div>

            <aside className="rounded-lg border border-border/70 bg-muted/10 p-4">
              <div className="space-y-4">
                <p className="text-sm font-medium text-foreground">预览</p>
                <div className="flex items-center gap-4">
                  <ContentIconBadge size="lg" tone={form.iconBg || null} title={form.title || "Rule 预览"}>
                    {previewIconOption ? (
                      <previewIconOption.icon className="size-6" />
                    ) : (
                      <Sparkles className="size-6" />
                    )}
                  </ContentIconBadge>

                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">
                      {form.title.trim() || "Rule 标题"}
                    </p>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      {form.description.trim() || "简要说明"}
                    </p>
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </FormDialog>
      </Dialog>
    </>
  )
}

export { RuleCreateDialog }
