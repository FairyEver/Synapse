import { useMemo, useRef, useState } from "react"
import { FilePlus2, FileText, FolderOpen, Paperclip, Trash2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldContent, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { MarkdownViewer } from "@/components/markdown-viewer"
import { getCategoryDefinitions } from "@/lib/content-categories"
import { ContentAppearanceFields } from "@/modules/content/components/content-appearance-fields"
import type { CreateSkillPayload, SkillCreateFilePayloadDraft } from "@/modules/skills/types"
import {
  formatSkillAttachmentSize,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeSkillAttachmentName,
} from "@/modules/skills/utils"
import type {
  SynapseContentIconType,
  SynapseContentType,
  SynapseCreatePromptPayload,
  SynapseCreateRulePayload,
} from "@/types/content"

type FieldErrors = Partial<Record<string, string>>

type AppearanceFieldProps = {
  errors: FieldErrors
  iconBg: string
  iconImage: string | null
  icon: string
  iconType: SynapseContentIconType
  onIconBgChange: (value: string) => void
  onIconChange: (value: string) => void
  onIconImageChange: (blob: Blob) => void
  onIconImageRemove: () => void
  onIconTypeChange: (value: SynapseContentIconType) => void
}

type SelectCategoryProps = {
  contentType: SynapseContentType
  error?: string
  onChange: (value: string) => void
  value: string
}

type RuleMetaFieldsProps = AppearanceFieldProps & {
  errors: FieldErrors
  form: SynapseCreateRulePayload
  updateField: <K extends keyof SynapseCreateRulePayload>(field: K, value: SynapseCreateRulePayload[K]) => void
}

type PromptMetaFieldsProps = AppearanceFieldProps & {
  errors: FieldErrors
  form: SynapseCreatePromptPayload
  updateField: <K extends keyof SynapseCreatePromptPayload>(field: K, value: SynapseCreatePromptPayload[K]) => void
}

type SkillMetaFieldsProps = AppearanceFieldProps & {
  errors: FieldErrors
  form: CreateSkillPayload
  updateField: <K extends keyof CreateSkillPayload>(field: K, value: CreateSkillPayload[K]) => void
}

type BodyFieldProps = {
  error?: string
  label: string
  onChange: (value: string) => void
  value: string
}

type SkillAttachmentManagerProps = {
  activePath: string | null
  error?: string
  files: SkillCreateFilePayloadDraft[]
  isSubmitting: boolean
  onFilesChange: (files: SkillCreateFilePayloadDraft[]) => void
  onSelectFile: (path: string) => void
  onSelectMain: () => void
}

function toCreateSkillFiles(files: Iterable<File>): SkillCreateFilePayloadDraft[] {
  return Array.from(files, (file) => ({
    originalName: normalizeSkillAttachmentName(file.webkitRelativePath || file.name),
    size: file.size,
    file,
  }))
}

function SelectCategory({
  contentType,
  error,
  onChange,
  value,
}: SelectCategoryProps) {
  const categoryOptions = useMemo(() => getCategoryDefinitions(contentType), [contentType])

  return (
    <Field className="min-w-0" data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={`${contentType}-editor-category`}>分类</FieldLabel>
      <FieldContent>
        <Select
          value={value || undefined}
          onValueChange={onChange}
        >
          <SelectTrigger
            id={`${contentType}-editor-category`}
            aria-invalid={error ? "true" : undefined}
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
        <FieldError>{error}</FieldError>
      </FieldContent>
    </Field>
  )
}

function AppearanceFields({
  errors,
  icon,
  iconBg,
  iconImage,
  iconType,
  onIconBgChange,
  onIconChange,
  onIconImageChange,
  onIconImageRemove,
  onIconTypeChange,
}: AppearanceFieldProps) {
  return (
    <ContentAppearanceFields
      backgroundValue={iconBg}
      backgroundError={errors.iconBg}
      iconValue={icon}
      iconError={errors.icon}
      iconTypeValue={iconType}
      iconImagePreview={iconImage}
      iconImageError={errors.iconImage}
      onBackgroundValueChange={onIconBgChange}
      onIconValueChange={onIconChange}
      onIconTypeChange={(value) => onIconTypeChange(value as SynapseContentIconType)}
      onIconImageChange={onIconImageChange}
      onIconImageRemove={onIconImageRemove}
    />
  )
}

function RuleEditorMetaFields({
  errors,
  form,
  updateField,
  ...appearance
}: RuleMetaFieldsProps) {
  return (
    <FieldGroup className="gap-4">
      <Field className="min-w-0" data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="rule-editor-title">标题</FieldLabel>
        <FieldContent>
          <Input
            id="rule-editor-title"
            value={form.title}
            aria-invalid={errors.title ? "true" : undefined}
            onChange={(event) => updateField("title", event.target.value)}
          />
          <FieldError>{errors.title}</FieldError>
        </FieldContent>
      </Field>
      <Field className="min-w-0" data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="rule-editor-name">名称</FieldLabel>
        <FieldContent>
          <Input
            id="rule-editor-name"
            value={form.name}
            aria-invalid={errors.name ? "true" : undefined}
            className="font-mono"
            onChange={(event) => updateField("name", event.target.value)}
          />
          <FieldError>{errors.name}</FieldError>
        </FieldContent>
      </Field>
      <SelectCategory
        contentType="rule"
        error={errors.category}
        value={form.category}
        onChange={(value) => updateField("category", value)}
      />
      <Field className="min-w-0" data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="rule-editor-description">简介</FieldLabel>
        <FieldContent>
          <Textarea
            id="rule-editor-description"
            value={form.description}
            aria-invalid={errors.description ? "true" : undefined}
            className="min-h-0 resize-none"
            rows={3}
            onChange={(event) => updateField("description", event.target.value)}
          />
          <FieldError>{errors.description}</FieldError>
        </FieldContent>
      </Field>
      <AppearanceFields errors={errors} {...appearance} />
    </FieldGroup>
  )
}

function PromptEditorMetaFields({
  errors,
  form,
  updateField,
  ...appearance
}: PromptMetaFieldsProps) {
  return (
    <FieldGroup className="gap-4">
      <Field className="min-w-0" data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="prompt-editor-title">标题</FieldLabel>
        <FieldContent>
          <Input
            id="prompt-editor-title"
            value={form.title}
            aria-invalid={errors.title ? "true" : undefined}
            onChange={(event) => updateField("title", event.target.value)}
          />
          <FieldError>{errors.title}</FieldError>
        </FieldContent>
      </Field>
      <SelectCategory
        contentType="prompt"
        error={errors.category}
        value={form.category}
        onChange={(value) => updateField("category", value)}
      />
      <Field className="min-w-0" data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="prompt-editor-description">简介</FieldLabel>
        <FieldContent>
          <Textarea
            id="prompt-editor-description"
            value={form.description}
            aria-invalid={errors.description ? "true" : undefined}
            className="min-h-0 resize-none"
            rows={3}
            onChange={(event) => updateField("description", event.target.value)}
          />
          <FieldError>{errors.description}</FieldError>
        </FieldContent>
      </Field>
      <AppearanceFields errors={errors} {...appearance} />
    </FieldGroup>
  )
}

function SkillEditorMetaFields({
  errors,
  form,
  updateField,
  ...appearance
}: SkillMetaFieldsProps) {
  return (
    <FieldGroup className="gap-4">
      <Field className="min-w-0" data-invalid={errors.title ? true : undefined}>
        <FieldLabel htmlFor="skill-editor-title">中文名称</FieldLabel>
        <FieldContent>
          <Input
            id="skill-editor-title"
            value={form.title}
            aria-invalid={errors.title ? "true" : undefined}
            onChange={(event) => updateField("title", event.target.value)}
          />
          <FieldError>{errors.title}</FieldError>
        </FieldContent>
      </Field>
      <Field className="min-w-0" data-invalid={errors.name ? true : undefined}>
        <FieldLabel htmlFor="skill-editor-name">名称</FieldLabel>
        <FieldContent>
          <Input
            id="skill-editor-name"
            value={form.name}
            aria-invalid={errors.name ? "true" : undefined}
            className="font-mono"
            onChange={(event) => updateField("name", event.target.value)}
          />
          <FieldError>{errors.name}</FieldError>
        </FieldContent>
      </Field>
      <SelectCategory
        contentType="skill"
        error={errors.category}
        value={form.category}
        onChange={(value) => updateField("category", value)}
      />
      <Field className="min-w-0">
        <FieldLabel htmlFor="skill-editor-usage">使用说明</FieldLabel>
        <FieldContent>
          <Textarea
            id="skill-editor-usage"
            value={form.usage ?? ""}
            className="min-h-0 resize-none"
            rows={2}
            onChange={(event) => updateField("usage", event.target.value)}
          />
        </FieldContent>
      </Field>
      <Field className="min-w-0" data-invalid={errors.description ? true : undefined}>
        <FieldLabel htmlFor="skill-editor-description">简介</FieldLabel>
        <FieldContent>
          <Textarea
            id="skill-editor-description"
            value={form.description}
            aria-invalid={errors.description ? "true" : undefined}
            className="min-h-0 resize-none"
            rows={3}
            onChange={(event) => updateField("description", event.target.value)}
          />
          <FieldError>{errors.description}</FieldError>
        </FieldContent>
      </Field>
      <AppearanceFields errors={errors} {...appearance} />
    </FieldGroup>
  )
}

function ContentEditorBodyField({
  error,
  label,
  onChange,
  value,
}: BodyFieldProps) {
  return (
    <Field className="flex h-full min-h-0 flex-col" data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor="content-editor-body">{label}</FieldLabel>
      <FieldContent className="min-h-0 flex-1">
        <Textarea
          id="content-editor-body"
          value={value}
          aria-invalid={error ? "true" : undefined}
          className="h-full min-h-0 resize-none font-mono"
          onChange={(event) => onChange(event.target.value)}
        />
        <FieldError>{error}</FieldError>
      </FieldContent>
    </Field>
  )
}

function SkillAttachmentManager({
  activePath,
  error,
  files,
  isSubmitting,
  onFilesChange,
  onSelectFile,
  onSelectMain,
}: SkillAttachmentManagerProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const totalAttachmentSize = useMemo(
    () => files.reduce((total, file) => total + file.size, 0),
    [files],
  )

  const addFiles = (incomingFiles: SkillCreateFilePayloadDraft[]) => {
    const result = mergeCreateSkillFiles(files, incomingFiles)
    onFilesChange(result.files)
    setMessage(result.rejectedMessages.join(" ") || null)
  }

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    addFiles(toCreateSkillFiles(fileList))
  }

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label>附件</Label>
        {files.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              onFilesChange([])
              setMessage(null)
            }}
          >
            <Trash2 />
            清空
          </Button>
        ) : null}
      </div>
      <div
        className="rounded-lg border border-dashed border-border bg-muted p-4"
        onDragOver={(event) => {
          event.preventDefault()
          event.dataTransfer.dropEffect = "copy"
        }}
        onDrop={(event) => {
          event.preventDefault()
          handleFiles(event.dataTransfer.files)
        }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          <FilePlus2 className="size-5 text-muted-foreground" />
          <p className="text-sm font-medium">拖入文件</p>
          <p className="text-xs text-muted-foreground">
            单个附件最大 {formatSkillAttachmentSize(MAX_SKILL_ATTACHMENT_SIZE)}
          </p>
          <div className="flex flex-wrap justify-center">
            <Button
              type="button"
              variant="outline"
              className="rounded-r-none border-r-0"
              disabled={isSubmitting}
              onClick={() => fileInputRef.current?.click()}
            >
              <Paperclip />
              文件
            </Button>
            <Button
              type="button"
              variant="outline"
              className="rounded-l-none"
              disabled={isSubmitting}
              onClick={() => folderInputRef.current?.click()}
            >
              <FolderOpen />
              文件夹
            </Button>
          </div>
        </div>
      </div>
      <input
        ref={fileInputRef}
        className="hidden"
        type="file"
        multiple
        onChange={(event) => {
          handleFiles(event.target.files)
          event.currentTarget.value = ""
        }}
      />
      <input
        ref={folderInputRef}
        className="hidden"
        type="file"
        webkitdirectory=""
        directory=""
        multiple
        onChange={(event) => {
          handleFiles(event.target.files)
          event.currentTarget.value = ""
        }}
      />
      {message ? <p className="text-sm text-destructive">{message}</p> : null}
      <FieldError>{error}</FieldError>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex items-center justify-between border-b bg-muted px-3 py-2 text-sm">
          <span className="font-medium">已选 {files.length} 个附件</span>
          <span className="text-muted-foreground">
            {formatSkillAttachmentSize(totalAttachmentSize)}
          </span>
        </div>
        <ScrollArea className="max-h-[calc(100vh-23rem)]">
          <div className="border-b px-2 py-2">
            <Button
              type="button"
              variant={activePath === null ? "secondary" : "ghost"}
              className="w-full justify-start"
              onClick={onSelectMain}
            >
              <FileText />
              主说明
            </Button>
          </div>
          {files.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">还没有附件。</p>
          ) : files.map((file) => (
            <div
              key={file.originalName}
              className="flex items-start justify-between gap-2 border-b px-3 py-3 last:border-b-0"
            >
              <Button
                type="button"
                variant={activePath === file.originalName ? "secondary" : "ghost"}
                className="h-auto min-w-0 flex-1 justify-start whitespace-normal px-2 py-1.5 text-left"
                onClick={() => onSelectFile(file.originalName)}
              >
                <span className="min-w-0">
                  <span className="block break-all text-sm font-medium">{file.originalName}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {formatSkillAttachmentSize(file.size)}
                  </span>
                </span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                title="移除附件"
                onClick={() => onFilesChange(files.filter((item) => item.originalName !== file.originalName))}
              >
                <X />
                <span className="sr-only">移除附件</span>
              </Button>
            </div>
          ))}
        </ScrollArea>
      </div>
    </div>
  )
}

function ContentPreviewPanel({
  content,
  framed = true,
  title = "预览",
}: {
  content: string
  framed?: boolean
  title?: string
}) {
  const previewClassName = framed ? "min-h-0 flex-1 overflow-hidden rounded-lg border" : "min-h-0 flex-1 overflow-hidden"

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Label>{title}</Label>
      <div className={previewClassName}>
        <ScrollArea className="h-full min-h-0">
          <div className="p-3">
            <MarkdownViewer content={content} mode="rendered" showTabs={false} surface="plain" />
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}

export {
  ContentEditorBodyField,
  ContentPreviewPanel,
  PromptEditorMetaFields,
  RuleEditorMetaFields,
  SkillAttachmentManager,
  SkillEditorMetaFields,
}
