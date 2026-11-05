import { useState } from "react"
import { ChevronDown } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { ConfigurationFieldError, configurationFieldProps, type ConfigurationFieldErrors } from "../../../src/components/configuration-field-error"
import { requestOpenSettingsTab } from "../../../src/app-shell/navigation"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { ActionPromptField } from "../../../src/action-runtime/action-prompt-field"
import type { AutomationTriggerVariableDescriptor } from "../../../automation-trigger-packages/types.shared"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../../src/components/ui/collapsible"
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
  triggerVariables = [],
  triggerTitle,
  fieldErrors,
  onAddProject,
}: {
  readonly value: AgentActionConfig
  readonly onChange: (value: AgentActionConfig) => void
  readonly projects?: readonly SynapseProjectConfig[]
  readonly fieldErrors?: ConfigurationFieldErrors
  readonly onAddProject?: () => void
  readonly triggerVariables?: readonly AutomationTriggerVariableDescriptor[]
  readonly triggerTitle?: string
}) {
  const providerErrors = fieldErrors?.modelTier && !fieldErrors.providerId ? { ...fieldErrors, providerId: fieldErrors.modelTier } : fieldErrors
  const advancedExpanded = Boolean(fieldErrors?.timeoutMins || fieldErrors?.sessionPolicy)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)

  return (
    <FieldGroup className="@container/config">
      <div className="grid gap-4 @lg/config:grid-cols-2">
        <Field className="@lg/config:col-span-2">
          <FieldLabel htmlFor="task-action-agent-project">项目</FieldLabel>
          <FieldContent>
            <Select
              value={value.projectId}
              onValueChange={(projectId) => onChange({ ...value, agentType: "claude-code", projectId })}
            >
              <SelectTrigger
                id="task-action-agent-project"
                {...configurationFieldProps(fieldErrors, "projectId", "task-action-agent-project")}
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
            <ConfigurationFieldError errors={fieldErrors} name="projectId" id="task-action-agent-project" />
            {!projects.length ? <div className="flex flex-wrap items-center gap-2"><span className="text-sm text-muted-foreground">尚无项目</span><Button type="button" variant="outline" onClick={onAddProject ?? requestOpenSettingsTab}>{onAddProject ? "添加项目" : "打开设置"}</Button></div> : null}
          </FieldContent>
        </Field>

        <Field>
          <FieldLabel htmlFor="task-action-agent-provider">供应商 + 模型</FieldLabel>
          <FieldContent>
            <Button
              id="task-action-agent-provider"
              {...configurationFieldProps(providerErrors, "providerId", "task-action-agent-provider")}
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
            <ConfigurationFieldError errors={providerErrors} name="providerId" id="task-action-agent-provider" />
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
                  id="task-action-agent-mode" {...configurationFieldProps(fieldErrors, "mode", "task-action-agent-mode")}
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
            <ConfigurationFieldError errors={fieldErrors} name="mode" id="task-action-agent-mode" />
          </FieldContent>
        </Field>
      </div>

      <ActionPromptField fieldErrors={fieldErrors} id="task-action-agent-prompt" value={value.prompt} variables={triggerVariables} triggerTitle={triggerTitle}
        onChange={(prompt) => onChange({ ...value, prompt })} />

      <Collapsible open={advancedOpen || advancedExpanded} onOpenChange={setAdvancedOpen} className="border-t pt-4">
        <CollapsibleTrigger asChild><Button type="button" variant="ghost"><ChevronDown data-icon="inline-start" className={advancedOpen || advancedExpanded ? "rotate-180" : undefined} />会话与超时</Button></CollapsibleTrigger>
        <CollapsibleContent forceMount className="mt-4 data-[state=closed]:hidden">
          <div className="grid gap-4 @lg/config:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="task-action-agent-session-policy">会话策略</FieldLabel>
              <FieldContent>
                <ToggleGroup
                  id="task-action-agent-session-policy" {...configurationFieldProps(fieldErrors, "sessionPolicy", "task-action-agent-session-policy")} aria-label="会话策略"
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
                <ConfigurationFieldError errors={fieldErrors} name="sessionPolicy" id="task-action-agent-session-policy" />
              </FieldContent>
            </Field>

            <Field>
              <FieldLabel htmlFor="task-action-agent-timeout">超时分钟</FieldLabel>
              <FieldContent>
                <Input
                  id="task-action-agent-timeout" {...configurationFieldProps(fieldErrors, "timeoutMins", "task-action-agent-timeout")}
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
                <ConfigurationFieldError errors={fieldErrors} name="timeoutMins" id="task-action-agent-timeout" />
              </FieldContent>
            </Field>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </FieldGroup>
  )
}
