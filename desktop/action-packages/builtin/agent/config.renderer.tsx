import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { ProviderModelSelectDialog } from "../../../src/components/provider-model-select-dialog"
import { formatProviderModelLabel } from "../../../src/lib/provider-model"
import { AgentPermissionModeMenu } from "../../../src/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "../../../src/modules/agent/permission-mode-options"
import type { SynapseAgentPermissionMode } from "../../../src/types/agent"
import type { SynapseProjectConfig } from "../../../src/types/config"
import type { AgentActionConfig } from "./schema"

export function AgentConfigForm({
  value,
  onChange,
  projects = [],
}: {
  readonly value: AgentActionConfig
  readonly onChange: (value: AgentActionConfig) => void
  readonly projects?: readonly SynapseProjectConfig[]
}) {
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)

  return (
    <FieldGroup>
      <div className="grid gap-2 md:grid-cols-2">
        <Field>
          <FieldLabel htmlFor="task-action-agent-project">项目</FieldLabel>
          <FieldContent>
            <Select
              value={value.projectId}
              onValueChange={(projectId) => onChange({ ...value, agentType: "claude-code", projectId })}
            >
              <SelectTrigger
                id="task-action-agent-project"
                data-testid="automation-agent-project-select"
                className="w-full"
              >
                <SelectValue placeholder="选择项目" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="task-action-agent-provider">供应商 + 模型</FieldLabel>
          <FieldContent>
            <Button
              id="task-action-agent-provider"
              type="button"
              variant="outline"
              className="w-full justify-between"
              onClick={() => setProviderDialogOpen(true)}
            >
              <span className="truncate">
                {value.providerId
                  ? formatProviderModelLabel(
                    value.providerName ?? value.providerId,
                    value.modelName,
                    value.modelTier,
                    { id: value.providerId },
                  )
                  : "选择供应商 + 模型"}
              </span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </Button>
            <ProviderModelSelectDialog
              open={providerDialogOpen}
              onOpenChange={setProviderDialogOpen}
              defaultSelection={value.providerId ? { providerId: value.providerId, modelTier: value.modelTier } : undefined}
              onSelect={(s) => onChange({ ...value, agentType: "claude-code", providerId: s.providerId, modelTier: s.modelTier, providerName: s.providerName, modelName: s.modelName })}
            />
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="task-action-agent-mode">权限模式</FieldLabel>
          <FieldContent>
            <AgentPermissionModeMenu
              selectedMode={value.mode}
              contentClassName="w-56"
              onSelect={(mode: SynapseAgentPermissionMode) => {
                onChange({ ...value, agentType: "claude-code", mode })
              }}
              trigger={(
                <Button
                  id="task-action-agent-mode"
                  type="button"
                  variant="outline"
                  className="w-full justify-between"
                  aria-label="权限模式"
                >
                  <span className="truncate">{permissionModeLabels[value.mode]}</span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </Button>
              )}
            />
          </FieldContent>
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="task-action-agent-prompt">提示词</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-agent-prompt"
            rows={5}
            placeholder="输入要发送给 Agent 的提示词..."
            value={value.prompt}
            onChange={(e) => onChange({ ...value, prompt: e.target.value })}
          />
        </FieldContent>
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field>
          <FieldLabel htmlFor="task-action-agent-session-policy">会话策略</FieldLabel>
          <FieldContent>
            <ToggleGroup
              aria-label="Session policy"
              className="w-full"
              type="single"
              value={value.sessionPolicy}
              variant="outline"
              onValueChange={(policy) => {
                if (policy) onChange({ ...value, sessionPolicy: policy as "fresh" | "resume" })
              }}
            >
              <ToggleGroupItem className="flex-1" value="fresh">
                每次新建
              </ToggleGroupItem>
              <ToggleGroupItem className="flex-1" value="resume">
                复用上次
              </ToggleGroupItem>
            </ToggleGroup>
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="task-action-agent-timeout">超时分钟</FieldLabel>
          <FieldContent>
            <Input
              id="task-action-agent-timeout"
              type="number"
              min={1}
              max={120}
              value={value.timeoutMins ?? ""}
              onChange={(e) =>
                onChange({
                  ...value,
                  timeoutMins: e.target.value ? Number(e.target.value) : null,
                })
              }
            />
          </FieldContent>
        </Field>
      </div>
    </FieldGroup>
  )
}
