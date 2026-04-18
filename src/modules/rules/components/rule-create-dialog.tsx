import { useEffect, useMemo, useState } from "react"
import { Palette, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import {
  getContentIconOption,
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTIONS,
} from "@/lib/content-appearance"
import { getCategoryDefinitions } from "@/lib/content-categories"
import { cn } from "@/lib/utils"
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
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setForm(createEmptyRulePayload())
      setErrors({})
      setIsSubmitting(false)
      setSubmitError(null)
    }
  }, [open])

  const selectedIconOption = form.icon ? getContentIconOption(form.icon) : null
  const previewIconOption = selectedIconOption ?? getContentIconOption("sparkles")
  const previewColor = form.iconBg

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

    if (
      isCreateRulePayloadDirty(form)
      && !window.confirm("放弃当前填写的 Rule 内容？")
    ) {
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
      setSubmitError(error instanceof Error ? error.message : "创建 Rule 失败。")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-4xl">
        <form className="flex max-h-[calc(100vh-2rem)] flex-col" onSubmit={handleSubmit}>
          <DialogHeader className="px-5 pt-5">
            <DialogTitle>新建 Rule</DialogTitle>
            <DialogDescription>
              填好标题、分类和正文后，就可以继续下一步。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
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
                    placeholder="用一句话说明这个 Rule 适合什么场景。"
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
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {SYNAPSE_CONTENT_ICON_OPTIONS.map((option) => {
                      const Icon = option.icon

                      return (
                        <Button
                          key={option.value}
                          type="button"
                          variant={form.icon === option.value ? "secondary" : "outline"}
                          aria-pressed={form.icon === option.value}
                          className="h-auto justify-start px-3 py-3"
                          onClick={() => updateField("icon", option.value)}
                          title={option.label}
                        >
                          <Icon />
                          <span>{option.label}</span>
                        </Button>
                      )
                    })}
                  </div>
                  <FieldError message={errors.icon} />
                </div>

                <div className="flex flex-col gap-3">
                  <Label>背景色</Label>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {SYNAPSE_CONTENT_COLOR_OPTIONS.map((option) => (
                      <Button
                        key={option.value}
                        type="button"
                        variant={form.iconBg === option.value ? "secondary" : "outline"}
                        aria-pressed={form.iconBg === option.value}
                        className="h-auto justify-start px-3 py-3"
                        onClick={() => updateField("iconBg", option.value)}
                        title={option.label}
                      >
                        <span
                          className="size-4 rounded-sm ring-1 ring-black/5"
                          style={{ backgroundColor: option.value }}
                        />
                        <span>{option.label}</span>
                      </Button>
                    ))}
                  </div>
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
                    placeholder="在这里输入 Rule 正文，支持直接粘贴已有文本。"
                  />
                  <FieldError message={errors.content} />
                </div>
              </div>

              <aside className="flex flex-col gap-3">
                <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                  <p className="text-sm font-medium text-foreground">预览</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    图标卡片会显示成这样。
                  </p>

                  <div className="mt-4 rounded-lg border border-border/70 bg-background p-4">
                    <div className="flex items-center gap-4">
                      <div
                        className={cn(
                          "flex size-14 shrink-0 items-center justify-center rounded-lg text-white ring-1 ring-black/5",
                          !previewColor && "bg-muted text-muted-foreground ring-border",
                        )}
                        style={previewColor ? { backgroundColor: previewColor } : undefined}
                      >
                        {previewIconOption ? (
                          <previewIconOption.icon className="size-6" />
                        ) : (
                          <Sparkles className="size-6" />
                        )}
                      </div>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {form.title.trim() || "Rule 标题"}
                        </p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {form.description.trim() || "简介会显示在这里。"}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-border/70 bg-muted/20 p-4">
                  <div className="flex items-start gap-3">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                      <Palette />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">创建说明</p>
                      <p className="text-sm text-muted-foreground">
                        Rule 只能通过输入或粘贴正文创建，不能上传文件。
                      </p>
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          <DialogFooter>
            {submitError ? (
              <p className="mr-auto text-sm text-destructive">{submitError}</p>
            ) : null}
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => handleDialogOpenChange(false)}
            >
              取消
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "正在创建..." : "创建"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { RuleCreateDialog }
