import { useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Trash2,
  Upload,
  X,
} from "lucide-react"
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
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"
import { ContentAppearanceFields } from "@/modules/content/components/content-appearance-fields"
import type {
  CreateSkillPayload,
  SkillCreateFilePayloadDraft,
  SkillCreateFieldErrors,
} from "@/modules/skills/types"
import {
  createEmptySkillPayload,
  formatSkillAttachmentSize,
  isCreateSkillPayloadDirty,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentName,
  validateCreateSkillPayload,
} from "@/modules/skills/utils"

type SkillCreateDialogProps = {
  initialValue?: CreateSkillPayload | null
  mode?: "create" | "edit"
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreateSkillPayload) => Promise<void> | void
  open: boolean
  submitDisabled?: boolean
  submitDisabledReason?: string | null
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
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

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="text-sm text-destructive">{message}</p>
}

function isFileSystemFileEntry(entry: FileSystemEntry): entry is FileSystemFileEntry {
  return entry.isFile
}

function isFileSystemDirectoryEntry(
  entry: FileSystemEntry,
): entry is FileSystemDirectoryEntry {
  return entry.isDirectory
}

function toCreateSkillFiles(files: Iterable<File>): SkillCreateFilePayloadDraft[] {
  return Array.from(files, (file) => ({
    originalName: normalizeSkillAttachmentName(file.webkitRelativePath || file.name),
    size: file.size,
    file,
  }))
}

function readFileEntry(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => {
    entry.file(resolve, reject)
  })
}

function readAllDirectoryEntries(
  directoryEntry: FileSystemDirectoryEntry,
): Promise<FileSystemEntry[]> {
  const reader = directoryEntry.createReader()

  return new Promise((resolve, reject) => {
    const entries: FileSystemEntry[] = []

    const readNextBatch = () => {
      reader.readEntries(
        (nextEntries) => {
          if (nextEntries.length === 0) {
            resolve(entries)
            return
          }

          entries.push(...nextEntries)
          readNextBatch()
        },
        (error) => reject(error),
      )
    }

    readNextBatch()
  })
}

async function collectCreateSkillFilesFromEntry(
  entry: FileSystemEntry,
): Promise<SkillCreateFilePayloadDraft[]> {
  if (isFileSystemFileEntry(entry)) {
    const file = await readFileEntry(entry)

    return [
      {
        originalName: normalizeSkillAttachmentName(entry.fullPath || file.name),
        size: file.size,
        file,
      },
    ]
  }

  if (!isFileSystemDirectoryEntry(entry)) {
    return []
  }

  const childEntries = await readAllDirectoryEntries(entry)
  const nestedFiles = await Promise.all(
    childEntries.map((childEntry) => collectCreateSkillFilesFromEntry(childEntry)),
  )

  return nestedFiles.flat()
}

async function collectCreateSkillFilesFromDataTransfer(
  dataTransfer: DataTransfer,
): Promise<SkillCreateFilePayloadDraft[]> {
  const transferableItems = Array.from(dataTransfer.items).filter((item) => item.kind === "file")
  const transferableEntries = transferableItems
    .map((item) => (item as DataTransferItemWithEntry).webkitGetAsEntry?.() ?? null)
    .filter((entry): entry is FileSystemEntry => entry !== null)

  if (transferableEntries.length === 0) {
    return toCreateSkillFiles(dataTransfer.files)
  }

  const nestedFiles = await Promise.all(
    transferableEntries.map((entry) => collectCreateSkillFilesFromEntry(entry)),
  )

  return nestedFiles.flat()
}

function SkillCreateDialog({
  initialValue = null,
  mode = "create",
  onOpenChange,
  onSubmit,
  open,
  submitDisabled = false,
  submitDisabledReason = null,
}: SkillCreateDialogProps) {
  const logger = useMemo(() => createRendererLogger("skills.create"), [])
  const categoryOptions = useMemo(() => getCategoryDefinitions("skill"), [])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const baseline = useMemo(
    () => normalizeCreateSkillPayload(initialValue ?? createEmptySkillPayload()),
    [initialValue],
  )
  const [form, setForm] = useState<CreateSkillPayload>(() => baseline)
  const [errors, setErrors] = useState<SkillCreateFieldErrors>({})
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isCollectingFiles, setIsCollectingFiles] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)


  useEffect(() => {
    setForm(baseline)
    setErrors({})
    setAttachmentMessage(null)
    setIsDraggingFiles(false)
    setIsCollectingFiles(false)
    setIsDiscardConfirmOpen(false)
    setIsSubmitting(false)
    setSubmitError(null)
    dragDepthRef.current = 0
  }, [baseline, open])

  const totalAttachmentSize = useMemo(
    () => form.files.reduce((total, file) => total + file.size, 0),
    [form.files],
  )

  const updateField = <K extends Exclude<keyof CreateSkillPayload, "files">>(
    field: K,
    value: CreateSkillPayload[K],
  ) => {
    const nextForm = {
      ...form,
      [field]: value,
    }

    setForm(nextForm)
    setSubmitError(null)

    if (Object.keys(errors).length > 0) {
      setErrors(validateCreateSkillPayload(nextForm))
    }
  }

  const updateFiles = (nextFiles: SkillCreateFilePayloadDraft[]) => {
    const nextForm = {
      ...form,
      files: nextFiles,
    }

    setForm(nextForm)
    setSubmitError(null)

    if (Object.keys(errors).length > 0) {
      setErrors(validateCreateSkillPayload(nextForm))
    }
  }

  const addFiles = (incomingFiles: SkillCreateFilePayloadDraft[]) => {
    if (incomingFiles.length === 0) {
      return
    }

    const { files, rejectedMessages } = mergeCreateSkillFiles(form.files, incomingFiles)

    updateFiles(files)
    setAttachmentMessage(rejectedMessages.length > 0 ? rejectedMessages.join(" ") : null)
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }

    if (isSubmitting) {
      return
    }

    if (!isDeepEqual(normalizeCreateSkillPayload(form), baseline)) {
      setIsDiscardConfirmOpen(true)
      return
    }

    onOpenChange(false)
  }

  const handleHiddenInputFiles = (files: FileList | null) => {
    if (!files || files.length === 0) {
      return
    }

    addFiles(toCreateSkillFiles(files))
  }

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setIsDraggingFiles(false)
    setAttachmentMessage(null)
    setIsCollectingFiles(true)

    try {
      const droppedFiles = await collectCreateSkillFilesFromDataTransfer(event.dataTransfer)

      if (droppedFiles.length === 0) {
        setAttachmentMessage("没有检测到可用附件，请改用选择文件或文件夹。")
        return
      }

      addFiles(droppedFiles)
    } catch (error) {
      logger.error("Failed to collect dropped skill attachments.", error)
      setAttachmentMessage("整理附件失败，请改用选择文件或文件夹。")
    } finally {
      setIsCollectingFiles(false)
    }
  }

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const nextErrors = validateCreateSkillPayload(form)

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      return
    }

    setIsSubmitting(true)
    setSubmitError(null)

    try {
      await onSubmit(normalizeCreateSkillPayload(form))
      onOpenChange(false)
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "保存 Skill 失败。")
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
              当前还没有保存，关闭后已填写的 Skill 内容和附件会被清空。
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
          title={mode === "create" ? "新建 Skill" : "编辑 Skill"}
          
          contentClassName="sm:max-w-[520px]"
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
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span>
                        <Button type="submit" disabled={isSubmitting || isCollectingFiles || submitDisabled}>
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
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-create-title">中文名称</Label>
              <Input
                id="skill-create-title"
                value={form.title}
                aria-invalid={errors.title ? "true" : undefined}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="API 文档生成助手"
              />
              <FieldError message={errors.title} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-create-name">名称</Label>
              <Input
                id="skill-create-name"
                value={form.name}
                aria-invalid={errors.name ? "true" : undefined}
                className="font-mono"
                onChange={(event) => updateField("name", event.target.value)}
                placeholder="my-skill-name"
              />
              <p className="text-xs text-muted-foreground">小写字母、数字、连字符，3-50 字符。</p>
              <FieldError message={errors.name} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-create-description">简介</Label>
              <Textarea
                id="skill-create-description"
                value={form.description}
                aria-invalid={errors.description ? "true" : undefined}
                className="min-h-24"
                onChange={(event) => updateField("description", event.target.value)}
                placeholder="自动整理 API 文档"
              />
              <FieldError message={errors.description} />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-create-category">分类</Label>
              <Select
                value={form.category || undefined}
                onValueChange={(value) => updateField("category", value)}
              >
                <SelectTrigger
                  id="skill-create-category"
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

            <div className="flex flex-col gap-2">
              <Label htmlFor="skill-create-content">主说明</Label>
              <Textarea
                id="skill-create-content"
                value={form.content}
                aria-invalid={errors.content ? "true" : undefined}
                className="min-h-56"
                onChange={(event) => updateField("content", event.target.value)}
                placeholder="输入 Skill 的主说明。"
              />
              <FieldError message={errors.content} />
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Label>附件</Label>
                  <p className="mt-1 text-sm text-muted-foreground">
                    拖入文件或文件夹，目录结构会一起保留。
                  </p>
                </div>
                {form.files.length > 0 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      updateFiles([])
                      setAttachmentMessage(null)
                    }}
                  >
                    <Trash2 />
                    清空全部
                  </Button>
                ) : null}
              </div>

              <div
                className={cn(
                  "rounded-lg border border-dashed border-border bg-muted p-5 transition-colors",
                  isDraggingFiles && "border-primary",
                )}
                onDragEnter={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  dragDepthRef.current += 1
                  setIsDraggingFiles(true)
                }}
                onDragLeave={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)

                  if (dragDepthRef.current === 0) {
                    setIsDraggingFiles(false)
                  }
                }}
                onDragOver={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  event.dataTransfer.dropEffect = "copy"
                }}
                onDrop={handleDrop}
              >
                <div className="flex flex-col items-center gap-3 text-center">
                  <div className="flex size-10 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
                    {isCollectingFiles ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <Upload />
                    )}
                  </div>
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      {isCollectingFiles ? "正在整理附件..." : "拖入文件或文件夹"}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      单个附件最大 {formatSkillAttachmentSize(MAX_SKILL_ATTACHMENT_SIZE)}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center">
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-r-none border-r-0"
                      disabled={isCollectingFiles || isSubmitting}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Paperclip />
                      选择文件
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-l-none"
                      disabled={isCollectingFiles || isSubmitting}
                      onClick={() => folderInputRef.current?.click()}
                    >
                      <FolderOpen />
                      选择文件夹
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
                  handleHiddenInputFiles(event.target.files)
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
                  handleHiddenInputFiles(event.target.files)
                  event.currentTarget.value = ""
                }}
              />

              {attachmentMessage ? (
                <p className="text-sm text-destructive">{attachmentMessage}</p>
              ) : null}
              <FieldError message={errors.files} />

              {form.files.length > 0 ? (
                <div className="overflow-hidden rounded-lg border">
                  <div className="flex items-center justify-between border-b bg-muted px-3 py-2 text-sm">
                    <span className="font-medium text-foreground">
                      已选 {form.files.length} 个附件
                    </span>
                    <span className="text-muted-foreground">
                      共 {formatSkillAttachmentSize(totalAttachmentSize)}
                    </span>
                  </div>
                  <div className="max-h-56 overflow-y-auto">
                    {form.files.map((file) => (
                      <div
                        key={file.originalName}
                        className="flex items-start justify-between gap-3 border-b px-3 py-3 last:border-b-0"
                      >
                        <div className="min-w-0">
                          <p className="break-all text-sm font-medium text-foreground">
                            {file.originalName}
                          </p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {formatSkillAttachmentSize(file.size)}
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            updateFiles(
                              form.files.filter((item) => item.originalName !== file.originalName),
                            )
                          }}
                          title="移除附件"
                        >
                          <X />
                          <span className="sr-only">移除附件</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  还没有附件。
                </p>
              )}
            </div>

            <ContentAppearanceFields
              backgroundValue={form.iconBg}
              backgroundError={errors.iconBg}
              iconValue={form.icon}
              iconError={errors.icon}
              onBackgroundValueChange={(value) => updateField("iconBg", value)}
              onIconValueChange={(value) => updateField("icon", value)}
            />
          </div>
        </FormDialog>
      </Dialog>
    </>
  )
}

export { SkillCreateDialog }
