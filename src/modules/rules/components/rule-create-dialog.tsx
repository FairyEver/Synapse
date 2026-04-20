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
import type { SynapseContentIconType, SynapseCreateRulePayload } from "@/types/content"

type RuleCreateDialogProps = {
  initialValue?: SynapseCreateRulePayload | null
  mode?: "create" | "edit"
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: SynapseCreateRulePayload) => Promise<void> | void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
  editingId?: string | null
}

const RULE_LABELS = {
  title: "请输入标题。",
  description: "请输入简介。",
  content: "请输入正文。",
}

const RULE_FORM_CONFIG = {
  createEmpty: () => createEmptyContentPayload<SynapseCreateRulePayload>(),
  normalize: (p: SynapseCreateRulePayload) => normalizeContentPayload(p),
  validate: (p: SynapseCreateRulePayload) => validateContentPayload(p, { labels: RULE_LABELS }),
  errorFallbackMessage: "保存 Rule 失败。",
}

function RuleCreateDialog({
  initialValue = null,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
  editingId = null,
}: RuleCreateDialogProps) {
  const categoryOptions = useMemo(() => getCategoryDefinitions("rule"), [])
  const {
    errors,
    form,
    handleDialogOpenChange,
    handleSubmit,
    isDiscardConfirmOpen,
    isSubmitting,
    setErrors,
    setIsDiscardConfirmOpen,
    submitError,
    updateField,
  } = useContentCreateForm(RULE_FORM_CONFIG, { initialValue, onOpenChange, onSubmit, open })

  const {
    iconImagePreview,
    handleIconImageChange,
    handleIconImageRemove,
    prepareFormForSubmit,
  } = useContentIconImage({
    contentType: "rule",
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
        title: { create: "新建 Rule", edit: "编辑 Rule" },
        discardDescription: "当前还没有提交，关闭后已填写的 Rule 内容会被清空。",
      }}
      mode={mode}
      onDiscardConfirmOpenChange={setIsDiscardConfirmOpen}
      onDialogOpenChange={handleDialogOpenChange}
      onSubmit={handleFormSubmit}
      open={open}
      submitDisabled={submitDisabled}
      submitDisabledReason={submitDisabledReason}
      submitError={submitError}
    >
      <FieldGroup className="gap-5">
        <Field data-invalid={errors.title ? true : undefined}>
          <FieldLabel htmlFor="rule-create-title">标题</FieldLabel>
          <FieldContent>
            <Input
              id="rule-create-title"
              value={form.title}
              aria-invalid={errors.title ? "true" : undefined}
              onChange={(event) => updateField("title", event.target.value)}
              placeholder="PR 评审规范"
            />
            <FieldError>{errors.title}</FieldError>
          </FieldContent>
        </Field>

        <Field data-invalid={errors.description ? true : undefined}>
          <FieldLabel htmlFor="rule-create-description">简介</FieldLabel>
          <FieldContent>
            <Input
              id="rule-create-description"
              value={form.description}
              aria-invalid={errors.description ? "true" : undefined}
              onChange={(event) => updateField("description", event.target.value)}
              placeholder="PR 评审的提交要求"
            />
            <FieldError>{errors.description}</FieldError>
          </FieldContent>
        </Field>

        <Field data-invalid={errors.category ? true : undefined}>
          <FieldLabel htmlFor="rule-create-category">分类</FieldLabel>
          <FieldContent>
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
            <FieldError>{errors.category}</FieldError>
          </FieldContent>
        </Field>

        <Field data-invalid={errors.content ? true : undefined}>
          <FieldLabel htmlFor="rule-create-content">正文</FieldLabel>
          <FieldContent>
            <Textarea
              id="rule-create-content"
              value={form.content}
              aria-invalid={errors.content ? "true" : undefined}
              className="min-h-56"
              onChange={(event) => updateField("content", event.target.value)}
              placeholder="输入或粘贴 Rule 正文。"
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

export { RuleCreateDialog }
