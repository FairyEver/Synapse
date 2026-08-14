import type { UiConfig, Provider } from '../types'
import { PromptEditor } from './prompt-editor'
import { ProviderSettings } from './provider-settings'

interface ConfigFormProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
}

const CONCURRENCY_OPTIONS = Array.from({ length: 20 }, (_, index) => index + 1)
const TIMEOUT_OPTIONS = [5, 10, 15, 20, 30, 45, 60, 90, 120]
const MAX_LOGS_OPTIONS = [10, 20, 30, 50, 100, 200]

export function ConfigForm({ config, onChange }: ConfigFormProps) {
  const update = <K extends keyof UiConfig>(key: K, value: UiConfig[K]) => {
    onChange({ ...config, [key]: value })
  }

  return (
    <div className="space-y-8">
      <Section title="Prompt">
        <PromptEditor config={config} onChange={onChange} />
      </Section>

      <Section title="运行配置">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Field label="Provider">
            <select
              value={config.provider}
              onChange={e => update('provider', e.target.value as Provider)}
              className="select-field"
            >
              <option value="codex">Codex</option>
              <option value="claude-code">Claude Code</option>
            </select>
          </Field>
          <Field label="并发数">
            <select
              value={config.concurrency}
              onChange={e => update('concurrency', Number(e.target.value))}
              className="select-field"
            >
              {CONCURRENCY_OPTIONS.map(n => (
                <option key={n} value={n}>{n} worker{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="超时时间">
            <select
              value={config.timeoutMinutes}
              onChange={e => update('timeoutMinutes', Number(e.target.value))}
              className="select-field"
            >
              {TIMEOUT_OPTIONS.map(n => (
                <option key={n} value={n}>{n} 分钟</option>
              ))}
            </select>
          </Field>
          <Field label="保留日志" className="col-span-1">
            <select
              value={config.maxLogs}
              onChange={e => update('maxLogs', Number(e.target.value))}
              className="select-field"
            >
              {MAX_LOGS_OPTIONS.map(n => (
                <option key={n} value={n}>最近 {n} 次</option>
              ))}
            </select>
          </Field>
          <Field label="工作目录" className="col-span-2">
            <input
              value={config.workingDirectory}
              onChange={e => update('workingDirectory', e.target.value)}
              className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background font-mono"
            />
          </Field>
        </div>
      </Section>

      <Section title={config.provider === 'codex' ? 'Codex 设置' : 'Claude Code 设置'}>
        <ProviderSettings config={config} onChange={onChange} />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-sm font-semibold text-foreground mb-3 pb-2 border-b border-border">
        {title}
      </h2>
      {children}
    </section>
  )
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-muted-foreground mb-1.5 block">{label}</label>
      {children}
    </div>
  )
}
