import { FolderOpen } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import { Field, FieldLabel } from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../src/components/ui/tabs"
import type { SynapseTerminalLaunchLayer } from "../../../src/types/terminal"
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
}: {
  readonly value: SynapseTerminalLaunchLayer
  readonly inheritedValue?: SynapseTerminalLaunchLayer
  readonly inheritedLabel: string
  readonly choosingDirectory?: boolean
  readonly onChooseDirectory: () => void
  readonly onRevealEnvironmentValue: (key: string) => Promise<string | null>
  readonly onCopyEnvironmentValue: (key: string, value: string) => Promise<void>
  readonly onChange: (value: SynapseTerminalLaunchLayer) => void
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
    </Tabs>
  )
}
