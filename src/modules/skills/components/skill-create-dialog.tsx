import { useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOpen,
  LoaderCircle,
  Paperclip,
  Sparkles,
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
  SYNAPSE_CONTENT_COLOR_OPTIONS,
  SYNAPSE_CONTENT_ICON_OPTIONS,
  getContentIconOption,
} from "@/lib/content-appearance"
import { getCategoryDefinitions } from "@/lib/content-categories"
import { createRendererLogger } from "@/app-shell/logging"
import { cn } from "@/lib/utils"
import { ContentIconBadge } from "@/modules/content/components/content-icon-badge"
import type {
  CreateSkillFilePayload,
  CreateSkillPayload,
  SkillCreateFieldErrors,
} from "@/modules/skills/types"
import {
  createEmptySkillPayload,
  formatSkillAttachmentSize,
  isCreateSkillPayloadDirty,
  MAX_SKILL_ATTACHMENT_SIZE,
  mergeCreateSkillFiles,
  normalizeCreateSkillPayload,
  normalizeSkillAttachmentPath,
  validateCreateSkillPayload,
} from "@/modules/skills/utils"

type SkillCreateDialogProps = {
  onOpenChange: (open: boolean) => void
  onSubmit: (payload: CreateSkillPayload) => Promise<void> | void
  open: boolean
}

type DataTransferItemWithEntry = DataTransferItem & {
  webkitGetAsEntry?: () => FileSystemEntry | null
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

function toCreateSkillFiles(files: Iterable<File>): CreateSkillFilePayload[] {
  return Array.from(files, (file) => ({
    relativePath: normalizeSkillAttachmentPath(file.webkitRelativePath || file.name),
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
): Promise<CreateSkillFilePayload[]> {
  if (isFileSystemFileEntry(entry)) {
    const file = await readFileEntry(entry)

    return [
      {
        relativePath: normalizeSkillAttachmentPath(entry.fullPath || file.name),
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
): Promise<CreateSkillFilePayload[]> {
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

function SkillCreateDialog({ onOpenChange, onSubmit, open }: SkillCreateDialogProps) {
  const logger = useMemo(() => createRendererLogger("skills.create"), [])
  const categoryOptions = useMemo(() => getCategoryDefinitions("skill"), [])
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const folderInputRef = useRef<HTMLInputElement | null>(null)
  const dragDepthRef = useRef(0)
  const [form, setForm] = useState<CreateSkillPayload>(() => createEmptySkillPayload())
  const [errors, setErrors] = useState<SkillCreateFieldErrors>({})
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null)
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)
  const [isCollectingFiles, setIsCollectingFiles] = useState(false)
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    const folderInput = folderInputRef.current

    if (!folderInput) {
      return
    }

    folderInput.setAttribute("webkitdirectory", "")
    folderInput.setAttribute("directory", "")
  }, [])

  useEffect(() => {
    if (!open) {
      setForm(createEmptySkillPayload())
      setErrors({})
      setAttachmentMessage(null)
      setIsDraggingFiles(false)
      setIsCollectingFiles(false)
      setIsDiscardConfirmOpen(false)
      setIsSubmitting(false)
      setSubmitError(null)
      dragDepthRef.current = 0
    }
  }, [open])

  const selectedIconOption = form.icon ? getContentIconOption(form.icon) : null
  const previewIconOption = selectedIconOption ?? getContentIconOption("sparkles")
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

  const updateFiles = (nextFiles: CreateSkillFilePayload[]) => {
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

  const addFiles = (incomingFiles: CreateSkillFilePayload[]) => {
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

    if (isCreateSkillPayloadDirty(form)) {
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
      setSubmitError(error instanceof Error ? error.message : "提交 Skill 失败。")
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
              当前还没有提交，关闭后已填写的 Skill 内容和附件会被清空。
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
        <DialogContent className="max-h-[calc(100vh-2rem)] overflow-hidden p-0 sm:max-w-5xl">
          <form className="flex max-h-[calc(100vh-2rem)] flex-col" onSubmit={handleSubmit}>
            <DialogHeader className="px-5 pt-5">
              <DialogTitle>新建 Skill</DialogTitle>
              <DialogDescription>
                填好主说明和附件后提交审核。
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
                <div className="flex flex-col gap-5">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="skill-create-title">标题</Label>
                    <Input
                      id="skill-create-title"
                      value={form.title}
                      aria-invalid={errors.title ? "true" : undefined}
                      onChange={(event) => updateField("title", event.target.value)}
                      placeholder="例如：API 文档生成助手"
                    />
                    <FieldError message={errors.title} />
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="skill-create-description">简介</Label>
                    <Textarea
                      id="skill-create-description"
                      value={form.description}
                      aria-invalid={errors.description ? "true" : undefined}
                      className="min-h-24"
                      onChange={(event) => updateField("description", event.target.value)}
                      placeholder="例如：自动整理 API 文档。"
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
                            className={`size-4 rounded-sm ring-1 ring-border/60 ${option.swatchClassName}`}
                          />
                          <span>{option.label}</span>
                        </Button>
                      ))}
                    </div>
                    <FieldError message={errors.iconBg} />
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
                        "rounded-lg border border-dashed border-border/80 bg-muted/10 p-5 transition-colors",
                        isDraggingFiles && "border-primary bg-muted/30",
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
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            disabled={isCollectingFiles || isSubmitting}
                            onClick={() => fileInputRef.current?.click()}
                          >
                            <Paperclip />
                            选择文件
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
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
                      <div className="overflow-hidden rounded-lg border border-border/70">
                        <div className="flex items-center justify-between border-b border-border/70 bg-muted/20 px-3 py-2 text-sm">
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
                              key={file.relativePath}
                              className="flex items-start justify-between gap-3 border-b border-border/70 px-3 py-3 last:border-b-0"
                            >
                              <div className="min-w-0">
                                <p className="break-all text-sm font-medium text-foreground">
                                  {file.relativePath}
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
                                    form.files.filter((item) => item.relativePath !== file.relativePath),
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
                </div>

                <aside className="rounded-lg border border-border/70 bg-muted/10 p-4">
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">预览</p>
                      <p className="text-sm text-muted-foreground">
                        已选 {form.files.length} 个附件，共 {formatSkillAttachmentSize(totalAttachmentSize)}。
                      </p>
                    </div>

                    <div className="flex items-center gap-4">
                      <ContentIconBadge size="lg" tone={form.iconBg || null} title={form.title || "Skill 预览"}>
                        {previewIconOption ? (
                          <previewIconOption.icon className="size-6" />
                        ) : (
                          <Sparkles className="size-6" />
                        )}
                      </ContentIconBadge>

                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {form.title.trim() || "Skill 标题"}
                        </p>
                        <p className="line-clamp-2 text-sm text-muted-foreground">
                          {form.description.trim() || "简要说明"}
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
              <Button type="submit" disabled={isSubmitting || isCollectingFiles}>
                {isSubmitting ? "正在提交..." : "提交审核"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}

export { SkillCreateDialog }
