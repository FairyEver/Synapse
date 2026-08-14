import type { UiConfig, CodexConfig, ClaudeCodeConfig, SandboxMode, ApprovalPolicy } from '../types'

interface ProviderSettingsProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
}

const CODEX_MODELS = [
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-5.6-luna',
  'gpt-5.5',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o3',
  'o4-mini',
  'codex-mini-latest',
]
const CLAUDE_MODELS = ['sonnet', 'opus', 'haiku', 'claude-sonnet-4-20250514', 'claude-opus-4-20250514']
const MAX_TURNS_OPTIONS = [10, 20, 30, 50, 75, 100, 150, 200]

export function ProviderSettings({ config, onChange }: ProviderSettingsProps) {
  if (config.provider === 'codex') {
    const codex = config.codex
    const update = <K extends keyof CodexConfig>(key: K, value: CodexConfig[K]) => {
      onChange({ ...config, codex: { ...codex, [key]: value } })
    }
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Field label="模型">
          <select
            value={codex.model}
            onChange={e => update('model', e.target.value)}
            className="select-field"
          >
            {CODEX_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="沙箱模式">
          <select
            value={codex.sandbox}
            onChange={e => update('sandbox', e.target.value as SandboxMode)}
            className="select-field"
          >
            <option value="read-only">read-only</option>
            <option value="workspace-write">workspace-write</option>
            <option value="danger-full-access">danger-full-access</option>
          </select>
        </Field>
        <Field label="审批策略">
          <select
            value={codex.approvalPolicy}
            onChange={e => update('approvalPolicy', e.target.value as ApprovalPolicy)}
            className="select-field"
          >
            <option value="never">never (自动执行)</option>
            <option value="on-failure">on-failure</option>
            <option value="on-request">on-request</option>
            <option value="untrusted">untrusted</option>
          </select>
        </Field>
        <Field label="命令路径">
          <input
            value={codex.command}
            onChange={e => update('command', e.target.value)}
            className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background font-mono"
          />
        </Field>
        <div className="col-span-2 flex items-center gap-2 pt-1">
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={codex.json}
              onChange={e => update('json', e.target.checked)}
              className="rounded border-input"
            />
            JSON 输出
          </label>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              checked={codex.disableMcp ?? true}
              onChange={e => update('disableMcp', e.target.checked)}
              className="rounded border-input"
            />
            禁用 MCP
          </label>
        </div>
      </div>
    )
  }

  const cc = config.claudeCode
  const update = <K extends keyof ClaudeCodeConfig>(key: K, value: ClaudeCodeConfig[K]) => {
    onChange({ ...config, claudeCode: { ...cc, [key]: value } })
  }

  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
      <Field label="模型">
        <select
          value={cc.model}
          onChange={e => update('model', e.target.value)}
          className="select-field"
        >
          {CLAUDE_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </Field>
      <Field label="最大轮次">
        <select
          value={cc.maxTurns}
          onChange={e => update('maxTurns', Number(e.target.value))}
          className="select-field"
        >
          {MAX_TURNS_OPTIONS.map(n => <option key={n} value={n}>{n} 轮</option>)}
        </select>
      </Field>
      <Field label="命令路径">
        <input
          value={cc.command}
          onChange={e => update('command', e.target.value)}
          className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background font-mono"
        />
      </Field>
      <div className="col-span-2 flex items-center gap-2 pt-1">
        <label className="flex items-center gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={cc.dangerouslySkipPermissions}
            onChange={e => update('dangerouslySkipPermissions', e.target.checked)}
            className="rounded border-input"
          />
          跳过权限确认
        </label>
      </div>
      <Field label="System Prompt" className="col-span-2">
        <textarea
          value={cc.systemPrompt}
          onChange={e => update('systemPrompt', e.target.value)}
          rows={3}
          placeholder="留空使用默认"
          className="w-full border border-input rounded-md px-2.5 py-1.5 text-sm bg-background font-mono resize-y"
        />
      </Field>
    </div>
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
