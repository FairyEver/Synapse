import { useEffect, useId, useRef, useState } from "react"
import { toast } from "sonner"
import { createRendererLogger } from "@/app-shell/logging"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { getProjectNameFromPath } from "@/lib/path-utils"
import type { ProjectAddInput, ProjectAddResult } from "@/app-shell/use-project-actions"
import type { ReactNode } from "react"

const logger = createRendererLogger("projects.add-dialog")

type ProjectAddDialogProps = {
  readonly open: boolean
  readonly initialValues?: ProjectAddInput | null
  readonly onOpenChange: (open: boolean) => void
  readonly onAddProject: (input: ProjectAddInput) => Promise<ProjectAddResult>
  readonly trigger?: ReactNode
}

function ProjectAddDialog({
  open,
  initialValues,
  onOpenChange,
  onAddProject,
  trigger,
}: ProjectAddDialogProps) {
  const nameInputId = useId()
  const pathInputId = useId()
  const [draftName, setDraftName] = useState("")
  const [draftPath, setDraftPath] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const isSubmittingRef = useRef(false)
  const nameInputRef = useRef<HTMLInputElement>(null)
  const pathInputRef = useRef<HTMLInputElement>(null)
  const hasDirectoryPicker = Boolean(window.synapse?.settings.repository)

  useEffect(() => {
    if (!open) return
    setDraftName(initialValues?.name ?? "")
    setDraftPath(initialValues?.path ?? "")
    setFormError(null)
  }, [initialValues?.name, initialValues?.path, open])

  useEffect(() => {
    if (isSubmitting) return
    if (formError === "这个项目路径已经存在了。") {
      pathInputRef.current?.focus()
    } else if (formError === "这个项目名称已经存在了。") {
      nameInputRef.current?.focus()
    }
  }, [formError, isSubmitting])

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmittingRef.current) return
    onOpenChange(nextOpen)
  }

  const handleChooseProjectPath = async () => {
    const bridge = window.synapse?.settings.repository
    if (!bridge) return

    try {
      const selectedPath = await bridge.chooseDirectory()
      if (!selectedPath) return

      setDraftPath(selectedPath)
      setDraftName((currentName) => currentName.trim() || getProjectNameFromPath(selectedPath))
      setFormError(null)
    } catch (error) {
      logger.error("Failed to select project directory.", { error })
      setFormError(error instanceof Error ? error.message : "选择目录失败。")
    }
  }

  const handleAddProject = async () => {
    if (isSubmittingRef.current) return
    const name = draftName.trim()
    const projectPath = draftPath.trim()

    if (!name || !projectPath) {
      setFormError("项目名称和项目路径都不能为空。")
      if (!name) {
        nameInputRef.current?.focus()
      } else {
        pathInputRef.current?.focus()
      }
      return
    }

    isSubmittingRef.current = true
    setIsSubmitting(true)
    setFormError(null)

    try {
      const result = await onAddProject({ name, path: projectPath })
      if (result.status === "existing") {
        setFormError("这个项目路径已经存在了。")
        return
      }

      toast.success("项目已添加。")
      onOpenChange(false)
    } catch (error) {
      logger.error("Failed to add project.", { error, name, path: projectPath })
      const message = error instanceof Error ? error.message : "添加失败。"
      setFormError(message)
    } finally {
      isSubmittingRef.current = false
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>添加项目</DialogTitle>
          <DialogDescription className="sr-only">
            输入项目名称和路径。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-2">
          <Field>
            <Label htmlFor={nameInputId}>项目名称</Label>
            <Input
              id={nameInputId}
              ref={nameInputRef}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              placeholder="我的项目"
              disabled={isSubmitting}
            />
          </Field>
          <Field>
            <Label htmlFor={pathInputId}>项目路径</Label>
            <div className="flex gap-2">
              <Input
                id={pathInputId}
                ref={pathInputRef}
                value={draftPath}
                onChange={(event) => setDraftPath(event.target.value)}
                placeholder="/path/to/project"
                disabled={isSubmitting}
              />
              {hasDirectoryPicker ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleChooseProjectPath()}
                  disabled={isSubmitting}
                >
                  浏览
                </Button>
              ) : null}
            </div>
          </Field>
          <FieldError>{formError}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isSubmitting}
          >
            取消
          </Button>
          <Button
            onClick={() => void handleAddProject()}
            disabled={isSubmitting}
          >
            {isSubmitting ? "添加中..." : "添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { ProjectAddDialog }
export type { ProjectAddDialogProps }
