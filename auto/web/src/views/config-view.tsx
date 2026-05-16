import { useState } from 'react'
import { Play, Save } from 'lucide-react'
import type { UiConfig } from '../types'
import { ConfigForm } from '../components/config-form'

interface ConfigViewProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
  onSave: () => Promise<void>
  onStart: () => void
}

export function ConfigView({ config, onChange, onSave, onStart }: ConfigViewProps) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfigForm config={config} onChange={onChange} />
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex-1 flex items-center justify-center gap-2 border border-border rounded-md py-2 px-4 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {saved ? '已保存 ✓' : saving ? '保存中…' : '保存配置'}
        </button>
        <button
          type="button"
          onClick={onStart}
          className="flex-1 flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 px-4 text-sm font-medium hover:opacity-90 transition-opacity"
        >
          <Play className="h-4 w-4" />
          保存并运行
        </button>
      </div>
    </div>
  )
}
