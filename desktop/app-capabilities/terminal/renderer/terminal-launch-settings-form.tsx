import { FolderOpen } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import { Field, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { NativeSelect, NativeSelectOption } from "../../../src/components/ui/native-select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../src/components/ui/tabs"
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
            <FieldLabel htmlFor="terminal-appearance-size">字号</FieldLabel>
            <NativeSelect
              id="terminal-appearance-size"
              aria-label="字号"
              data-track="terminal-appearance-size"
              value={appearanceSize}
              onChange={(event) => onAppearanceSizeChange(event.target.value as TerminalAppearanceSize)}
            >
              <NativeSelectOption value="small">小</NativeSelectOption>
              <NativeSelectOption value="medium">中</NativeSelectOption>
              <NativeSelectOption value="large">大</NativeSelectOption>
            </NativeSelect>
          </Field>
        </TabsContent>
      ) : null}
    </Tabs>
  )
}
