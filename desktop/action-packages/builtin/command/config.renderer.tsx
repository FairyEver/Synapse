import { Checkbox } from "../../../src/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Textarea } from "../../../src/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import { parseRecordText, stringifyRecordText } from "../../records"
import type { CommandActionConfig } from "./schema"

const SHELL_OPTIONS: Array<{ label: string; value: CommandActionConfig["shell"] }> = [
  { label: "POSIX", value: "posix" },
  { label: "cmd", value: "cmd" },
  { label: "PowerShell", value: "powershell" },
]

const PATH_STRATEGY_OPTIONS: Array<{ label: string; value: "merge" | "replace" }> = [
  { label: "合并", value: "merge" },
  { label: "替换", value: "replace" },
]

export function CommandConfigForm({
  value,
  onChange,
}: {
  readonly value: CommandActionConfig
  readonly onChange: (value: CommandActionConfig) => void
}) {
  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="task-action-command-shell-posix">Shell</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="Shell"
            className="w-full"
            data-track="task-action-command-shell"
            type="single"
            value={value.shell}
            variant="outline"
            onValueChange={(shell) => {
              if (shell) onChange({ ...value, shell: shell as CommandActionConfig["shell"] })
            }}
          >
            {SHELL_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-command-shell-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
      {value.shell === "posix" ? (
        <Field>
          <FieldContent>
            <label htmlFor="task-action-command-posix-login" className="flex items-center gap-2">
              <Checkbox
                id="task-action-command-posix-login"
                checked={value.posixLogin !== false}
                onCheckedChange={(checked) => onChange({ ...value, posixLogin: checked === true })}
              />
              <span className="text-sm">以登录 Shell 执行（-lc）</span>
            </label>
            <FieldDescription>启用后加载 ~/.profile 等配置，获取完整 PATH</FieldDescription>
          </FieldContent>
        </Field>
      ) : null}
      <Field>
        <FieldLabel htmlFor="task-action-command-content">命令</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-content"
            value={value.command}
            onChange={(event) => onChange({ ...value, command: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-env">环境变量</FieldLabel>
        <FieldContent>
          <Textarea
            id="task-action-command-env"
            placeholder={"KEY=value\nANOTHER_KEY=value"}
            rows={3}
            value={stringifyRecordText(value.env)}
            onChange={(event) => onChange({ ...value, env: parseRecordText(event.target.value) })}
          />
          <FieldDescription>每行一个 KEY=value，会与系统允许的环境变量合并</FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-path-strategy">PATH 模式</FieldLabel>
        <FieldContent>
          <ToggleGroup
            aria-label="PATH strategy"
            className="w-full"
            data-track="task-action-command-path-strategy"
            type="single"
            value={value.pathStrategy ?? "merge"}
            variant="outline"
            onValueChange={(strategy) => {
              if (strategy) onChange({ ...value, pathStrategy: strategy as "merge" | "replace" })
            }}
          >
            {PATH_STRATEGY_OPTIONS.map((option) => (
              <ToggleGroupItem
                key={option.value}
                id={`task-action-command-path-strategy-${option.value}`}
                className="flex-1"
                value={option.value}
              >
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <FieldDescription>合并：将 nvm/Homebrew 等路径追加到 PATH；替换：仅使用自定义 PATH</FieldDescription>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="task-action-command-timeout">超时分钟</FieldLabel>
        <FieldContent>
          <Input
            id="task-action-command-timeout"
            type="number"
            min={1}
            value={value.timeoutMins ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                timeoutMins: event.target.value ? Number(event.target.value) : null,
              })
            }
          />
        </FieldContent>
      </Field>
    </FieldGroup>
  )
}
