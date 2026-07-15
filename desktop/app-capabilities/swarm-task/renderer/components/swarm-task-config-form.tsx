import type { ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"

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
import { Separator } from "../../../../src/components/ui/separator"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../../src/components/ui/select"
import { Switch } from "../../../../src/components/ui/switch"
import { Textarea } from "../../../../src/components/ui/textarea"
import type { SynapseProjectConfig } from "../../../../src/types/config"
import { isSwarmFileWritePathAllowed, type SwarmTaskConfig } from "../../shared/schema"

type SwarmTaskConfigFormProps = {
  readonly value: SwarmTaskConfig
  readonly projects: readonly SynapseProjectConfig[]
  readonly onChange: (next: SwarmTaskConfig) => void
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
    label: "分批运行",
    summary: "整批完成后启动下一批。",
    description: "每批启动并发上限数量的 worker，整批结束后再进入下一批。",
    bestFor: "一次性拆解、评审或生成结果明确的任务。",
    risk: "慢 worker 会拖住下一批启动。",
  },
  {
    value: "continuous",
    label: "补位运行",
    summary: "完成后补位。",
    description: "每个槽位完成一轮后立即进入下一轮，不等待其它槽位。",
    bestFor: "持续收集、巡检或长时间推进的任务。",
    risk: "快槽位会先推进到下一轮。",
  },
]

export function SwarmTaskConfigForm({
  value,
  projects,
  onChange,
}: SwarmTaskConfigFormProps) {
  const selectedProject = projects.find((project) => project.id === value.projectId)
  const projectUnavailable = Boolean(value.projectId) && !selectedProject
  const fileWritePath = value.promptInjection.fileWrite.path.trim()
  const fileWritePathInvalid = value.promptInjection.fileWrite.enabled
    && Boolean(fileWritePath)
    && !isSwarmFileWritePathAllowed(fileWritePath)
  const roundLabel = value.runMode === "batch" ? "批次数" : "每槽轮次"
  const runPlanDescription = formatRunPlanDescription(value)

  return (
    <FieldGroup className="mx-auto grid w-full max-w-3xl gap-6 px-3 pb-3 sm:px-5 sm:pb-5">
      <ConfigSection title="任务">
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
        <Field className="grid gap-2">
          <FieldLabel htmlFor="swarm-task-project">项目</FieldLabel>
          <FieldContent>
            <Select
              value={selectedProject?.id ?? ""}
              onValueChange={(projectId) => {
                const project = projects.find((item) => item.id === projectId)
                if (!project) return
                onChange({ ...value, projectId: project.id })
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
      </ConfigSection>

      <ConfigSection title="运行">
        <div className="grid min-w-0 gap-4 md:grid-cols-3">
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
            <FieldLabel>并发上限</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                min={1}
                max={20}
                className="tabular-nums"
                aria-label="并发上限"
                value={String(value.concurrency)}
                onChange={(event) => onChange({ ...value, concurrency: clampNumber(event.target.value, value.concurrency, 1, 20) })}
              />
            </FieldContent>
          </Field>
          <Field className="grid gap-2">
            <FieldLabel>{roundLabel}</FieldLabel>
            <FieldContent>
              <Input
                type="number"
                min={1}
                max={500}
                className="tabular-nums"
                aria-label={roundLabel}
                value={String(value.maxRounds)}
                onChange={(event) => onChange({ ...value, maxRounds: clampNumber(event.target.value, value.maxRounds, 1, 500) })}
              />
            </FieldContent>
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">
          {runPlanDescription}
        </p>
      </ConfigSection>

      <ConfigSection title="注入">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <SwitchField
            label="序列和批次"
            checked={value.promptInjection.sequenceBatch.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                sequenceBatch: { enabled: checked },
              },
            })}
          />
          <SwitchField
            label="上一轮交接"
            checked={value.promptInjection.previousHandoff.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                previousHandoff: { enabled: checked },
              },
            })}
          />
          <SwitchField
            label="记录摘要"
            checked={value.promptInjection.summary.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                summary: {
                  ...value.promptInjection.summary,
                  enabled: checked,
                  injectRecent: checked ? value.promptInjection.summary.injectRecent : false,
                },
              },
            })}
          />
          <SwitchField
            label="最近摘要"
            checked={value.promptInjection.summary.injectRecent}
            disabled={!value.promptInjection.summary.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                summary: { ...value.promptInjection.summary, injectRecent: checked },
              },
            })}
          />
        </div>
        {value.promptInjection.previousHandoff.enabled ? (
          <p className="text-xs text-muted-foreground">每个 worker 最多注入 64 KiB 交接上下文，超出会截断。</p>
        ) : null}
        <Field className="grid gap-2">
          <FieldLabel htmlFor="swarm-task-custom-appendix">附加提示词</FieldLabel>
          <FieldContent>
            <Textarea
              id="swarm-task-custom-appendix"
              rows={3}
              className="min-h-[calc(3lh+1rem+2px)] resize-y"
              value={value.promptInjection.customAppendix}
              onChange={(event) => onChange({
                ...value,
                promptInjection: {
                  ...value.promptInjection,
                  customAppendix: event.target.value,
                },
              })}
            />
          </FieldContent>
        </Field>
      </ConfigSection>

      <ConfigSection
        title="文件"
        action={
          <SectionSwitch
            id="swarm-task-file-write-enabled"
            label="文件写入"
            checked={value.promptInjection.fileWrite.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                fileWrite: {
                  ...value.promptInjection.fileWrite,
                  enabled: checked,
                },
              },
            })}
          />
        }
      >
        {value.promptInjection.fileWrite.enabled ? (
          <div className="grid min-w-0 gap-4">
            <Field className="grid gap-2">
              <FieldLabel htmlFor="swarm-task-file-write-path">文件路径</FieldLabel>
              <FieldContent>
                <Input
                  id="swarm-task-file-write-path"
                  aria-label="文件路径"
                  aria-invalid={fileWritePathInvalid}
                  value={value.promptInjection.fileWrite.path}
                  onChange={(event) => onChange({
                    ...value,
                    promptInjection: {
                      ...value.promptInjection,
                      fileWrite: {
                        ...value.promptInjection.fileWrite,
                        path: event.target.value,
                      },
                    },
                  })}
                />
                <p className="text-xs text-muted-foreground">项目相对路径</p>
                {fileWritePathInvalid ? (
                  <p className="text-xs text-destructive">请输入不含 .. 的项目相对路径</p>
                ) : null}
              </FieldContent>
            </Field>
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <Field className="grid gap-2">
                <FieldLabel>写入方式</FieldLabel>
                <FieldContent>
                  <Select
                    value={value.promptInjection.fileWrite.mode}
                    onValueChange={(mode) => onChange({
                      ...value,
                      promptInjection: {
                        ...value.promptInjection,
                        fileWrite: {
                          ...value.promptInjection.fileWrite,
                          mode: mode as SwarmTaskConfig["promptInjection"]["fileWrite"]["mode"],
                        },
                      },
                    })}
                  >
                    <SelectTrigger className="w-full" aria-label="写入方式">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="append-only">只追加</SelectItem>
                      <SelectItem value="update">允许更新</SelectItem>
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>
              <Field className="grid gap-2">
                <FieldLabel htmlFor="swarm-task-file-write-lock">文件锁</FieldLabel>
                <FieldContent>
                  <div className="flex h-9 items-center">
                    <Switch
                      id="swarm-task-file-write-lock"
                      checked={value.promptInjection.fileWrite.lock.enabled}
                      onCheckedChange={(checked) => onChange({
                        ...value,
                        promptInjection: {
                          ...value.promptInjection,
                          fileWrite: {
                            ...value.promptInjection.fileWrite,
                            lock: { enabled: checked },
                          },
                        },
                      })}
                      aria-label="文件锁"
                    />
                  </div>
                </FieldContent>
              </Field>
            </div>
          </div>
        ) : null}
      </ConfigSection>
    </FieldGroup>
  )
}

function ConfigSection({
  title,
  action,
  children,
}: {
  readonly title: string
  readonly action?: ReactNode
  readonly children: ReactNode
}) {
  return (
    <section className="grid gap-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {action}
      </div>
      {children ? <div className="grid min-w-0 gap-4">{children}</div> : null}
    </section>
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
          className="w-full justify-between font-normal"
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

function formatRunPlanDescription(config: SwarmTaskConfig): string {
  const plannedWorkerCount = config.concurrency * config.maxRounds
  if (config.runMode === "continuous") {
    return `补位运行会保持 ${config.concurrency} 个 worker 槽位并发；某个槽位完成后立即补下一轮，每槽最多执行 ${config.maxRounds} 轮，最多启动 ${plannedWorkerCount} 个 worker。`
  }
  return `分批运行会每批同时启动 ${config.concurrency} 个 worker，等待本批全部结束后进入下一批，共执行 ${config.maxRounds} 批，最多启动 ${plannedWorkerCount} 个 worker。`
}

function SwitchField({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="grid min-h-10 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 data-[disabled=true]:opacity-60" data-disabled={disabled}>
      <span className="min-w-0 truncate text-sm font-medium leading-snug">{label}</span>
      <div className="flex h-10 items-center justify-center">
        <Switch disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  )
}

function SectionSwitch({
  id,
  label,
  checked,
  onCheckedChange,
}: {
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex min-h-10 shrink-0 items-center gap-2">
      <FieldLabel htmlFor={id} className="text-sm font-medium">
        {label}
      </FieldLabel>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
    </div>
  )
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
