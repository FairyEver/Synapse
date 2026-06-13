import { useEffect, useRef, useState, type ReactNode } from "react"
import { CircleHelp, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
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
  CodexApprovalPolicy,
  CodexFeatureState,
  CodexNodeConfig,
  CodexSandbox,
} from "./schema"

const MODEL_INHERIT_VALUE = "__inherit_codex_config__"

type HelpTopic = {
  title: string
  summary: string
  impact: string
  note?: string
}

const CODEX_FIELD_HELP = {
  approvalPolicy: {
    title: "审批策略",
    summary: "决定 Codex 执行命令前什么时候需要人工确认。",
    impact: "影响范围：命令审批、无人值守运行和失败恢复。",
  },
  sandbox: {
    title: "沙箱",
    summary: "限制 Codex 执行命令时能访问和修改的文件范围。",
    impact: "影响范围：命令执行、文件读写和自动化运行的安全边界。",
  },
  model: {
    title: "模型",
    summary: "指定本节点使用的 Codex 模型；继承配置时不传 --model。",
    impact: "影响范围：回答质量、速度、费用和 Codex 可用能力。",
  },
  profile: {
    title: "Profile",
    summary: "加载 Codex 配置文件中的指定 profile。",
    impact: "影响范围：Codex 配置层叠、模型、权限和其它 CLI 默认值。",
  },
  timeoutMins: {
    title: "超时分钟",
    summary: "限制本节点最多运行多久，留空时使用工作流默认超时。",
    impact: "影响范围：长任务等待时间、失败判定和后续节点启动时间。",
  },
  enableSearch: {
    title: "启用搜索",
    summary: "允许 Codex 在本次执行中使用实时网页搜索。",
    impact: "影响范围：联网查询、结果时效性和外部请求。",
  },
  goals: {
    title: "Goals",
    summary: "控制 Codex 的目标模式功能是否在本次执行中启用。",
    impact: "影响范围：任务分解、进度管理和 Codex 运行策略。",
  },
  skipGitRepoCheck: {
    title: "跳过 Git 仓库检查",
    summary: "允许 Codex 在非 Git 目录中运行。",
    impact: "影响范围：无仓库项目、临时目录和路径校验。",
  },
  strictConfig: {
    title: "严格配置",
    summary: "让 Codex 遇到不认识的配置项时直接报错。",
    impact: "影响范围：配置兼容性、升级后的旧配置和启动失败原因。",
  },
  bypassApprovalsAndSandbox: {
    title: "绕过审批和沙箱",
    summary: "跳过审批并关闭沙箱限制，只适合外部已隔离的环境。",
    impact: "影响范围：文件写入、命令执行和本机安全边界。",
    note: "高风险选项；开启后不会同时传审批策略和沙箱参数。",
  },
  bypassHookTrust: {
    title: "绕过 Hook 信任检查",
    summary: "允许已启用的 Codex hook 在未持久信任时运行。",
    impact: "影响范围：自动化 hook、外部脚本和执行前置/后置动作。",
    note: "只建议在 hook 来源已被自动化流程提前校验时使用。",
  },
  additionalWritableDirs: {
    title: "可写目录",
    summary: "除工作区外，额外允许 Codex 写入的目录。",
    impact: "影响范围：跨目录修改、产物输出和沙箱写权限。",
  },
  images: {
    title: "图片路径",
    summary: "把本地图片作为初始指令附件传给 Codex。",
    impact: "影响范围：视觉理解任务、输入上下文和本地文件读取。",
  },
  configOverrides: {
    title: "配置覆盖",
    summary: "为本次执行追加 Codex CLI 的 --config key=value 覆盖项。",
    impact: "影响范围：单次运行配置、实验参数和高级 CLI 行为。",
  },
  captureDebugArtifacts: {
    title: "保存调试文件",
    summary: "保存本次 Codex 执行的提示词、输出和调试预览。",
    impact: "影响范围：运行历史排查、磁盘占用和敏感信息脱敏后的留存。",
  },
} satisfies Record<string, HelpTopic>

type SelectOptionHelp = {
  value: string
  label: string
  description: string
  happens: string
  bestFor: string
  risk: string
}

const CODEX_MODEL_OPTIONS: ReadonlyArray<{ value: string; label: string; description: string }> = [
  { value: MODEL_INHERIT_VALUE, label: "继承当前 Codex 配置", description: "不传 --model" },
  { value: "gpt-5.5", label: "GPT-5.5", description: "最高能力模型" },
  { value: "gpt-5.4", label: "GPT-5.4", description: "通用高质量模型" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini", description: "轻量模型" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex", description: "Codex 专用模型" },
  { value: "gpt-5-codex", label: "GPT-5 Codex / Spark", description: "Codex Spark" },
]

const CODEX_APPROVAL_OPTIONS: readonly SelectOptionHelp[] = [
  {
    value: "never",
    label: "never",
    description: "不请求人工审批",
    happens: "命令失败会直接返回给 Codex 处理，不弹出人工确认。",
    bestFor: "无人值守工作流、CI 风格任务和可接受自动失败的节点。",
    risk: "任务可能因为缺少权限直接失败，需要从运行历史排查。",
  },
  {
    value: "on-request",
    label: "on-request",
    description: "模型按需请求审批",
    happens: "Codex 判断需要更高权限时才请求人工确认。",
    bestFor: "有人值守的调试运行，或希望保留人工判断的任务。",
    risk: "无人值守运行可能卡在等待确认。",
  },
  {
    value: "untrusted",
    label: "untrusted",
    description: "只自动执行可信命令",
    happens: "只有可信命令会自动执行，其它命令需要审批。",
    bestFor: "对输入或仓库不完全信任，但仍想允许基础读取命令的场景。",
    risk: "复杂任务更容易等待审批或失败。",
  },
]

const CODEX_SANDBOX_OPTIONS: readonly SelectOptionHelp[] = [
  {
    value: "read-only",
    label: "read-only",
    description: "只读沙箱",
    happens: "Codex 可以读取文件，但默认不能写入工作区。",
    bestFor: "审查、分析、总结和不希望改文件的任务。",
    risk: "需要生成或修改文件的任务会失败。",
  },
  {
    value: "workspace-write",
    label: "workspace-write",
    description: "可写工作区",
    happens: "Codex 可以写入当前工作区和额外授权的可写目录。",
    bestFor: "大多数自动化修改、生成文件和常规工作流节点。",
    risk: "会修改项目文件，仍受沙箱边界限制。",
  },
  {
    value: "danger-full-access",
    label: "danger-full-access",
    description: "无沙箱限制",
    happens: "Codex 命令不受文件系统沙箱限制。",
    bestFor: "只适合外部环境已经隔离的专用自动化。",
    risk: "可能访问或修改工作区外文件，风险最高。",
  },
]

export interface CodexNodePanelProps {
  config: CodexNodeConfig
  onChange: (config: CodexNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  validationItems?: readonly WorkflowValidationDisplayItem[]
}

export function CodexNodePanel({
  config,
  onChange,
  upstreamNodes,
  workflowParams,
  projects,
  defaultProjectName,
  validationItems = [],
}: CodexNodePanelProps) {
  const [prompt, setPrompt] = useState(config.prompt)
  const [additionalWritableDirs, setAdditionalWritableDirs] = useState(config.additionalWritableDirs)
  const [images, setImages] = useState(config.images)
  const [configOverrides, setConfigOverrides] = useState(config.configOverrides)
  const lastCommittedRef = useRef<CodexNodeConfig>(config)

  useEffect(() => {
    setPrompt(config.prompt)
    setAdditionalWritableDirs(config.additionalWritableDirs)
    setImages(config.images)
    setConfigOverrides(config.configOverrides)
    lastCommittedRef.current = config
  }, [config])

  const commit = (overrides?: Partial<CodexNodeConfig>) => {
    const next: CodexNodeConfig = {
      ...lastCommittedRef.current,
      prompt,
      additionalWritableDirs,
      images,
      configOverrides,
      ...overrides,
    }
    lastCommittedRef.current = next
    onChange(next)
  }

  const errorFor = (fieldKey: string) => validationItems.find((item) => item.fieldKey === fieldKey)?.summary
  const promptSummary = prompt.length > 0 ? `${prompt.length}字` : undefined
  const variableSummary = config.variables.length > 0 ? `${config.variables.length}个` : undefined

  const updateWritableDirs = (next: string[]) => {
    setAdditionalWritableDirs(next)
    commit({ additionalWritableDirs: next })
  }

  const updateImages = (next: string[]) => {
    setImages(next)
    commit({ images: next })
  }

  const updateConfigOverrides = (next: CodexNodeConfig["configOverrides"]) => {
    setConfigOverrides(next)
    commit({ configOverrides: next })
  }

  const normalizeWritableDirs = () => {
    const next = normalizeStringList(additionalWritableDirs)
    setAdditionalWritableDirs(next)
    commit({ additionalWritableDirs: next })
  }

  const normalizeImages = () => {
    const next = normalizeStringList(images)
    setImages(next)
    commit({ images: next })
  }

  const normalizeOverrides = () => {
    const next = normalizeConfigOverrides(configOverrides)
    setConfigOverrides(next)
    commit({ configOverrides: next })
  }

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="输入映射" summary={variableSummary}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="项目">
        <ProjectSelect
          value={config.projectId}
          onChange={(projectId) => commit({ projectId })}
          projects={projects}
          placeholder={defaultProjectName ? `继承: ${defaultProjectName}` : "继承默认"}
        />
        {errorFor("projectId") ? <p className="text-xs text-destructive">{errorFor("projectId")}</p> : null}
      </CollapsibleSection>

      <CollapsibleSection title="指令" summary={promptSummary}>
        <PromptEditor
          value={prompt}
          onChange={setPrompt}
          onBlur={() => commit({ prompt })}
          variables={config.variables}
          placeholder="输入指令，用 {{变量名}} 引用变量…"
        />
        {errorFor("prompt") ? <p className="text-xs text-destructive">{errorFor("prompt")}</p> : null}
      </CollapsibleSection>

      <CollapsibleSection title="执行配置">
        <div className="grid gap-2">
          <LabeledSelect
            id="codex-approval-policy"
            label="审批策略"
            help={CODEX_FIELD_HELP.approvalPolicy}
            value={config.approvalPolicy}
            onValueChange={(value) => commit({ approvalPolicy: value as CodexApprovalPolicy })}
          >
            {CODEX_APPROVAL_OPTIONS.map(renderHelpSelectItem)}
          </LabeledSelect>

          <LabeledSelect
            id="codex-sandbox"
            label="沙箱"
            help={CODEX_FIELD_HELP.sandbox}
            value={config.sandbox}
            onValueChange={(value) => commit({ sandbox: value as CodexSandbox })}
          >
            {CODEX_SANDBOX_OPTIONS.map(renderHelpSelectItem)}
          </LabeledSelect>

          <ModelSelect
            id="codex-model"
            label="模型"
            help={CODEX_FIELD_HELP.model}
            value={config.model}
            onValueChange={(value) => commit({ model: value })}
          />

          <LabeledInput
            id="codex-profile"
            label="Profile"
            help={CODEX_FIELD_HELP.profile}
            value={config.profile ?? ""}
            onChange={(value) => commit({ profile: value === "" ? undefined : value })}
          />

          <LabeledInput
            id="codex-timeout"
            label="超时分钟"
            help={CODEX_FIELD_HELP.timeoutMins}
            type="number"
            min={1}
            value={config.timeoutMins?.toString() ?? ""}
            onChange={(value) => commit({ timeoutMins: value === "" ? undefined : Number(value) })}
          />

          <BooleanRow
            id="codex-enable-search"
            label="启用搜索"
            help={CODEX_FIELD_HELP.enableSearch}
            checked={config.enableSearch}
            onChange={(checked) => commit({ enableSearch: checked })}
          />

          <LabeledSelect
            id="codex-goals"
            label="Goals"
            help={CODEX_FIELD_HELP.goals}
            value={config.features.goals}
            onValueChange={(value) => commit({
              features: {
                ...lastCommittedRef.current.features,
                goals: value as CodexFeatureState,
              },
            })}
          >
            <SelectItem value="default" className="text-xs">默认</SelectItem>
            <SelectItem value="enabled" className="text-xs">启用</SelectItem>
            <SelectItem value="disabled" className="text-xs">禁用</SelectItem>
          </LabeledSelect>

          <BooleanRow
            id="codex-skip-git-repo-check"
            label="跳过 Git 仓库检查"
            help={CODEX_FIELD_HELP.skipGitRepoCheck}
            checked={config.skipGitRepoCheck}
            onChange={(checked) => commit({ skipGitRepoCheck: checked })}
          />

          <BooleanRow
            id="codex-strict-config"
            label="严格配置"
            help={CODEX_FIELD_HELP.strictConfig}
            checked={config.strictConfig}
            onChange={(checked) => commit({ strictConfig: checked })}
          />

          <BooleanRow
            id="codex-bypass-approvals-and-sandbox"
            label="绕过审批和沙箱"
            help={CODEX_FIELD_HELP.bypassApprovalsAndSandbox}
            checked={config.bypassApprovalsAndSandbox}
            onChange={(checked) => commit({ bypassApprovalsAndSandbox: checked })}
          />

          <BooleanRow
            id="codex-bypass-hook-trust"
            label="绕过 Hook 信任检查"
            help={CODEX_FIELD_HELP.bypassHookTrust}
            checked={config.bypassHookTrust}
            onChange={(checked) => commit({ bypassHookTrust: checked })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="高级参数">
        <div className="grid gap-2">
          <StringListEditor
            label="可写目录"
            help={CODEX_FIELD_HELP.additionalWritableDirs}
            values={additionalWritableDirs}
            addLabel="添加可写目录"
            onChange={updateWritableDirs}
            onBlur={normalizeWritableDirs}
          />

          <StringListEditor
            label="图片路径"
            help={CODEX_FIELD_HELP.images}
            values={images}
            addLabel="添加图片路径"
            onChange={updateImages}
            onBlur={normalizeImages}
          />

          <ConfigOverrideEditor
            help={CODEX_FIELD_HELP.configOverrides}
            values={configOverrides}
            onChange={updateConfigOverrides}
            onBlur={normalizeOverrides}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="调试记录">
        <BooleanRow
          id="codex-capture-debug-artifacts"
          label="保存调试文件"
          help={CODEX_FIELD_HELP.captureDebugArtifacts}
          checked={config.captureDebugArtifacts}
          onChange={(checked) => commit({ captureDebugArtifacts: checked })}
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
}: {
  id: string
  label: string
  help?: HelpTopic
  value: string
  onChange: (value: string) => void
  type?: "text" | "number"
  min?: number
}) {
  return (
    <div className="grid gap-1">
      <LabelRow id={id} label={label} help={help} />
      <Input
        id={id}
        aria-label={label}
        className="h-7 text-xs"
        value={value}
        type={type}
        min={min}
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
  help?: HelpTopic
  value: string
  onValueChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <div className="grid gap-1">
      <LabelRow id={id} label={label} help={help} />
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
  help?: HelpTopic
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
      {help ? <FieldHelpButton topic={help} /> : null}
    </div>
  )
}

function StringListEditor({
  label,
  help,
  values,
  addLabel,
  onChange,
  onBlur,
}: {
  label: string
  help?: HelpTopic
  values: string[]
  addLabel: string
  onChange: (values: string[]) => void
  onBlur: () => void
}) {
  const add = () => onChange([...values, ""])
  const update = (index: number, value: string) => onChange(values.map((item, itemIndex) => itemIndex === index ? value : item))
  const remove = (index: number) => onChange(values.filter((_, itemIndex) => itemIndex !== index))

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <LabelRow label={label} help={help} />
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
            onBlur={onBlur}
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
    </div>
  )
}

function ConfigOverrideEditor({
  help,
  values,
  onChange,
  onBlur,
}: {
  help?: HelpTopic
  values: CodexNodeConfig["configOverrides"]
  onChange: (values: CodexNodeConfig["configOverrides"]) => void
  onBlur: () => void
}) {
  const add = () => onChange([...values, { key: "", value: "" }])
  const update = (index: number, patch: Partial<CodexNodeConfig["configOverrides"][number]>) => {
    onChange(values.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item))
  }
  const remove = (index: number) => onChange(values.filter((_, itemIndex) => itemIndex !== index))

  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <LabelRow label="配置覆盖" help={help} />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          aria-label="添加配置覆盖"
          onClick={add}
        >
          <Plus className="h-3 w-3" />
          添加
        </Button>
      </div>

      {values.map((item, index) => (
        <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_1.75rem] items-center gap-1.5">
          <Input
            aria-label={`配置键 ${index + 1}`}
            className="h-7 text-xs"
            value={item.key}
            onChange={(event) => update(index, { key: event.target.value })}
            onBlur={onBlur}
          />
          <Input
            aria-label={`配置值 ${index + 1}`}
            className="h-7 text-xs"
            value={item.value}
            onChange={(event) => update(index, { value: event.target.value })}
            onBlur={onBlur}
          />
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            className="h-7 w-7"
            aria-label={`删除配置覆盖 ${index + 1}`}
            onClick={() => remove(index)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
    </div>
  )
}

function ModelSelect({
  id,
  label,
  help,
  value,
  onValueChange,
}: {
  id: string
  label: string
  help?: HelpTopic
  value?: string
  onValueChange: (value: string | undefined) => void
}) {
  const knownOption = CODEX_MODEL_OPTIONS.some((option) => option.value === value)
  const selectValue = value && knownOption ? value : value ? value : MODEL_INHERIT_VALUE

  return (
    <LabeledSelect
      id={id}
      label={label}
      help={help}
      value={selectValue}
      onValueChange={(nextValue) => {
        onValueChange(nextValue === MODEL_INHERIT_VALUE ? undefined : nextValue)
      }}
    >
      {CODEX_MODEL_OPTIONS.map((option) => (
        <SelectItem key={option.value} value={option.value} className="text-xs">
          {option.label}
        </SelectItem>
      ))}
      {value && !knownOption ? (
        <SelectItem value={value} className="text-xs">
          当前自定义模型：{value}
        </SelectItem>
      ) : null}
    </LabeledSelect>
  )
}

function renderHelpSelectItem(option: SelectOptionHelp) {
  return (
    <SelectItem key={option.value} value={option.value} className="pr-14 text-xs">
      <HoverCard openDelay={100} closeDelay={100}>
        <HoverCardTrigger asChild>
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <OptionLabel label={option.label} description={option.description} />
            <CircleHelp className="h-3.5 w-3.5" />
          </span>
        </HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-72">
          <div className="grid gap-2 text-xs">
            <div>
              <div className="font-medium">{option.label}</div>
              <div className="text-muted-foreground">{option.description}</div>
            </div>
            <HelpLine label="会发生什么" text={option.happens} />
            <HelpLine label="适合" text={option.bestFor} />
            <HelpLine label="风险" text={option.risk} />
          </div>
        </HoverCardContent>
      </HoverCard>
    </SelectItem>
  )
}

function OptionLabel({ label, description }: { readonly label: string; readonly description: string }) {
  return (
    <span className="grid min-w-0 gap-0.5 text-left">
      <span className="truncate font-medium">{label}</span>
      <span className="truncate text-[11px] text-muted-foreground">{description}</span>
    </span>
  )
}

function LabelRow({ id, label, help }: { readonly id?: string; readonly label: string; readonly help?: HelpTopic }) {
  return (
    <div className="flex items-center gap-1.5">
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {help ? <FieldHelpButton topic={help} /> : null}
    </div>
  )
}

function FieldHelpButton({ topic }: { readonly topic: HelpTopic }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="h-5 w-5"
          aria-label={`查看${topic.title}说明`}
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{topic.title}</DialogTitle>
          <DialogDescription>{topic.summary}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <HelpLine label="影响" text={topic.impact} />
          {topic.note ? <HelpLine label="注意" text={topic.note} /> : null}
        </div>
        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  )
}

function HelpLine({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">{text}</div>
    </div>
  )
}

function normalizeStringList(values: readonly string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function normalizeConfigOverrides(values: CodexNodeConfig["configOverrides"]): CodexNodeConfig["configOverrides"] {
  return values
    .map((item) => ({ key: item.key.trim(), value: item.value }))
    .filter((item) => item.key.length > 0 || item.value.trim().length > 0)
}
