import { Field, FieldContent, FieldGroup, FieldLabel } from "../../../../src/components/ui/field"
import { Input } from "../../../../src/components/ui/input"
import { NativeSelect, NativeSelectOption } from "../../../../src/components/ui/native-select"
import { Switch } from "../../../../src/components/ui/switch"
import { Textarea } from "../../../../src/components/ui/textarea"
import type { SwarmTaskConfig } from "../../shared/schema"

type SwarmTaskConfigFormProps = {
  readonly value: SwarmTaskConfig
  readonly onChange: (next: SwarmTaskConfig) => void
}

export function SwarmTaskConfigForm({ value, onChange }: SwarmTaskConfigFormProps) {
  return (
    <FieldGroup className="grid gap-4 p-4 sm:p-5">
      <Field className="grid gap-2">
        <FieldLabel>提示词</FieldLabel>
        <FieldContent>
          <Textarea
            rows={10}
            value={value.prompt}
            onChange={(event) => onChange({ ...value, prompt: event.target.value })}
          />
        </FieldContent>
      </Field>

      <div className="grid gap-4 lg:grid-cols-2">
        <Field className="grid gap-2">
          <FieldLabel>项目</FieldLabel>
          <FieldContent>
            <Input
              value={value.projectId}
              onChange={(event) => onChange({ ...value, projectId: event.target.value })}
            />
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>工作目录</FieldLabel>
          <FieldContent>
            <Input
              value={value.workspacePath}
              onChange={(event) => onChange({ ...value, workspacePath: event.target.value })}
            />
          </FieldContent>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
        <Field className="grid gap-2">
          <FieldLabel>运行模式</FieldLabel>
          <FieldContent>
            <NativeSelect
              value={value.runMode}
              onChange={(event) => onChange({ ...value, runMode: event.target.value as SwarmTaskConfig["runMode"] })}
            >
              <NativeSelectOption value="batch">批量</NativeSelectOption>
              <NativeSelectOption value="continuous">持续</NativeSelectOption>
            </NativeSelect>
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>并发</FieldLabel>
          <FieldContent>
            <Input
              type="number"
              min={1}
              max={20}
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
              value={String(value.maxRounds)}
              onChange={(event) => onChange({ ...value, maxRounds: clampNumber(event.target.value, value.maxRounds, 1, 500) })}
            />
          </FieldContent>
        </Field>
        <Field className="grid gap-2">
          <FieldLabel>输出</FieldLabel>
          <FieldContent>
            <NativeSelect
              value={value.output.mode}
              onChange={(event) => onChange({
                ...value,
                output: { ...value.output, mode: event.target.value as SwarmTaskConfig["output"]["mode"] },
              })}
            >
              <NativeSelectOption value="managed-directory">目录</NativeSelectOption>
              <NativeSelectOption value="target-file">文件</NativeSelectOption>
              <NativeSelectOption value="both">目录 + 文件</NativeSelectOption>
            </NativeSelect>
          </FieldContent>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-4">
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
    </FieldGroup>
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
    <Field orientation="horizontal" className="items-center justify-between rounded-md border px-3 py-2">
      <FieldLabel>{label}</FieldLabel>
      <FieldContent>
        <Switch checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </FieldContent>
    </Field>
  )
}

function clampNumber(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}
