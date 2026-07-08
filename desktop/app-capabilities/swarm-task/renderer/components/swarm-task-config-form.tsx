import { useState } from "react"
import { Check, ChevronDown, FolderOpen } from "lucide-react"

import { Button } from "../../../../src/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../../../src/components/ui/dropdown-menu"
import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../../src/components/ui/field"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../../src/components/ui/hover-card"
import { Input } from "../../../../src/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../../../../src/components/ui/input-group"
import { Separator } from "../../../../src/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../src/components/ui/select"
import { Switch } from "../../../../src/components/ui/switch"
import { Textarea } from "../../../../src/components/ui/textarea"
import type { SynapseProjectConfig } from "../../../../src/types/config"
import type { SwarmTaskConfig } from "../../shared/schema"

type SwarmTaskConfigFormProps = {
  readonly value: SwarmTaskConfig
  readonly projects: readonly SynapseProjectConfig[]
  readonly onChange: (next: SwarmTaskConfig) => void
  readonly onChooseWorkspacePath: () => Promise<string | null>
}

type DescribedOption<T extends string> = {
  readonly value: T
  readonly label: string
  readonly summary: string
  readonly description: string
  readonly bestFor: string
  readonly risk: string
}

const runModeOptions: ReadonlyArray<DescribedOption<SwarmTaskConfig["runMode"]>> = [
  {
    value: "batch",
    label: "批量",
    summary: "按固定轮次启动 worker。",
    description: "按并发数启动一批 worker，完成设定轮次后结束。",
    bestFor: "一次性拆解、评审或生成结果明确的任务。",
    risk: "结束后不会自动补位，需要手动再次运行。",
  },
  {
    value: "continuous",
    label: "持续",
    summary: "持续补位运行。",
    description: "worker 完成后按并发设置持续补位，直到手动停止。",
    bestFor: "持续收集、巡检或长时间推进的任务。",
    risk: "可能持续消耗模型额度，运行前确认目标和停止条件。",
  },
]

const outputModeOptions: ReadonlyArray<DescribedOption<SwarmTaskConfig["output"]["mode"]>> = [
  {
    value: "managed-directory",
    label: "目录",
    summary: "写入 Synapse 管理目录。",
    description: "每次运行生成独立输出目录，便于保留历史结果。",
    bestFor: "多 worker、多轮次、需要回看完整产物的任务。",
    risk: "结果分散在目录中，交付给外部时可能需要整理。",
  },
  {
    value: "target-file",
    label: "文件",
    summary: "写入指定目标文件。",
    description: "worker 输出会按策略写入目标文件。",
    bestFor: "持续维护同一份报告、清单或文档。",
    risk: "需要正确设置目标文件和写入策略，避免覆盖预期内容。",
  },
  {
    value: "both",
    label: "目录 + 文件",
    summary: "保留目录，同时写入目标文件。",
    description: "保存完整输出目录，并同步写入目标文件。",
    bestFor: "既要审计历史，又要维护汇总文件的任务。",
    risk: "同一内容会出现在两个位置，后续整理成本更高。",
  },
]

export function SwarmTaskConfigForm({
  value,
  projects,
  onChange,
  onChooseWorkspacePath,
}: SwarmTaskConfigFormProps) {
  const [choosingWorkspacePath, setChoosingWorkspacePath] = useState(false)
  const selectedProject = projects.find((project) => project.id === value.projectId)
  const projectUnavailable = Boolean(value.projectId) && !selectedProject

  const chooseWorkspacePath = async () => {
    try {
      setChoosingWorkspacePath(true)
      const selectedPath = await onChooseWorkspacePath()
      if (selectedPath) {
        onChange({ ...value, workspacePath: selectedPath })
      }
    } finally {
      setChoosingWorkspacePath(false)
    }
  }

  return (
    <FieldGroup className="mx-auto grid w-full max-w-3xl gap-5 px-3 pb-3 sm:px-5 sm:pb-5">
      <Field className="grid gap-2">
        <FieldLabel>任务目标</FieldLabel>
        <FieldContent>
          <Textarea
            rows={3}
            className="min-h-[calc(3lh+1rem+2px)] resize-y"
            value={value.prompt}
            onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          />
        </FieldContent>
      </Field>

      <div className="grid min-w-0 gap-4 md:grid-cols-2">
        <Field className="grid gap-2">
          <FieldLabel htmlFor="swarm-task-project">项目</FieldLabel>
          <FieldContent>
            <Select
              value={selectedProject?.id ?? ""}
              onValueChange={(projectId) => {
                const project = projects.find((item) => item.id === projectId)
                if (!project) return
                onChange({ ...value, projectId: project.id, workspacePath: project.path })
              }}
            >
              <SelectTrigger id="swarm-task-project" className="w-full" aria-label={selectedProject ? `项目：${selectedProject.name}` : "项目"}>
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
            {projectUnavailable ? (
              <p className="text-xs text-destructive">项目不可用</p>
            ) : null}
            {projects.length === 0 ? (
              <p className="text-xs text-muted-foreground">请先在设置中添加项目</p>
            ) : null}
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel htmlFor="swarm-task-workspace-path">运行目录</FieldLabel>
          <FieldContent>
            <InputGroup>
              <InputGroupInput
                id="swarm-task-workspace-path"
                aria-label="运行目录"
                value={value.workspacePath}
                onChange={(event) => onChange({ ...value, workspacePath: event.target.value })}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupButton
                  type="button"
                  variant="ghost"
                  onClick={() => { void chooseWorkspacePath() }}
                  disabled={choosingWorkspacePath}
                >
                  <FolderOpen />
                  选择目录
                </InputGroupButton>
              </InputGroupAddon>
            </InputGroup>
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>运行模式</FieldLabel>
          <FieldContent>
            <DescribedOptionMenu
              label="运行模式"
              value={value.runMode}
              options={runModeOptions}
              onChange={(runMode) => onChange({ ...value, runMode })}
            />
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>输出</FieldLabel>
          <FieldContent>
            <DescribedOptionMenu
              label="输出"
              value={value.output.mode}
              options={outputModeOptions}
              onChange={(mode) => onChange({
                ...value,
                output: { ...value.output, mode },
              })}
            />
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>并发</FieldLabel>
          <FieldContent>
            <Input
              type="number"
              min={1}
              max={20}
              className="tabular-nums"
              value={String(value.concurrency)}
              onChange={(event) => onChange({ ...value, concurrency: clampNumber(event.target.value, value.concurrency, 1, 20) })}
            />
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>轮次</FieldLabel>
          <FieldContent>
            <Input
              type="number"
              min={1}
              max={500}
              className="tabular-nums"
              value={String(value.maxRounds)}
              onChange={(event) => onChange({ ...value, maxRounds: clampNumber(event.target.value, value.maxRounds, 1, 500) })}
            />
          </FieldContent>
        </Field>
      </div>

      <div className="grid min-w-0 gap-2">
        <div className="text-sm font-medium text-foreground">上下文</div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <SwitchField
            label="最近摘要"
            checked={value.summary.injectRecent}
            onCheckedChange={(checked) => onChange({
              ...value,
              summary: { ...value.summary, injectRecent: checked },
            })}
          />
          <SwitchField
            label="摘要"
            checked={value.summary.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              summary: { ...value.summary, enabled: checked },
            })}
          />
          <SwitchField
            label="交接"
            checked={value.handoff.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              handoff: { enabled: checked },
            })}
          />
          <SwitchField
            label="Git 上下文"
            checked={value.injectOptions.gitContext}
            onCheckedChange={(checked) => onChange({
              ...value,
              injectOptions: { ...value.injectOptions, gitContext: checked },
            })}
          />
        </div>
      </div>
    </FieldGroup>
  )
}

function DescribedOptionMenu<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string
  readonly value: T
  readonly options: ReadonlyArray<DescribedOption<T>>
  readonly onChange: (value: T) => void
}) {
  const selectedOption = options.find((option) => option.value === value) ?? options[0]

  return (
    <DropdownMenu data-track={`swarm-task-${label}-menu`}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full justify-between px-3 font-normal"
          aria-label={`${label}：${selectedOption.label}`}
        >
          <span className="min-w-0 truncate text-left">{selectedOption.label}</span>
          <ChevronDown className="text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={16} forceMount>
        {options.map((option) => (
          <HoverCard key={option.value} openDelay={100} closeDelay={100}>
            <HoverCardTrigger asChild>
              <DropdownMenuItem
                data-option-value={option.value}
                className="items-start gap-2 py-2"
                onSelect={() => onChange(option.value)}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate font-medium">{option.label}</span>
                    {option.value === value ? (
                      <span className="text-xs text-muted-foreground">当前</span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-muted-foreground">{option.summary}</span>
                </span>
                {option.value === value ? <Check className="mt-0.5 text-muted-foreground" /> : null}
              </DropdownMenuItem>
            </HoverCardTrigger>
            <HoverCardContent side="right" align="start" collisionPadding={16} className="w-72">
              <div className="min-w-0">
                <div className="min-w-0 truncate font-medium">{option.label}</div>
                <div className="mt-1 font-mono text-xs text-muted-foreground">{option.value}</div>
              </div>
              <Separator className="my-2" />
              <div className="space-y-2 text-sm">
                <OptionHelpLine label="会发生什么" text={option.description} />
                <OptionHelpLine label="适合" text={option.bestFor} />
                <OptionHelpLine label="风险" text={option.risk} />
              </div>
            </HoverCardContent>
          </HoverCard>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionHelpLine({ label, text }: { readonly label: string; readonly text: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-16 shrink-0 text-xs text-muted-foreground">{label}</div>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">{text}</div>
    </div>
  )
}

function SwitchField({
  label,
  checked,
  onCheckedChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="grid min-h-10 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3">
      <span className="min-w-0 truncate text-sm font-medium leading-snug">{label}</span>
      <div className="flex h-10 items-center justify-center">
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  )
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
