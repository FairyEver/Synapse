import { useMemo, useState } from "react"
import { Check, ChevronsUpDown } from "lucide-react"

import { Button } from "../../../src/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../../src/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "../../../src/components/ui/popover"

const COMMON_SHELLS = ["/bin/zsh", "/bin/bash", "/bin/sh", "/opt/homebrew/bin/fish", "pwsh.exe", "powershell.exe", "cmd.exe"]

export function TerminalShellCombobox({
  value,
  inheritedValue,
  onChange,
}: {
  readonly value?: string
  readonly inheritedValue?: string
  readonly onChange: (value: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const choices = useMemo(() => {
    const all = [inheritedValue, value, ...COMMON_SHELLS].filter((item): item is string => Boolean(item))
    return [...new Set(all)]
  }, [inheritedValue, value])

  const select = (next: string | undefined) => {
    onChange(next)
    setOpen(false)
    setQuery("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open} className="w-full justify-between font-normal">
          <span className="truncate">{value ?? (inheritedValue ? `继承：${inheritedValue}` : "继承系统默认")}</span>
          <ChevronsUpDown className="text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(28rem,calc(100vw-3rem))] p-0">
        <Command shouldFilter>
          <CommandInput value={query} onValueChange={setQuery} placeholder="输入 Shell 路径" />
          <CommandList>
            <CommandEmpty>{query.trim() ? (
              <Button type="button" variant="ghost" className="w-full justify-start" onClick={() => select(query.trim())}>
                使用 {query.trim()}
              </Button>
            ) : "无匹配项"}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__inherit__" data-checked={!value} onSelect={() => select(undefined)}>
                继承
              </CommandItem>
              {choices.map((shell) => (
                <CommandItem key={shell} value={shell} data-checked={value === shell} onSelect={() => select(shell)}>
                  {value === shell ? <Check aria-hidden="true" /> : null}
                  <span className="truncate">{shell}</span>
                </CommandItem>
              ))}
              {query.trim() && !choices.includes(query.trim()) ? (
                <CommandItem value={query.trim()} onSelect={() => select(query.trim())}>
                  使用 {query.trim()}
                </CommandItem>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
