import { useMemo, useState } from "react"
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
import { ContentAppearanceFields } from "@/modules/content/components/content-appearance-fields"
import { ContentCreateDialog } from "@/modules/content/components/content-create-dialog"
import { useContentCreateForm } from "@/modules/content/hooks/use-content-create-form"
import { useContentIconImage } from "@/modules/content/hooks/use-content-icon-image"
import {
  createEmptyRulePayload,
  normalizeCreateRulePayload,
  validateCreateRulePayload,
} from "@/modules/rules/utils"
import type { SynapseContentIconType, SynapseCreateRulePayload } from "@/types/content"

type RuleCreateDialogProps = {
  existingNames?: string[]
  initialValue?: SynapseCreateRulePayload | null
  mode?: "create" | "edit"
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: SynapseCreateRulePayload) => Promise<void> | void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
  editingId?: string | null
}

const RULE_FORM_CONFIG = {
  createEmpty: () => createEmptyRulePayload(),
  normalize: (p: SynapseCreateRulePayload) => normalizeCreateRulePayload(p),
  validate: (p: SynapseCreateRulePayload) => validateCreateRulePayload(p),
  errorFallbackMessage: "保存 Rule 失败。",
}

function RuleCreateDialog({
  existingNames,
  initialValue = null,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
  editingId = null,
}: RuleCreateDialogProps) {
  const isEditMode = mode === "edit"
  const categoryOptions = useMemo(() => getCategoryDefinitions("rule"), [])
  const logContext = {
    category: "rules.create",
    contentId: editingId,
    contentType: "rule",
    mode,
  } as const
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
  } = useContentCreateForm(RULE_FORM_CONFIG, {
    initialValue,
    logContext,
    onOpenChange,
    onSubmit,
    open,
  })

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
    mode,
    setErrors,
    updateField,
  })

  const [isDuplicateWarningOpen, setIsDuplicateWarningOpen] = useState(false)

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    const prepared = prepareFormForSubmit(form)
    const validationErrors = validateCreateRulePayload(prepared)
    if (Object.keys(validationErrors).length > 0) {
      handleSubmit(event, prepared)
      return
    }
    const normalizedName = normalizeCreateRulePayload(prepared).name
    if (existingNames?.includes(normalizedName)) {
      event.preventDefault()
      setIsDuplicateWarningOpen(true)
      return
    }
    handleSubmit(event, prepared)
  }

  const handleDuplicateWarningContinue = () => {
    setIsDuplicateWarningOpen(false)
    const syntheticEvent = { preventDefault: () => {} } as React.FormEvent<HTMLFormElement>
    handleSubmit(syntheticEvent, prepareFormForSubmit(form))
  }

  const titleField = (
    <Field className="min-w-0" data-invalid={errors.title ? true : undefined}>
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
  )

  const nameField = (
    <Field className="min-w-0" data-invalid={errors.name ? true : undefined}>
      <FieldLabel htmlFor="rule-create-name">名称</FieldLabel>
      <FieldContent>
        <Input
          id="rule-create-name"
          value={form.name}
          aria-invalid={errors.name ? "true" : undefined}
          className="font-mono"
          onChange={(event) => updateField("name", event.target.value)}
          placeholder="code-style"
        />
        <p className="text-xs text-muted-foreground">
          小写字母、数字、连字符，3-64 字符。安装到编辑器时用作文件名。
        </p>
        <FieldError>{errors.name}</FieldError>
      </FieldContent>
    </Field>
  )

  const categoryField = (
    <Field className="min-w-0" data-invalid={errors.category ? true : undefined}>
      <FieldLabel htmlFor="rule-create-category">分类</FieldLabel>
      <FieldContent>
        <Select
          data-track="rule-category-select"
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
  )

  const descriptionField = (
    <Field className="min-w-0" data-invalid={errors.description ? true : undefined}>
      <FieldLabel htmlFor="rule-create-description">简介</FieldLabel>
      <FieldContent>
        <Textarea
          id="rule-create-description"
          value={form.description}
          aria-invalid={errors.description ? "true" : undefined}
          onChange={(event) => updateField("description", event.target.value)}
          placeholder="PR 评审的提交要求"
          rows={2}
          className="min-h-0 resize-none"
        />
        <FieldError>{errors.description}</FieldError>
      </FieldContent>
    </Field>
  )

  const contentField = (
    <Field className="min-w-0" data-invalid={errors.content ? true : undefined}>
      <FieldLabel htmlFor="rule-create-content">正文</FieldLabel>
      <FieldContent>
        <Textarea
          id="rule-create-content"
          value={form.content}
          aria-invalid={errors.content ? "true" : undefined}
          className="min-h-0"
          onChange={(event) => updateField("content", event.target.value)}
          placeholder="输入或粘贴 Rule 正文。"
          rows={5}
        />
        <FieldError>{errors.content}</FieldError>
      </FieldContent>
    </Field>
  )

  return (
    <ContentCreateDialog
      isDiscardConfirmOpen={isDiscardConfirmOpen}
      isDuplicateWarningOpen={isDuplicateWarningOpen}
      isSubmitting={isSubmitting}
      labels={{
        title: { create: "新建 Rule", edit: "编辑 Rule" },
        discardDescription: "当前还没有提交，关闭后已填写的 Rule 内容会被清空。",
      }}
      mode={mode}
      onDialogOpenChange={handleDialogOpenChange}
      onDiscard={handleDiscard}
      onDiscardConfirmOpenChange={setIsDiscardConfirmOpen}
      onDuplicateWarningContinue={handleDuplicateWarningContinue}
      onDuplicateWarningOpenChange={setIsDuplicateWarningOpen}
      onSubmit={handleFormSubmit}
      open={open}
      submitDisabled={submitDisabled}
      submitDisabledReason={submitDisabledReason}
      submitError={submitError}
    >
      <FieldGroup className="gap-5">
        {isEditMode ? (
          <div className="grid gap-4 sm:grid-cols-3">
            {titleField}
            {nameField}
            {categoryField}
          </div>
        ) : (
          <>
            {titleField}
            {nameField}
          </>
        )}
        {descriptionField}
        {!isEditMode ? categoryField : null}
        {contentField}

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
