import { useMemo } from "react"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
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
import {
  createEmptyContentPayload,
  normalizeContentPayload,
  validateContentPayload,
} from "@/modules/content/lib/content-payload"
import { ContentAppearanceFields } from "@/modules/content/components/content-appearance-fields"
import { ContentCreateDialog } from "@/modules/content/components/content-create-dialog"
import { useContentCreateForm } from "@/modules/content/hooks/use-content-create-form"
import { useContentIconImage } from "@/modules/content/hooks/use-content-icon-image"
import type { SynapseContentIconType, SynapseCreatePromptPayload } from "@/types/content"

type PromptCreateDialogProps = {
  initialValue?: SynapseCreatePromptPayload | null
  mode?: "create" | "edit"
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: SynapseCreatePromptPayload) => Promise<void> | void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
  editingId?: string | null
}

const PROMPT_LABELS = {
  title: "请输入标题。",
  description: "请输入简介。",
  content: "请输入正文。",
}

const PROMPT_FORM_CONFIG = {
  createEmpty: () => createEmptyContentPayload<SynapseCreatePromptPayload>(),
  normalize: (p: SynapseCreatePromptPayload) => normalizeContentPayload(p),
  validate: (p: SynapseCreatePromptPayload) => validateContentPayload(p, { labels: PROMPT_LABELS }),
  errorFallbackMessage: "保存提示词失败。",
}

function PromptCreateDialog({
  initialValue = null,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
  editingId = null,
}: PromptCreateDialogProps) {
  const categoryOptions = useMemo(() => getCategoryDefinitions("prompt"), [])
  const {
    errors,
    form,
    handleDialogOpenChange,
    handleDiscard,
    handleSubmit,
    isDiscardConfirmOpen,
    isSubmitting,
    setErrors,
    setIsDiscardConfirmOpen,
    submitError,
    updateField,
  } = useContentCreateForm(PROMPT_FORM_CONFIG, { initialValue, onOpenChange, onSubmit, open })

  const {
    iconImagePreview,
    handleIconImageChange,
    handleIconImageRemove,
    prepareFormForSubmit,
  } = useContentIconImage({
    contentType: "prompt",
    contentId: editingId,
    iconType: form.iconType,
    iconImage: form.iconImage,
    setErrors,
    updateField,
  })

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    handleSubmit(event, prepareFormForSubmit(form))
  }

  return (
    <ContentCreateDialog
      isDiscardConfirmOpen={isDiscardConfirmOpen}
      isSubmitting={isSubmitting}
      labels={{
        title: { create: "新建提示词", edit: "编辑提示词" },
        discardDescription: "当前还没有提交，关闭后已填写的提示词内容会被清空。",
      }}
      mode={mode}
      onDialogOpenChange={handleDialogOpenChange}
      onDiscard={handleDiscard}
      onDiscardConfirmOpenChange={setIsDiscardConfirmOpen}
      onSubmit={handleFormSubmit}
      open={open}
      submitDisabled={submitDisabled}
      submitDisabledReason={submitDisabledReason}
      submitError={submitError}
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
            <Input
              id="prompt-create-description"
              value={form.description}
              aria-invalid={errors.description ? "true" : undefined}
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
          iconTypeValue={form.iconType}
          iconImagePreview={iconImagePreview}
          iconImageError={errors.iconImage}
          onBackgroundValueChange={(value) => updateField("iconBg", value)}
          onIconValueChange={(value) => updateField("icon", value)}
          onIconTypeChange={(value) => updateField("iconType", value as SynapseContentIconType)}
          onIconImageChange={handleIconImageChange}
          onIconImageRemove={handleIconImageRemove}
        />
      </FieldGroup>
    </ContentCreateDialog>
  )
}

export { PromptCreateDialog }
