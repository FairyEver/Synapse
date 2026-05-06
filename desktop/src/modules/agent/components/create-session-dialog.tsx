import { useState, useEffect } from "react"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { SynapseAgentAvailability } from "@/types/agent"

type ProjectOption = {
  id: string
  name: string
  path: string
}

type CreateSessionDialogProps = {
  open: boolean
  projects: ProjectOption[]
  agents: SynapseAgentAvailability[]
  defaultProjectId?: string
  defaultAgentType?: string
  onConfirm: (projectId: string, agentType: string) => void
  onOpenChange: (open: boolean) => void
}

function CreateSessionDialog({
  open,
  projects,
  agents,
  defaultProjectId,
  defaultAgentType,
  onConfirm,
  onOpenChange,
}: CreateSessionDialogProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("")
  const [selectedAgentType, setSelectedAgentType] = useState<string>("")

  useEffect(() => {
    if (open) {
      const projectId = defaultProjectId
        ?? (projects.length === 1 ? projects[0].id : "")
      setSelectedProjectId(projectId)
      setSelectedAgentType(defaultAgentType ?? "")
    }
  }, [open, defaultProjectId, defaultAgentType, projects])

  const availableAgents = agents.filter((agent) => agent.available)
  const canConfirm = selectedProjectId !== "" && selectedAgentType !== ""

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>新建会话</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor="project-select">项目</Label>
            <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
              <SelectTrigger id="project-select">
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
            <Label htmlFor="agent-select">Agent</Label>
            <Select
              value={selectedAgentType}
              onValueChange={setSelectedAgentType}
              disabled={selectedProjectId === ""}
            >
              <SelectTrigger id="agent-select">
                <SelectValue placeholder="选择 Agent" />
              </SelectTrigger>
              <SelectContent>
                {availableAgents.map((agent) => (
                  <SelectItem key={agent.agentType} value={agent.agentType}>
                    {agent.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={!canConfirm}
            onClick={() => onConfirm(selectedProjectId, selectedAgentType)}
          >
            创建
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { CreateSessionDialog, type ProjectOption }
