import { FolderOpen } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import { Field, FieldContent, FieldDescription, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../src/components/ui/tabs"
import { Switch } from "../../../src/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { SynapseTerminalLaunchLayer } from "../../../src/types/terminal"
import type { TerminalAppearanceSize } from "./terminal-appearance"
import { TerminalEnvironmentEditor } from "./terminal-environment-editor"
import { TerminalShellCombobox } from "./terminal-shell-combobox"

export function TerminalLaunchSettingsForm({
  value,
  inheritedValue,
  inheritedLabel,
  choosingDirectory,
  onChooseDirectory,
  onRevealEnvironmentValue,
  onCopyEnvironmentValue,
  onChange,
  appearanceSize,
  onAppearanceSizeChange,
  agentNotificationsEnabled,
  onAgentNotificationsEnabledChange,
}: {
  readonly value: SynapseTerminalLaunchLayer
  readonly inheritedValue?: SynapseTerminalLaunchLayer
  readonly inheritedLabel: string
  readonly choosingDirectory?: boolean
  readonly onChooseDirectory: () => void
  readonly onRevealEnvironmentValue: (key: string) => Promise<string | null>
  readonly onCopyEnvironmentValue: (key: string, value: string) => Promise<void>
  readonly onChange: (value: SynapseTerminalLaunchLayer) => void
  readonly appearanceSize?: TerminalAppearanceSize
  readonly onAppearanceSizeChange?: (size: TerminalAppearanceSize) => void
  readonly agentNotificationsEnabled?: boolean
  readonly onAgentNotificationsEnabledChange?: (enabled: boolean) => void
}) {
  const update = <K extends keyof SynapseTerminalLaunchLayer>(key: K, next: SynapseTerminalLaunchLayer[K]) => {
    const result = { ...value }
    if (next === undefined || next === "") delete result[key]
    else result[key] = next
    onChange(result)
  }

  return (
    <Tabs defaultValue="general" className="min-h-0">
      <TabsList>
        <TabsTrigger value="general">常规</TabsTrigger>
        <TabsTrigger value="environment">环境变量</TabsTrigger>
        {appearanceSize && onAppearanceSizeChange ? <TabsTrigger value="appearance">外观</TabsTrigger> : null}
        {agentNotificationsEnabled !== undefined && onAgentNotificationsEnabledChange
          ? <TabsTrigger value="notifications">通知</TabsTrigger>
          : null}
      </TabsList>
      <TabsContent value="general" className="grid gap-4 pt-3">
        <Field>
          <FieldLabel>Shell</FieldLabel>
          <TerminalShellCombobox value={value.shell} inheritedValue={inheritedValue?.shell} onChange={(shell) => update("shell", shell)} />
        </Field>
        <Field>
          <FieldLabel htmlFor="terminal-launch-cwd">工作目录</FieldLabel>
          <div className="flex gap-2 max-sm:flex-col">
            <Input
              id="terminal-launch-cwd"
              aria-label="工作目录"
              value={value.defaultCwd ?? ""}
              placeholder={inheritedValue?.defaultCwd ? `继承：${inheritedValue.defaultCwd}` : "继承系统默认"}
              onChange={(event) => update("defaultCwd", event.target.value || undefined)}
            />
            <Button type="button" variant="outline" disabled={choosingDirectory} onClick={onChooseDirectory}>
              <FolderOpen data-icon="inline-start" />
              选择
            </Button>
          </div>
        </Field>
      </TabsContent>
      <TabsContent value="environment" className="pt-3">
        <TerminalEnvironmentEditor
          value={value.environment}
          inheritedValue={inheritedValue?.environment}
          inheritedLabel={inheritedLabel}
          onRevealValue={onRevealEnvironmentValue}
          onCopyValue={onCopyEnvironmentValue}
          onChange={(environment) => update("environment", environment)}
        />
      </TabsContent>
      {appearanceSize && onAppearanceSizeChange ? (
        <TabsContent value="appearance" className="pt-3">
          <Field orientation="horizontal">
            <FieldLabel>字号</FieldLabel>
            <ToggleGroup
              type="single"
              variant="outline"
              aria-label="字号"
              data-track="terminal-appearance-size"
              value={appearanceSize}
              onValueChange={(size) => {
                if (size) onAppearanceSizeChange(size as TerminalAppearanceSize)
              }}
            >
              <ToggleGroupItem value="small">小</ToggleGroupItem>
              <ToggleGroupItem value="medium">中</ToggleGroupItem>
              <ToggleGroupItem value="large">大</ToggleGroupItem>
            </ToggleGroup>
          </Field>
        </TabsContent>
      ) : null}
      {agentNotificationsEnabled !== undefined && onAgentNotificationsEnabledChange ? (
        <TabsContent value="notifications" className="pt-3">
          <Field orientation="horizontal" className="items-start justify-between gap-4">
            <FieldContent>
              <FieldLabel htmlFor="terminal-agent-notifications">Agent 原生通知</FieldLabel>
              <FieldDescription>
                仅对新建终端生效。Codex 首次使用需在 /hooks 中信任 Synapse Hook。
              </FieldDescription>
            </FieldContent>
            <Switch
              id="terminal-agent-notifications"
              data-track="terminal-agent-notifications"
              checked={agentNotificationsEnabled}
              onCheckedChange={onAgentNotificationsEnabledChange}
            />
          </Field>
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
