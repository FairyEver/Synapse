import { useMemo, useState } from "react"
import { Copy, Eye, EyeOff, Plus, RotateCcw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "../../../src/components/ui/button"
import { Input } from "../../../src/components/ui/input"
import { NativeSelect, NativeSelectOption } from "../../../src/components/ui/native-select"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import type { SynapseTerminalEnvironment } from "../../../src/types/terminal"

const PROTECTED_ENVIRONMENT: SynapseTerminalEnvironment = {
  TERM_PROGRAM: "Synapse",
  TERM_PROGRAM_VERSION: "当前版本",
}

export function TerminalEnvironmentEditor({
  value,
  inheritedValue,
  inheritedLabel,
  onRevealValue,
  onCopyValue,
  onChange,
}: {
  readonly value?: SynapseTerminalEnvironment
  readonly inheritedValue?: SynapseTerminalEnvironment
  readonly inheritedLabel: string
  readonly onRevealValue: (key: string) => Promise<string | null>
  readonly onCopyValue: (key: string, value: string) => Promise<void>
  readonly onChange: (value: SynapseTerminalEnvironment | undefined) => void
}) {
  const [newKey, setNewKey] = useState("")
  const [newValue, setNewValue] = useState("")
  const [revealedKeys, setRevealedKeys] = useState<Record<string, boolean>>({})
  const [revealedValues, setRevealedValues] = useState<Record<string, string>>({})
  const local = value ?? {}
  const rows = useMemo(() => {
    const keys = new Set([...Object.keys(PROTECTED_ENVIRONMENT), ...Object.keys(inheritedValue ?? {}), ...Object.keys(local)])
    return [...keys].sort((left, right) => left.localeCompare(right))
  }, [inheritedValue, local])

  const commit = (next: SynapseTerminalEnvironment) => {
    onChange(Object.keys(next).length ? next : undefined)
  }
  const updateEntry = (key: string, entry: string | null | undefined) => {
    const next = { ...local }
    if (entry === undefined) delete next[key]
    else next[key] = entry
    commit(next)
  }
  const addEntry = () => {
    const key = newKey.trim()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      toast.error("变量名格式不正确")
      return
    }
    if (key === "TERM_PROGRAM" || key === "TERM_PROGRAM_VERSION") {
      toast.error("该变量由 Synapse 管理")
      return
    }
    updateEntry(key, newValue)
    setNewKey("")
    setNewValue("")
  }
  const revealValue = async (key: string, fallback: string) => {
    try {
      const revealed = await onRevealValue(key)
      setRevealedValues((current) => ({ ...current, [key]: revealed ?? fallback }))
      setRevealedKeys((current) => ({ ...current, [key]: true }))
    } catch {
      toast.error("显示变量失败")
    }
  }
  const copyValue = async (key: string, value: string) => {
    try {
      await onCopyValue(key, value)
      toast.success(`已复制 ${key}`)
    } catch {
      toast.error("复制失败")
    }
  }

  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-[minmax(8rem,1fr)_minmax(8rem,1.5fr)_auto] gap-2 max-sm:grid-cols-1">
        <Input aria-label="变量名" placeholder="变量名" value={newKey} onChange={(event) => setNewKey(event.target.value)} />
        <Input aria-label="变量值" placeholder="值（可为空）" value={newValue} onChange={(event) => setNewValue(event.target.value)} />
        <Button type="button" variant="outline" onClick={addEntry} disabled={!newKey.trim()}>
          <Plus data-icon="inline-start" />
          添加
        </Button>
      </div>
      <ScrollArea className="max-h-80 rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>变量</TableHead>
              <TableHead>处理</TableHead>
              <TableHead>值</TableHead>
              <TableHead>来源</TableHead>
              <TableHead className="text-right" aria-label="操作" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((key) => {
              const protectedEntry = key in PROTECTED_ENVIRONMENT
              const localEntry = Object.prototype.hasOwnProperty.call(local, key) ? local[key] : undefined
              const inheritedEntry = inheritedValue?.[key]
              const action = protectedEntry ? "protected" : localEntry === undefined ? "inherit" : localEntry === null ? "unset" : "set"
              const displayedValue = protectedEntry ? PROTECTED_ENVIRONMENT[key] : localEntry === undefined ? inheritedEntry : localEntry
              const effectiveValue = revealedKeys[key] ? revealedValues[key] ?? displayedValue : displayedValue
              return (
                <TableRow key={key}>
                  <TableCell className="font-mono text-xs">{key}</TableCell>
                  <TableCell>
                    {protectedEntry ? <span className="text-muted-foreground">内置</span> : (
                      <NativeSelect
                        aria-label={`${key} 的处理方式`}
                        value={action}
                        onChange={(event) => {
                          const nextAction = event.target.value
                          if (nextAction === "inherit") updateEntry(key, undefined)
                          else if (nextAction === "unset") updateEntry(key, null)
                          else updateEntry(key, typeof displayedValue === "string" ? displayedValue : "")
                        }}
                      >
                        <NativeSelectOption value="inherit">继承</NativeSelectOption>
                        <NativeSelectOption value="set">设置</NativeSelectOption>
                        <NativeSelectOption value="unset">不传入</NativeSelectOption>
                      </NativeSelect>
                    )}
                  </TableCell>
                  <TableCell className="min-w-44">
                    {action === "unset" ? <span className="text-muted-foreground">—</span> : (
                      <Input
                        aria-label={`${key} 的值`}
                        type={revealedKeys[key] || protectedEntry ? "text" : "password"}
                        value={typeof effectiveValue === "string" ? effectiveValue : ""}
                        disabled={protectedEntry || action === "inherit"}
                        onChange={(event) => updateEntry(key, event.target.value)}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{protectedEntry ? "Synapse" : localEntry === undefined ? inheritedLabel : "当前层"}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {action === "set" && typeof displayedValue === "string" ? (
                        <>
                          <Button type="button" size="icon-xs" variant="ghost" aria-label={revealedKeys[key] ? `隐藏 ${key}` : `显示 ${key}`} onClick={() => {
                            if (revealedKeys[key]) setRevealedKeys((current) => ({ ...current, [key]: false }))
                            else void revealValue(key, displayedValue)
                          }}>
                            {revealedKeys[key] ? <EyeOff /> : <Eye />}
                          </Button>
                          <Button type="button" size="icon-xs" variant="ghost" aria-label={`复制 ${key}`} onClick={() => { void copyValue(key, displayedValue) }}>
                            <Copy />
                          </Button>
                        </>
                      ) : null}
                      {!protectedEntry && localEntry !== undefined ? (
                        <Button type="button" size="icon-xs" variant="ghost" aria-label={`恢复继承 ${key}`} onClick={() => updateEntry(key, undefined)}>
                          <RotateCcw />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  )
}
