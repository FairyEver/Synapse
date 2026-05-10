import { useEffect, useMemo, useState } from "react"
import { AlertCircle, LoaderCircle } from "lucide-react"
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { agentDefinitions } from "@/definitions/generated/renderer-registry"
import { ContentItemIcon } from "@/modules/content/components/content-item-icon"
import { useAgentRuntimeStatus } from "@/modules/settings/hooks/use-agent-runtime-status"
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
  const [selectedAgentType, setSelectedAgentType] = useState<string>("")

  const selectedProject = useMemo(
    () => projects.find((p) => p.id === selectedProjectId),
    [projects, selectedProjectId],
  )

  const { status: runtimeStatus } = useAgentRuntimeStatus(selectedProjectId || undefined)

  const selectedAgentReady = useMemo(() => {
    if (!runtimeStatus || !selectedAgentType) return null
    const agent = runtimeStatus.agents.find((a) => a.id === selectedAgentType)
    return agent?.cli.installed ?? false
  }, [runtimeStatus, selectedAgentType])

  useEffect(() => {
    if (!open) return
    const firstProject = projects[0]
    if (firstProject) {
      setSelectedProjectId(firstProject.id)
    }
  }, [open, projects])

  useEffect(() => {
    if (!selectedProject) return
    const defaultAgent = selectedProject.defaultAgentId
    if (defaultAgent && agentDefinitions.some((d) => d.id === defaultAgent)) {
      setSelectedAgentType(defaultAgent)
    } else if (agentDefinitions.length > 0) {
      setSelectedAgentType(agentDefinitions[0].id)
    }
  }, [selectedProject])

  const canSubmit =
    Boolean(item) &&
    Boolean(selectedProjectId) &&
    Boolean(selectedAgentType) &&
    selectedAgentReady !== false &&
    !isRunning

  const handleRun = async (navigate: boolean) => {
    if (!item || !selectedProjectId || !selectedAgentType) return
    const success = await run({ item, projectId: selectedProjectId, agentType: selectedAgentType, navigate })
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

          <div className="flex flex-col gap-2">
            <Label>Agent 类型</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={selectedAgentType}
              onValueChange={(value) => {
                if (value) setSelectedAgentType(value)
              }}
              className="w-full justify-start"
            >
              {agentDefinitions.map((agent) => (
                <ToggleGroupItem key={agent.id} value={agent.id}>
                  {agent.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {selectedAgentReady === false ? (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="size-3.5 shrink-0" />
                所选 Agent 未安装
              </p>
            ) : null}
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
