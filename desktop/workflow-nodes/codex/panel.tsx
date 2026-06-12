import { useEffect, useRef, useState, type ReactNode } from "react"
import { Plus, Trash2 } from "lucide-react"
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
  CodexApprovalPolicy,
  CodexFeatureState,
  CodexNodeConfig,
  CodexSandbox,
} from "./schema"

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
            value={config.approvalPolicy}
            onValueChange={(value) => commit({ approvalPolicy: value as CodexApprovalPolicy })}
          >
            <SelectItem value="never" className="text-xs">never</SelectItem>
            <SelectItem value="on-request" className="text-xs">on-request</SelectItem>
            <SelectItem value="untrusted" className="text-xs">untrusted</SelectItem>
          </LabeledSelect>

          <LabeledSelect
            id="codex-sandbox"
            label="沙箱"
            value={config.sandbox}
            onValueChange={(value) => commit({ sandbox: value as CodexSandbox })}
          >
            <SelectItem value="read-only" className="text-xs">read-only</SelectItem>
            <SelectItem value="workspace-write" className="text-xs">workspace-write</SelectItem>
            <SelectItem value="danger-full-access" className="text-xs">danger-full-access</SelectItem>
          </LabeledSelect>

          <LabeledInput
            id="codex-model"
            label="模型"
            value={config.model ?? ""}
            onChange={(value) => commit({ model: value === "" ? undefined : value })}
          />

          <LabeledInput
            id="codex-profile"
            label="Profile"
            value={config.profile ?? ""}
            onChange={(value) => commit({ profile: value === "" ? undefined : value })}
          />

          <LabeledInput
            id="codex-timeout"
            label="超时分钟"
            type="number"
            min={1}
            value={config.timeoutMins?.toString() ?? ""}
            onChange={(value) => commit({ timeoutMins: value === "" ? undefined : Number(value) })}
          />

          <BooleanRow
            id="codex-enable-search"
            label="启用搜索"
            checked={config.enableSearch}
            onChange={(checked) => commit({ enableSearch: checked })}
          />

          <LabeledSelect
            id="codex-goals"
            label="Goals"
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
            checked={config.skipGitRepoCheck}
            onChange={(checked) => commit({ skipGitRepoCheck: checked })}
          />

          <BooleanRow
            id="codex-strict-config"
            label="严格配置"
            checked={config.strictConfig}
            onChange={(checked) => commit({ strictConfig: checked })}
          />

          <BooleanRow
            id="codex-bypass-approvals-and-sandbox"
            label="绕过审批和沙箱"
            checked={config.bypassApprovalsAndSandbox}
            onChange={(checked) => commit({ bypassApprovalsAndSandbox: checked })}
          />

          <BooleanRow
            id="codex-bypass-hook-trust"
            label="绕过 Hook 信任检查"
            checked={config.bypassHookTrust}
            onChange={(checked) => commit({ bypassHookTrust: checked })}
          />
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="高级参数">
        <div className="grid gap-2">
          <StringListEditor
            label="可写目录"
            values={additionalWritableDirs}
            addLabel="添加可写目录"
            onChange={updateWritableDirs}
            onBlur={normalizeWritableDirs}
          />

          <StringListEditor
            label="图片路径"
            values={images}
            addLabel="添加图片路径"
            onChange={updateImages}
            onBlur={normalizeImages}
          />

          <ConfigOverrideEditor
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
  value,
  onChange,
  type,
  min,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  type?: "text" | "number"
  min?: number
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

function StringListEditor({
  label,
  values,
  addLabel,
  onChange,
  onBlur,
}: {
  label: string
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
  values,
  onChange,
  onBlur,
}: {
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
        <Label className="text-xs">配置覆盖</Label>
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
