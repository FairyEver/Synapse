import { useEffect, useMemo, useState } from "react"
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
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { getCategoryDefinitions } from "@/lib/content-categories"
import { ContentAppearanceFields } from "@/modules/content/components/content-appearance-fields"
import type { CreatePromptPayload, PromptCreateFieldErrors } from "@/modules/prompts/types"
import {
  createEmptyPromptPayload,
  normalizeCreatePromptPayload,
  validateCreatePromptPayload,
} from "@/modules/prompts/utils"

type PromptCreateDialogProps = {
  initialValue?: CreatePromptPayload | null
  mode?: "create" | "edit"
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreatePromptPayload) => Promise<void> | void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
}

function isDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object') return false
  if (a === null || b === null) return false

  const aObj = a as Record<string, unknown>
  const bObj = b as Record<string, unknown>
  const aKeys = Object.keys(aObj)
  const bKeys = Object.keys(bObj)

  if (aKeys.length !== bKeys.length) return false

  for (const key of aKeys) {
    if (!bKeys.includes(key)) return false
    if (!isDeepEqual(aObj[key], bObj[key])) return false
  }

  return true
}

function PromptCreateDialog({
  initialValue = null,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
}: PromptCreateDialogProps) {
  const categoryOptions = useMemo(() => getCategoryDefinitions("prompt"), [])
  const baseline = useMemo(
    () => normalizeCreatePromptPayload(initialValue ?? createEmptyPromptPayload()),
    [initialValue],
  )
  const [form, setForm] = useState<CreatePromptPayload>(() => baseline)
  const [errors, setErrors] = useState<PromptCreateFieldErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    setForm(baseline)
    setErrors({})
    setIsSubmitting(false)
    setIsDiscardConfirmOpen(false)
    setSubmitError(null)
  }, [baseline, open])

  const updateField = <K extends keyof CreatePromptPayload>(field: K, value: CreatePromptPayload[K]) => {
    const nextForm = {
      ...form,
      [field]: value,
    }

    setForm(nextForm)
    setSubmitError(null)

    if (Object.keys(errors).length > 0) {
      setErrors(validateCreatePromptPayload(nextForm))
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

    if (!isDeepEqual(normalizeCreatePromptPayload(form), baseline)) {
      setIsDiscardConfirmOpen(true)
      return
    }

    onOpenChange(false)
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateCreatePromptPayload(form)

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await onSubmit(normalizeCreatePromptPayload(form))
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "保存提示词失败。")
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
              当前还没有提交，关闭后已填写的提示词内容会被清空。
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
          title={mode === "create" ? "新建提示词" : "编辑提示词"}
          contentClassName="sm:max-w-[520px]"
          footer={(
            <>
              <FieldError className="sm:mr-auto">{submitError}</FieldError>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  onClick={() => handleDialogOpenChange(false)}
                >
                  取消
                </Button>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button type="submit" disabled={isSubmitting || submitDisabled}>
                          {isSubmitting ? "正在保存..." : mode === "create" ? "保存" : "保存修改"}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    {submitDisabled && submitDisabledReason ? (
                      <TooltipContent>{submitDisabledReason}</TooltipContent>
                    ) : null}
                  </Tooltip>
                </TooltipProvider>
              </div>
            </>
          )}
          onSubmit={handleSubmit}
        >
          <FieldGroup className="gap-5">
            <Field data-invalid={errors.title ? true : undefined}>
              <FieldLabel htmlFor="prompt-create-title">标题</FieldLabel>
              <FieldContent>
                <Input
                  id="prompt-create-title"
                  value={form.title}
                  aria-invalid={errors.title ? "true" : undefined}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder="代码审查助手"
                />
                <FieldError>{errors.title}</FieldError>
              </FieldContent>
            </Field>

            <Field data-invalid={errors.description ? true : undefined}>
              <FieldLabel htmlFor="prompt-create-description">简介</FieldLabel>
              <FieldContent>
                <Textarea
                  id="prompt-create-description"
                  value={form.description}
                  aria-invalid={errors.description ? "true" : undefined}
                  className="min-h-24"
                  onChange={(event) => updateField("description", event.target.value)}
                  placeholder="帮助审查代码质量和规范"
                />
                <FieldError>{errors.description}</FieldError>
              </FieldContent>
            </Field>

            <Field data-invalid={errors.category ? true : undefined}>
              <FieldLabel htmlFor="prompt-create-category">分类</FieldLabel>
              <FieldContent>
                <Select
                  value={form.category || undefined}
                  onValueChange={(value) => updateField("category", value)}
                >
                  <SelectTrigger
                    id="prompt-create-category"
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
                <FieldError>{errors.category}</FieldError>
              </FieldContent>
            </Field>
            <Field data-invalid={errors.content ? true : undefined}>
              <FieldLabel htmlFor="prompt-create-content">正文</FieldLabel>
              <FieldContent>
                <Textarea
                  id="prompt-create-content"
                  value={form.content}
                  aria-invalid={errors.content ? "true" : undefined}
                  className="min-h-56"
                  onChange={(event) => updateField("content", event.target.value)}
                  placeholder="输入或粘贴提示词正文。"
                />
                <FieldError>{errors.content}</FieldError>
              </FieldContent>
            </Field>

            <ContentAppearanceFields
              backgroundValue={form.iconBg}
              backgroundError={errors.iconBg}
              iconValue={form.icon}
              iconError={errors.icon}
              onBackgroundValueChange={(value) => updateField("iconBg", value)}
              onIconValueChange={(value) => updateField("icon", value)}
            />
          </FieldGroup>
        </FormDialog>
      </Dialog>
    </>
  )
}

export { PromptCreateDialog }
