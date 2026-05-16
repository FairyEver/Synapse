import type { UiConfig, Provider } from '../types'
import { PromptEditor } from './prompt-editor'
import { ProviderSettings } from './provider-settings'

interface ConfigFormProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
}

export function ConfigForm({ config, onChange }: ConfigFormProps) {
  const update = <K extends keyof UiConfig>(key: K, value: UiConfig[K]) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="space-y-6">
      <PromptEditor config={config} onChange={onChange} />

      <div className="grid grid-cols-2 gap-4">
        <Field label="工作目录">
          <input
            value={config.workingDirectory}
            onChange={e => update('workingDirectory', e.target.value)}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background font-mono"
          />
        </Field>
        <Field label="Provider">
          <select
            value={config.provider}
            onChange={e => update('provider', e.target.value as Provider)}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="codex">Codex</option>
            <option value="claude-code">Claude Code</option>
          </select>
        </Field>
        <Field label="并发数">
          <input
            type="number"
            min={1}
            max={20}
            value={config.concurrency}
            onChange={e => update('concurrency', Number(e.target.value))}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
        <Field label="间隔 (分钟)">
          <input
            type="number"
            min={1}
            value={config.intervalMinutes}
            onChange={e => update('intervalMinutes', Number(e.target.value))}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
        <Field label="超时 (分钟)">
          <input
            type="number"
            min={1}
            value={config.timeoutMinutes}
            onChange={e => update('timeoutMinutes', Number(e.target.value))}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
        <Field label="保留日志数">
          <input
            type="number"
            min={1}
            value={config.maxLogs}
            onChange={e => update('maxLogs', Number(e.target.value))}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
      </div>

      <ProviderSettings config={config} onChange={onChange} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-sm font-medium text-foreground mb-1 block">{label}</label>
      {children}
    </div>
  )
}
