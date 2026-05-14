import { ChevronDown } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { agentBaseDefinition as claudeCodeDef } from "../../../src/definitions/agent/claude-code/agent-shared"
import { AgentPermissionModeMenu } from "../../../src/modules/agent/components/permission-mode-menu"
import { permissionModeLabels } from "../../../src/modules/agent/permission-mode-options"
import type { SynapseAgentPermissionMode } from "../../../src/types/agent"
import type { AgentActionConfig } from "./schema"

const AGENT_DEFINITIONS = [claudeCodeDef] as const

export function AgentConfigForm({
  value,
  onChange,
}: {
  readonly value: AgentActionConfig
  readonly onChange: (value: AgentActionConfig) => void
}) {
  return (
    <FieldGroup>
      <div className="grid gap-3 md:grid-cols-2">
        <Field data-disabled>
          <FieldLabel htmlFor="task-action-agent-type">智能体</FieldLabel>
          <FieldContent>
            <Button
              id="task-action-agent-type"
              type="button"
              variant="outline"
              className="w-full"
              disabled
            >
              {AGENT_DEFINITIONS[0].label}
            </Button>
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

      <div className="grid grid-cols-2 gap-3">
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
