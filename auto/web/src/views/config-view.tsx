import { Play } from 'lucide-react'
import type { UiConfig } from '../types'
import { ConfigForm } from '../components/config-form'

interface ConfigViewProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
  onStart: () => void
}

export function ConfigView({ config, onChange, onStart }: ConfigViewProps) {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <ConfigForm config={config} onChange={onChange} />
      <button
        type="button"
        onClick={onStart}
        className="w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-md py-2 px-4 text-sm font-medium hover:opacity-90 transition-opacity"
      >
        <Play className="h-4 w-4" />
        开始运行
      </button>
    </div>
  )
}
