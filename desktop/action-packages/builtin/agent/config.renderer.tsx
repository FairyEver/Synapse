import { useMemo } from "react"
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
import { agentBaseDefinition as codexDef } from "../../../src/definitions/agent/codex/agent-shared"
import type { AgentActionConfig } from "./schema"

const AGENT_DEFINITIONS = [claudeCodeDef, codexDef] as const

export function AgentConfigForm({
  value,
  onChange,
}: {
  readonly value: AgentActionConfig
  readonly onChange: (value: AgentActionConfig) => void
}) {
  const selectedDef = AGENT_DEFINITIONS.find((d) => d.id === value.agentType)
  const unattendedModes = useMemo(
    () => selectedDef?.modes.filter((m) => "unattended" in m && m.unattended) ?? [],
    [selectedDef],
  )

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-agent-type">Agent</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Agent type"
            className="w-full"
            type="single"
            value={value.agentType}
            variant="outline"
            onValueChange={(agentType) => {
              if (!agentType) return
              const def = AGENT_DEFINITIONS.find((d) => d.id === agentType)
              const firstUnattended = def?.modes.find((m) => "unattended" in m && m.unattended)
              onChange({
                ...value,
                agentType: agentType as AgentActionConfig["agentType"],
                mode: firstUnattended?.key ?? "",
              })
            }}
          >
            {AGENT_DEFINITIONS.map((def) => (
              <ToggleGroupItem key={def.id} className="flex-1" value={def.id}>
                {def.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>

      <Field>
        <FieldLabel htmlFor="task-action-agent-mode">执行模式</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="执行模式"
            className="w-full"
            type="single"
            value={value.mode}
            variant="outline"
            onValueChange={(mode) => {
              if (mode) onChange({ ...value, mode })
            }}
          >
            {unattendedModes.map((mode) => (
              <ToggleGroupItem key={mode.key} className="flex-1" value={mode.key}>
                {mode.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>

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
