import { Plus, Trash2 } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SynapseProjectConfig } from "@/types/config"
import type { WorkflowParam } from "@/types/workflow"
import type { WorkflowValidationDisplayItem } from "@/modules/workflow/editor/validation-display"
import { CollapsibleSection } from "../collapsible-section"
import { ProjectSelect } from "../project-select"
import { PromptEditor } from "../prompt-editor"
import { VariableBindingEditor } from "../variable-binding-editor"
import type {
  ClaudeCodeNodeConfig,
  ClaudeCodeOutputFormat,
  ClaudeCodePermissionMode,
  ClaudeCodeSettingSource,
} from "./schema"

const PERMISSION_MODES: readonly ClaudeCodePermissionMode[] = [
  "default",
  "acceptEdits",
  "plan",
  "auto",
  "dontAsk",
  "bypassPermissions",
]
const OUTPUT_FORMATS: readonly ClaudeCodeOutputFormat[] = ["stream-json", "json", "text"]
const SETTING_SOURCES: readonly ClaudeCodeSettingSource[] = ["user", "project", "local"]

export interface ClaudeCodeNodePanelProps {
  config: ClaudeCodeNodeConfig
  onChange: (config: ClaudeCodeNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function ClaudeCodeNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
  projects,
  defaultProjectName,
  validationItems = [],
}: ClaudeCodeNodePanelProps) {
  const updateConfig = (patch: Partial<ClaudeCodeNodeConfig>) => onChange({ ...config, ...patch })
  const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
  const promptSummary = config.prompt.length > 0 ? `${config.prompt.length}字` : undefined
  const variableSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={variableSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => updateConfig({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="项目">
        <div className="grid gap-2">
          <ProjectSelect
            value={config.projectId}
            onChange={(projectId) => updateConfig({ projectId })}
            projects={projects}
            placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"}
          />
          <FieldError message={errorFor("projectId")} />
          <LabeledInput
            id="claude-code-working-directory"
            label="工作目录"
            value={config.workingDirectory ?? ""}
            placeholder="留空使用项目目录"
            onChange={(value) => updateConfig({ workingDirectory: value === "" ? undefined : value })}
          />
          <FieldError message={errorFor("workingDirectory")} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="指令" summary={promptSummary}>
        <PromptEditor
          value={config.prompt}
          onChange={(prompt) => updateConfig({ prompt })}
          onBlur={() => undefined}
          variables={config.variables}
          placeholder="输入指令，用 {{变量名}} 引用变量…"
        />
        <FieldError message={errorFor("prompt")} />
      </CollapsibleSection>

      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <LabeledInput
            id="claude-code-timeout"
            label="超时分钟"
            type="number"
            min={1}
            value={config.timeoutMins?.toString() ?? ""}
            onChange={(value) => updateConfig({ timeoutMins: value === "" ? undefined : Number(value) })}
          />
          <LabeledSelect
            id="claude-code-output-format"
            label="输出格式"
            value={config.outputFormat}
            onValueChange={(value) => updateConfig({ outputFormat: value as ClaudeCodeOutputFormat })}
          >
            {OUTPUT_FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
          </LabeledSelect>
          <BooleanRow
            id="claude-code-no-session-persistence"
            label="不保存会话"
            checked={config.noSessionPersistence}
            onChange={(noSessionPersistence) => updateConfig({ noSessionPersistence })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Claude Code 配置">
        <div className="grid gap-2">
          <LabeledInput
            id="claude-code-model"
            label="模型"
            value={config.model ?? ""}
            onChange={(value) => updateConfig({ model: value === "" ? undefined : value })}
          />
          <LabeledInput
            id="claude-code-max-turns"
            label="Max turns"
            type="number"
            min={1}
            value={config.maxTurns?.toString() ?? ""}
            onChange={(value) => updateConfig({ maxTurns: value === "" ? undefined : Number(value) })}
          />
          <BooleanRow id="claude-code-verbose" label="Verbose" checked={config.verbose} onChange={(verbose) => updateConfig({ verbose })} />
          <BooleanRow id="claude-code-safe-mode" label="Safe mode" checked={config.safeMode} onChange={(safeMode) => updateConfig({ safeMode })} />
          <BooleanRow id="claude-code-bare-mode" label="Bare mode" checked={config.bareMode} onChange={(bareMode) => updateConfig({ bareMode })} />
          <SettingSourcesEditor
            values={config.settingSources}
            onChange={(settingSources) => updateConfig({ settingSources })}
          />
          <LabeledInput
            id="claude-code-settings-path"
            label="Settings 路径"
            value={config.settingsPath ?? ""}
            onChange={(value) => updateConfig({ settingsPath: value === "" ? undefined : value })}
          />
          <LabeledInput
            id="claude-code-mcp-config-path"
            label="MCP 配置路径"
            value={config.mcpConfigPath ?? ""}
            onChange={(value) => updateConfig({ mcpConfigPath: value === "" ? undefined : value })}
          />
          <BooleanRow
            id="claude-code-strict-mcp-config"
            label="严格 MCP 配置"
            checked={config.strictMcpConfig}
            onChange={(strictMcpConfig) => updateConfig({ strictMcpConfig })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="权限规则">
        <div className="grid gap-2">
          <LabeledSelect
            id="claude-code-permission-mode"
            label="Permission mode"
            value={config.permissionMode}
            onValueChange={(value) => updateConfig({ permissionMode: value as ClaudeCodePermissionMode })}
          >
            {PERMISSION_MODES.map((mode) => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}
          </LabeledSelect>
          <StringListEditor
            label="额外目录"
            values={config.additionalDirectories}
            addLabel="添加额外目录"
            onChange={(additionalDirectories) => updateConfig({ additionalDirectories })}
            error={errorFor("additionalDirectories")}
          />
          <StringListEditor
            label="允许工具"
            values={config.allowedTools}
            addLabel="添加允许工具"
            onChange={(allowedTools) => updateConfig({ allowedTools })}
            error={errorFor("allowedTools")}
          />
          <StringListEditor
            label="禁用工具"
            values={config.disallowedTools}
            addLabel="添加禁用工具"
            onChange={(disallowedTools) => updateConfig({ disallowedTools })}
            error={errorFor("disallowedTools")}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="调试记录">
        <BooleanRow
          id="claude-code-capture-debug-artifacts"
          label="保存调试文件"
          checked={config.captureDebugArtifacts}
          onChange={(captureDebugArtifacts) => updateConfig({ captureDebugArtifacts })}
        />
      </CollapsibleSection>
    </div>
  )
}

function LabeledInput({
  id,
  label,
  value,
  onChange,
  type,
  min,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "number"
  min?: number
  placeholder?: string
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input
        id={id}
        aria-label={label}
        className="h-7 text-xs"
        value={value}
        type={type}
        min={min}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  )
}

function LabeledSelect({
  id,
  label,
  value,
  onValueChange,
  children,
}: {
  id: string
  label: string
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger id={id} aria-label={label} className="h-7 w-full text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {children}
        </SelectContent>
      </Select>
    </div>
  )
}

function BooleanRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <Checkbox
        id={id}
        aria-label={label}
        checked={checked}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <Label htmlFor={id} className="text-xs font-normal">{label}</Label>
    </div>
  )
}

function SettingSourcesEditor({
  values,
  onChange,
}: {
  values: readonly ClaudeCodeSettingSource[]
  onChange: (values: ClaudeCodeSettingSource[]) => void
}) {
  const toggle = (source: ClaudeCodeSettingSource, checked: boolean) => {
    if (checked) {
      onChange(SETTING_SOURCES.filter((item) => item === source || values.includes(item)))
      return
    }
    if (values.length <= 1 && values.includes(source)) return
    onChange(values.filter((item) => item !== source))
  }

  return (
    <div className="grid gap-1.5">
      <Label className="text-xs">设置来源</Label>
      <div className="flex flex-wrap gap-2">
        {SETTING_SOURCES.map((source) => (
          <BooleanRow
            key={source}
            id={`claude-code-setting-source-${source}`}
            label={source}
            checked={values.includes(source)}
            onChange={(checked) => toggle(source, checked)}
          />
        ))}
      </div>
    </div>
  )
}

function StringListEditor({
  label,
  values,
  addLabel,
  onChange,
  error,
}: {
  label: string
  values: string[]
  addLabel: string
  onChange: (values: string[]) => void
  error?: string
}) {
  const add = () => onChange([...values, ""])
  const update = (index: number, value: string) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item))
  const remove = (index: number) => onChange(values.filter((_, itemIndex) => itemIndex !== index))

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">{label}</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          aria-label={addLabel}
          onClick={add}
        >
          <Plus className="h-3 w-3" />
          添加
        </Button>
      </div>
      {values.map((value, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_1.75rem] items-center gap-1.5">
          <Input
            aria-label={`${label} ${index + 1}`}
            className="h-7 text-xs"
            value={value}
            onChange={(event) => update(index, event.target.value)}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`删除${label} ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <FieldError message={error} />
    </div>
  )
}

function FieldError({ message }: { readonly message?: string }) {
  return message ? <p className="text-xs text-destructive">{message}</p> : null
}
