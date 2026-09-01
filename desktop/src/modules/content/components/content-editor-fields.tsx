import { useMemo, useRef, useState } from "react"
import { FolderOpen, Paperclip, Trash2, X } from "lucide-react"
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
import {
  MAIN_SKILL_FILE_PATH,
  normalizeSkillTreePath,
  SkillFileTree,
} from "@/modules/content/components/skill-file-tree"
import type { CreateSkillPayload, SkillCreateFilePayloadDraft } from "@/modules/skills/types"
import {
  createSkillFileDraftsFromFiles,
  formatSkillAttachmentSize,
  MAX_SKILL_ATTACHMENT_COUNT,
  mergeCreateSkillFiles,
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
          value={value}
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
  const fileSizeByPath = useMemo(
    () => new Map(files.map((file) => [normalizeSkillTreePath(file.originalName), file.size] as const)),
    [files],
  )

  const addFiles = (incomingFiles: SkillCreateFilePayloadDraft[]) => {
    const result = mergeCreateSkillFiles(files, incomingFiles)
    onFilesChange(result.files)
    setMessage(result.rejectedMessages.join(" ") || null)
  }

  const handleFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return
    const remainingSlots = Math.max(0, MAX_SKILL_ATTACHMENT_COUNT - files.length)
    addFiles(createSkillFileDraftsFromFiles(fileList, remainingSlots + 1))
  }

  const handleSelectPath = (path: string) => {
    if (path === MAIN_SKILL_FILE_PATH) {
      onSelectMain()
      return
    }

    onSelectFile(path)
  }

  const onRemovePath = (path: string) => {
    onFilesChange(files.filter((file) => normalizeSkillTreePath(file.originalName) !== path))
  }

  return (
    <div
      data-track="content.attachment.drop"
      data-track-native="true"
      className="flex h-full min-h-0 flex-col"
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
      }}
      onDrop={(event) => {
        event.preventDefault()
        handleFiles(event.dataTransfer.files)
      }}
    >
      <div className="flex items-center gap-2 border-b px-2 py-2">
        <Label className="min-w-0 flex-1">附件</Label>
        <span className="shrink-0 text-xs text-muted-foreground">
          {files.length} · {formatSkillAttachmentSize(totalAttachmentSize)}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="添加文件"
          disabled={isSubmitting}
          onClick={() => fileInputRef.current?.click()}
        >
          <Paperclip />
          <span className="sr-only">添加文件</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          title="添加文件夹"
          disabled={isSubmitting}
          onClick={() => folderInputRef.current?.click()}
        >
          <FolderOpen />
          <span className="sr-only">添加文件夹</span>
        </Button>
        {files.length > 0 ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            title="清空附件"
            onClick={() => {
              onFilesChange([])
              setMessage(null)
            }}
          >
            <Trash2 />
            <span className="sr-only">清空附件</span>
          </Button>
        ) : null}
      </div>
      <input
        data-track="content.files.select"
        data-track-native="true"
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
        data-track="content.folder.select"
        data-track-native="true"
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
      {message || error ? (
        <div className="border-b px-2 py-2">
          {message ? <p className="text-sm text-destructive">{message}</p> : null}
          <FieldError>{error}</FieldError>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">
        <SkillFileTree
          activePath={activePath ?? MAIN_SKILL_FILE_PATH}
          attachments={files}
          getFileMeta={(path) => {
            if (path === MAIN_SKILL_FILE_PATH) return null

            const size = fileSizeByPath.get(path)
            return typeof size === "number" ? formatSkillAttachmentSize(size) : null
          }}
          onSelectPath={handleSelectPath}
          renderFileAction={(path) => path === MAIN_SKILL_FILE_PATH ? null : (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              title="移除附件"
              onClick={() => onRemovePath(path)}
            >
              <X />
              <span className="sr-only">移除附件</span>
            </Button>
          )}
        />
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
