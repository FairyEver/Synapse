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
import { FieldHelp, LabelWithHelp, type FieldHelpContent } from "../field-help"
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

const CLAUDE_CODE_FIELD_HELP = {
  project: {
    title: "项目",
    summary: "选择 Claude Code 运行时绑定的 Synapse 项目。",
    impact: "影响范围：工作目录、项目配置和文件访问基准。",
  },
  workingDirectory: {
    title: "工作目录",
    summary: "设置本次 Claude Code 实际运行的目录，支持 {{变量}}。",
    impact: "留空时使用项目目录；额外目录只扩大可访问上下文，不改变工作目录。",
  },
  prompt: {
    title: "指令",
    summary: "发送给 Claude Code 的任务内容，可引用输入映射中的变量。",
    impact: "影响范围：任务目标、上下文组织和最终输出。",
  },
  model: {
    title: "模型",
    summary: "指定本节点使用的 Claude 模型。",
    impact: "影响范围：回答质量、速度、费用和可用能力。",
  },
  maxTurns: {
    title: "Max turns",
    summary: "限制 Claude Code 在本次任务中的最大交互轮数。",
    impact: "影响范围：长任务推进深度、费用和超长运行风险。",
  },
  settingSources: {
    title: "设置来源",
    summary: "选择 Claude Code 读取哪些层级的设置。",
    impact: "影响范围：用户设置、项目设置、本地设置和 MCP 可见性。",
    note: "至少保留一个来源，避免节点失去必要运行配置。",
  },
  settingsPath: {
    title: "Settings 路径",
    summary: "指定额外的 Claude Code settings 文件路径。",
    impact: "影响范围：本次执行使用的设置来源和覆盖关系。",
  },
  mcpConfigPath: {
    title: "MCP 配置路径",
    summary: "指定本次 Claude Code 使用的 MCP 配置文件路径。",
    impact: "影响范围：可用 MCP server、工具列表和工具权限请求。",
  },
  strictMcpConfig: {
    title: "严格 MCP 配置",
    summary: "MCP 配置异常时让节点直接失败。",
    impact: "影响范围：MCP 启动失败、配置排查和无人值守运行稳定性。",
  },
  permissionMode: {
    title: "权限模式",
    summary: "控制 Claude Code 执行工具或修改文件前的授权方式。",
    impact: "影响范围：工具调用、文件修改、无人值守运行和安全边界。",
  },
  timeoutMins: {
    title: "超时分钟",
    summary: "限制本节点最多运行多久，留空时使用工作流默认超时。",
    impact: "影响范围：长任务等待时间、失败判定和后续节点启动时间。",
  },
  outputFormat: {
    title: "输出格式",
    summary: "选择 Claude Code 输出结果的格式。",
    impact: "影响范围：结果解析、调试文件和后续节点读取内容。",
  },
  verbose: {
    title: "Verbose",
    summary: "输出更详细的 Claude Code 运行信息。",
    impact: "影响范围：调试排查、输出体积和运行记录可读性。",
  },
  safeMode: {
    title: "Safe mode",
    summary: "以更保守的方式运行 Claude Code。",
    impact: "影响范围：工具使用、文件修改倾向和自动化风险。",
  },
  bareMode: {
    title: "Bare mode",
    summary: "减少 Claude Code 默认上下文和附加行为。",
    impact: "影响范围：启动上下文、输出内容和兼容性排查。",
  },
  noSessionPersistence: {
    title: "不保存会话",
    summary: "本次执行结束后不保留 Claude Code 会话。",
    impact: "影响范围：会话恢复、历史排查和本机记录留存。",
  },
  additionalDirectories: {
    title: "额外目录",
    summary: "让 Claude Code 除工作目录外还能访问的目录。",
    impact: "影响范围：跨目录读取、代码库上下文和文件访问边界。",
  },
  allowedTools: {
    title: "允许工具",
    summary: "限制本次执行允许 Claude Code 使用的工具。",
    impact: "影响范围：工具可用范围、自动化能力和执行成功率。",
  },
  disallowedTools: {
    title: "禁用工具",
    summary: "阻止本次执行使用指定 Claude Code 工具。",
    impact: "影响范围：敏感工具屏蔽、权限控制和任务可完成性。",
  },
  captureDebugArtifacts: {
    title: "保存调试文件",
    summary: "保存本次 Claude Code 执行的提示词、输出和调试预览。",
    impact: "影响范围：运行历史排查、磁盘占用和敏感信息脱敏后的留存。",
  },
} satisfies Record<string, FieldHelpContent>

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
          <LabelWithHelp label="项目" help={CLAUDE_CODE_FIELD_HELP.project} />
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
            help={CLAUDE_CODE_FIELD_HELP.workingDirectory}
            value={config.workingDirectory ?? ""}
            placeholder="留空使用项目目录"
            onChange={(value) => updateConfig({ workingDirectory: value === "" ? undefined : value })}
          />
          <FieldError message={errorFor("workingDirectory")} />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="指令" summary={promptSummary}>
        <LabelWithHelp label="指令" help={CLAUDE_CODE_FIELD_HELP.prompt} />
        <PromptEditor
          value={config.prompt}
          onChange={(prompt) => updateConfig({ prompt })}
          onBlur={() => undefined}
          variables={config.variables}
          placeholder="输入指令，用 {{变量名}} 引用变量…"
        />
        <FieldError message={errorFor("prompt")} />
      </CollapsibleSection>

      <CollapsibleSection title="Claude Code 设置">
        <div className="grid gap-2">
          <LabeledInput
            id="claude-code-model"
            label="模型"
            help={CLAUDE_CODE_FIELD_HELP.model}
            value={config.model ?? ""}
            onChange={(value) => updateConfig({ model: value === "" ? undefined : value })}
          />
          <LabeledInput
            id="claude-code-max-turns"
            label="Max turns"
            help={CLAUDE_CODE_FIELD_HELP.maxTurns}
            type="number"
            min={1}
            value={config.maxTurns?.toString() ?? ""}
            onChange={(value) => updateConfig({ maxTurns: value === "" ? undefined : Number(value) })}
          />
          <SettingSourcesEditor
            help={CLAUDE_CODE_FIELD_HELP.settingSources}
            values={config.settingSources}
            onChange={(settingSources) => updateConfig({ settingSources })}
          />
          <LabeledInput
            id="claude-code-settings-path"
            label="Settings 路径"
            help={CLAUDE_CODE_FIELD_HELP.settingsPath}
            value={config.settingsPath ?? ""}
            onChange={(value) => updateConfig({ settingsPath: value === "" ? undefined : value })}
          />
          <LabeledInput
            id="claude-code-mcp-config-path"
            label="MCP 配置路径"
            help={CLAUDE_CODE_FIELD_HELP.mcpConfigPath}
            value={config.mcpConfigPath ?? ""}
            onChange={(value) => updateConfig({ mcpConfigPath: value === "" ? undefined : value })}
          />
          <BooleanRow
            id="claude-code-strict-mcp-config"
            label="严格 MCP 配置"
            help={CLAUDE_CODE_FIELD_HELP.strictMcpConfig}
            checked={config.strictMcpConfig}
            onChange={(strictMcpConfig) => updateConfig({ strictMcpConfig })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <LabeledSelect
            id="claude-code-permission-mode"
            label="权限模式"
            help={CLAUDE_CODE_FIELD_HELP.permissionMode}
            value={config.permissionMode}
            onValueChange={(value) => updateConfig({ permissionMode: value as ClaudeCodePermissionMode })}
          >
            {PERMISSION_MODES.map((mode) => <SelectItem key={mode} value={mode}>{mode}</SelectItem>)}
          </LabeledSelect>
          <LabeledInput
            id="claude-code-timeout"
            label="超时分钟"
            help={CLAUDE_CODE_FIELD_HELP.timeoutMins}
            type="number"
            min={1}
            value={config.timeoutMins?.toString() ?? ""}
            onChange={(value) => updateConfig({ timeoutMins: value === "" ? undefined : Number(value) })}
          />
          <LabeledSelect
            id="claude-code-output-format"
            label="输出格式"
            help={CLAUDE_CODE_FIELD_HELP.outputFormat}
            value={config.outputFormat}
            onValueChange={(value) => updateConfig({ outputFormat: value as ClaudeCodeOutputFormat })}
          >
            {OUTPUT_FORMATS.map((format) => <SelectItem key={format} value={format}>{format}</SelectItem>)}
          </LabeledSelect>
          <BooleanRow id="claude-code-verbose" label="Verbose" help={CLAUDE_CODE_FIELD_HELP.verbose} checked={config.verbose} onChange={(verbose) => updateConfig({ verbose })} />
          <BooleanRow id="claude-code-safe-mode" label="Safe mode" help={CLAUDE_CODE_FIELD_HELP.safeMode} checked={config.safeMode} onChange={(safeMode) => updateConfig({ safeMode })} />
          <BooleanRow id="claude-code-bare-mode" label="Bare mode" help={CLAUDE_CODE_FIELD_HELP.bareMode} checked={config.bareMode} onChange={(bareMode) => updateConfig({ bareMode })} />
          <BooleanRow
            id="claude-code-no-session-persistence"
            label="不保存会话"
            help={CLAUDE_CODE_FIELD_HELP.noSessionPersistence}
            checked={config.noSessionPersistence}
            onChange={(noSessionPersistence) => updateConfig({ noSessionPersistence })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="权限与访问">
        <div className="grid gap-2">
          <StringListEditor
            label="额外目录"
            help={CLAUDE_CODE_FIELD_HELP.additionalDirectories}
            values={config.additionalDirectories}
            addLabel="添加额外目录"
            onChange={(additionalDirectories) => updateConfig({ additionalDirectories })}
            error={errorFor("additionalDirectories")}
          />
          <StringListEditor
            label="允许工具"
            help={CLAUDE_CODE_FIELD_HELP.allowedTools}
            values={config.allowedTools}
            addLabel="添加允许工具"
            onChange={(allowedTools) => updateConfig({ allowedTools })}
            error={errorFor("allowedTools")}
          />
          <StringListEditor
            label="禁用工具"
            help={CLAUDE_CODE_FIELD_HELP.disallowedTools}
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
          help={CLAUDE_CODE_FIELD_HELP.captureDebugArtifacts}
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
  help,
  value,
  onChange,
  type,
  min,
  placeholder,
}: {
  id: string
  label: string
  help?: FieldHelpContent
  value: string
  onChange: (value: string) => void
  type?: "text" | "number"
  min?: number
  placeholder?: string
}) {
  return (
    <div className="grid gap-1">
      <LabelWithHelp id={id} label={label} help={help} />
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
  help,
  value,
  onValueChange,
  children,
}: {
  id: string
  label: string
  help?: FieldHelpContent
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      <LabelWithHelp id={id} label={label} help={help} />
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
  help,
  checked,
  onChange,
}: {
  id: string
  label: string
  help?: FieldHelpContent
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
      {help ? <FieldHelp help={help} /> : null}
    </div>
  )
}

function SettingSourcesEditor({
  help,
  values,
  onChange,
}: {
  help?: FieldHelpContent
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
      <LabelWithHelp label="设置来源" help={help} />
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
  help,
  values,
  addLabel,
  onChange,
  error,
}: {
  label: string
  help?: FieldHelpContent
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
        <LabelWithHelp label={label} help={help} />
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
