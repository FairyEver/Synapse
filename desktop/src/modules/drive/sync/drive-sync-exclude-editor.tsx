import { useState } from "react"
import type { DriveSyncBindingDto } from "@synapse/shared"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

/**
 * 同步范围管理。推荐规则可勾选、自定义规则可增删、导入的 .gitignore 只读展示。
 * 强制项不提供任何开启入口。
 *
 * 保存时必须把三个规则组一起交回服务端，漏传任何一组等于清空那一组。
 */
export function DriveSyncExcludeEditor({
  binding,
  candidates,
  readOnly,
  pending,
  onCancel,
  onSave,
}: {
  readonly binding: DriveSyncBindingDto
  /** 推荐规则的完整候选集，来自预览结果，不在渲染层另立一份。 */
  readonly candidates: readonly string[]
  readonly readOnly: boolean
  readonly pending: boolean
  readonly onCancel: () => void
  readonly onSave: (rules: {
    defaults: readonly string[]
    importedGitignore: readonly string[]
    user: readonly string[]
  }) => void
}) {
  const [defaults, setDefaults] = useState<ReadonlySet<string>>(() => new Set(binding.excludeRules.defaults))
  const [user, setUser] = useState<readonly string[]>(binding.excludeRules.user)
  const [draft, setDraft] = useState("")
  const options = Array.from(new Set([...candidates, ...binding.excludeRules.defaults]))

  const addRule = () => {
    const value = draft.trim()
    if (!value || user.includes(value)) return
    setUser([...user, value])
    setDraft("")
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <Label>始终排除</Label>
        <div className="flex flex-wrap gap-1.5">
          {binding.excludeRules.forced.map((rule) => (
            <span key={rule} className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{rule}</span>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">这些内容始终不参与同步，无法更改。</p>
      </div>

      <div className="grid gap-2">
        <Label>推荐排除</Label>
        {options.length === 0 ? (
          <p className="text-sm text-muted-foreground">没有可选的推荐规则。</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {options.map((rule) => (
              <label key={rule} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={defaults.has(rule)}
                  disabled={readOnly}
                  onCheckedChange={(checked) => {
                    const next = new Set(defaults)
                    if (checked === true) next.add(rule)
                    else next.delete(rule)
                    setDefaults(next)
                  }}
                />
                <span className="truncate font-mono text-xs">{rule}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-2">
        <Label>自定义</Label>
        {user.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {user.map((rule) => (
              <span key={rule} className="flex items-center gap-1 rounded-md border px-2 py-1 font-mono text-xs">
                {rule}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`移除规则 ${rule}`}
                  disabled={readOnly}
                  onClick={() => setUser(user.filter((item) => item !== rule))}
                >
                  ×
                </Button>
              </span>
            ))}
          </div>
        ) : <p className="text-sm text-muted-foreground">还没有自定义规则。</p>}
        <div className="flex gap-2">
          <Input
            value={draft}
            placeholder="例如 *.psd 或 素材/大文件"
            disabled={readOnly}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return
              event.preventDefault()
              addRule()
            }}
          />
          <Button type="button" variant="outline" disabled={readOnly || draft.trim().length === 0} onClick={addRule}>
            添加
          </Button>
        </div>
      </div>

      {binding.excludeRules.importedGitignore.length > 0 ? (
        <div className="grid gap-2">
          <Label>已导入的 .gitignore 规则</Label>
          <div className="flex flex-wrap gap-1.5">
            {binding.excludeRules.importedGitignore.map((rule) => (
              <span key={rule} className="rounded-md bg-muted px-2 py-1 font-mono text-xs text-muted-foreground">{rule}</span>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">创建同步时一次性导入，之后改动 .gitignore 不再影响同步。</p>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>取消</Button>
        <Button
          type="button"
          disabled={readOnly || pending}
          onClick={() => onSave({
            defaults: options.filter((rule) => defaults.has(rule)),
            importedGitignore: binding.excludeRules.importedGitignore,
            user,
          })}
        >
          保存规则
        </Button>
      </div>
    </div>
  )
}
