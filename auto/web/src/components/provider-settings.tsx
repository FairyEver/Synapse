import type { UiConfig, CodexConfig, ClaudeCodeConfig, SandboxMode, ApprovalPolicy } from '../types'

interface ProviderSettingsProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
}

export function ProviderSettings({ config, onChange }: ProviderSettingsProps) {
  if (config.provider === 'codex') {
    const codex = config.codex
    const update = <K extends keyof CodexConfig>(key: K, value: CodexConfig[K]) => {
      onChange({ ...config, codex: { ...codex, [key]: value } })
    }
    return (
      <fieldset className="border border-border rounded-md p-4 space-y-3">
        <legend className="text-sm font-medium px-2">Codex 设置</legend>
        <div className="grid grid-cols-2 gap-4">
          <Field label="命令">
            <input
              value={codex.command}
              onChange={e => update('command', e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background font-mono"
            />
          </Field>
          <Field label="模型">
            <input
              value={codex.model}
              onChange={e => update('model', e.target.value)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
            />
          </Field>
          <Field label="沙箱模式">
            <select
              value={codex.sandbox}
              onChange={e => update('sandbox', e.target.value as SandboxMode)}
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
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
              className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
            >
              <option value="untrusted">untrusted</option>
              <option value="on-failure">on-failure</option>
              <option value="on-request">on-request</option>
              <option value="never">never</option>
            </select>
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={codex.json}
            onChange={e => update('json', e.target.checked)}
          />
          JSON 输出
        </label>
      </fieldset>
    )
  }

  const cc = config.claudeCode
  const update = <K extends keyof ClaudeCodeConfig>(key: K, value: ClaudeCodeConfig[K]) => {
    onChange({ ...config, claudeCode: { ...cc, [key]: value } })
  }

  return (
    <fieldset className="border border-border rounded-md p-4 space-y-3">
      <legend className="text-sm font-medium px-2">Claude Code 设置</legend>
      <div className="grid grid-cols-2 gap-4">
        <Field label="命令">
          <input
            value={cc.command}
            onChange={e => update('command', e.target.value)}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background font-mono"
          />
        </Field>
        <Field label="模型">
          <input
            value={cc.model}
            onChange={e => update('model', e.target.value)}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
        <Field label="输出格式">
          <select
            value={cc.outputFormat}
            onChange={e => update('outputFormat', e.target.value as ClaudeCodeConfig['outputFormat'])}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          >
            <option value="json">json</option>
            <option value="stream-json">stream-json</option>
            <option value="text">text</option>
          </select>
        </Field>
        <Field label="最大轮次">
          <input
            type="number"
            min={1}
            value={cc.maxTurns}
            onChange={e => update('maxTurns', Number(e.target.value))}
            className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background"
          />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={cc.dangerouslySkipPermissions}
          onChange={e => update('dangerouslySkipPermissions', e.target.checked)}
        />
        跳过权限确认
      </label>
      <Field label="System Prompt">
        <textarea
          value={cc.systemPrompt}
          onChange={e => update('systemPrompt', e.target.value)}
          rows={3}
          className="w-full border border-input rounded-md px-2 py-1.5 text-sm bg-background font-mono resize-y"
        />
      </Field>
    </fieldset>
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
