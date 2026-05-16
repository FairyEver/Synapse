import { useState, useCallback, useEffect } from 'react'
import { Plus, Pencil, Trash2, BookOpen } from 'lucide-react'
import type { UiConfig } from '../types'
import * as api from '../api'
import { cn } from '../lib/utils'

interface PromptEditorProps {
  config: UiConfig
  onChange: (config: UiConfig) => void
}

export function PromptEditor({ config, onChange }: PromptEditorProps) {
  const [guide, setGuide] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createName, setCreateName] = useState('')

  const switchPrompt = useCallback(async (name: string) => {
    const { prompt } = await api.fetchPrompt(name)
    onChange({ ...config, activePromptName: name, prompt })
  }, [config, onChange])

  const handleRename = useCallback(async () => {
    if (!renaming || !newName.trim()) return
    const updated = await api.renamePrompt(renaming, newName.trim())
    onChange(updated)
    setRenaming(null)
    setNewName('')
  }, [renaming, newName, onChange])

  const handleDelete = useCallback(async (name: string) => {
    if (!confirm(`确认删除 prompt "${name}"？`)) return
    const updated = await api.deletePrompt(name)
    onChange(updated)
  }, [onChange])

  const handleCreate = useCallback(async () => {
    if (!createName.trim()) return
    const updated = await api.createPrompt(createName.trim())
    onChange(updated)
    setCreating(false)
    setCreateName('')
  }, [createName, onChange])

  useEffect(() => {
    if (showGuide && !guide) {
      api.fetchGuide().then(g => setGuide(g.content))
    }
  }, [showGuide, guide])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="text-sm font-medium">Prompt</label>
        <select
          value={config.activePromptName}
          onChange={e => switchPrompt(e.target.value)}
          className="border border-input rounded-md px-2 py-1 text-sm bg-background"
        >
          {config.prompts.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="p-1 hover:bg-muted rounded-md"
          title="新建 prompt"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => { setRenaming(config.activePromptName); setNewName(config.activePromptName) }}
          className="p-1 hover:bg-muted rounded-md"
          title="重命名"
        >
          <Pencil className="h-4 w-4" />
        </button>
        {config.prompts.length > 1 && (
          <button
            type="button"
            onClick={() => handleDelete(config.activePromptName)}
            className="p-1 hover:bg-muted rounded-md text-destructive"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowGuide(g => !g)}
          className={cn('p-1 hover:bg-muted rounded-md ml-auto', showGuide && 'bg-muted')}
          title="Prompt 编写指南"
        >
          <BookOpen className="h-4 w-4" />
        </button>
      </div>

      {creating && (
        <div className="flex items-center gap-2">
          <input
            value={createName}
            onChange={e => setCreateName(e.target.value)}
            placeholder="新 prompt 名称"
            className="border border-input rounded-md px-2 py-1 text-sm bg-background flex-1"
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            autoFocus
          />
          <button type="button" onClick={handleCreate} className="text-sm px-2 py-1 bg-primary text-primary-foreground rounded-md">
            创建
          </button>
          <button type="button" onClick={() => setCreating(false)} className="text-sm px-2 py-1">
            取消
          </button>
        </div>
      )}

      {renaming && (
        <div className="flex items-center gap-2">
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            className="border border-input rounded-md px-2 py-1 text-sm bg-background flex-1"
            onKeyDown={e => e.key === 'Enter' && handleRename()}
            autoFocus
          />
          <button type="button" onClick={handleRename} className="text-sm px-2 py-1 bg-primary text-primary-foreground rounded-md">
            确认
          </button>
          <button type="button" onClick={() => setRenaming(null)} className="text-sm px-2 py-1">
            取消
          </button>
        </div>
      )}

      <textarea
        value={config.prompt}
        onChange={e => onChange({ ...config, prompt: e.target.value })}
        rows={12}
        className="w-full border border-input rounded-md px-3 py-2 text-sm bg-background font-mono resize-y"
        placeholder="输入 prompt 内容…"
      />

      {showGuide && guide && (
        <pre className="border border-border rounded-md p-3 text-xs bg-muted overflow-auto max-h-64 whitespace-pre-wrap">
          {guide}
        </pre>
      )}
    </div>
  )
}
