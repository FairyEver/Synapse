import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { useAppConfig } from "@/app-shell/config"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { usePromptRun } from "@/modules/prompts/hooks/use-prompt-run"
import type { SynapseContentMeta } from "@/types/content"

type PromptRunDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: SynapseContentMeta<"prompt"> | null
}

function PromptRunDialog({ open, onOpenChange, item }: PromptRunDialogProps) {
  const { config } = useAppConfig()
  const projects = config.global.projects
  const { run, isRunning } = usePromptRun()

  const [selectedProjectId, setSelectedProjectId] = useState<string>("")

  useEffect(() => {
    if (!open) return
    const firstProject = projects[0]
    if (firstProject) {
      setSelectedProjectId(firstProject.id)
    }
  }, [open, projects])

  const canSubmit = Boolean(item) && Boolean(selectedProjectId) && !isRunning

  const handleRun = async (navigate: boolean) => {
    if (!item || !selectedProjectId) return
    const success = await run({ item, projectId: selectedProjectId, agentType: "claude-code", navigate })
    if (success) {
      onOpenChange(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} data-track="prompt-run-dialog">
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {item ? (
            <div className="flex items-center gap-3">
              <ContentItemIcon
                className="size-8 shrink-0 [&_svg]:size-4"
                contentId={item.id}
                contentType={item.type}
                icon={item.icon}
                iconType={item.iconType}
                iconImage={item.iconImage}
                title={item.title}
                tone={item.iconBg}
              />
              <div className="min-w-0">
                <DialogTitle className="truncate">{item.title}</DialogTitle>
                {item.description ? (
                  <DialogDescription className="line-clamp-1">
                    {item.description}
                  </DialogDescription>
                ) : null}
              </div>
            </div>
          ) : (
            <DialogTitle>运行提示词</DialogTitle>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label>项目</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>
                    {project.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            disabled={!canSubmit}
            onClick={() => void handleRun(false)}
          >
            {isRunning ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            后台发送
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => void handleRun(true)}
          >
            {isRunning ? (
              <LoaderCircle className="animate-spin" data-icon="inline-start" />
            ) : null}
            发送并跳转
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { PromptRunDialog }
