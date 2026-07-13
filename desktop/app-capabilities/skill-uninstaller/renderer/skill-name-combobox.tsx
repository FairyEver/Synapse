import { useEffect, useId, useMemo, useRef, useState } from "react"

import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"

function normalizedName(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function filterNameOptions(options: readonly string[], value: string): string[] {
  const query = normalizedName(value)
  if (!query) return [...options]
  const prefixes: string[] = []
  const contains: string[] = []
  for (const option of options) {
    const normalizedOption = normalizedName(option)
    if (normalizedOption.startsWith(query)) prefixes.push(option)
    else if (normalizedOption.includes(query)) contains.push(option)
  }
  return [...prefixes, ...contains]
}

export function SkillNameCombobox({
  value,
  options,
  loading,
  warning,
  error,
  disabled,
  readOnly,
  onValueChange,
}: {
  readonly value: string
  readonly options: readonly string[]
  readonly loading: boolean
  readonly warning?: string
  readonly error?: string
  readonly disabled?: boolean
  readonly readOnly?: boolean
  readonly onValueChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()
  const optionIdPrefix = useId()
  const visibleOptions = useMemo(() => filterNameOptions(options, value), [options, value])
  const activeOption = visibleOptions[activeIndex]
  const interactive = !disabled && !readOnly

  useEffect(() => setActiveIndex(-1), [options, value])

  const selectOption = (option: string) => {
    onValueChange(option)
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  if (readOnly) {
    return (
      <Input
        ref={inputRef}
        id="skill-uninstaller-name"
        value={value}
        readOnly
        disabled={disabled}
      />
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <Input
          ref={inputRef}
          id="skill-uninstaller-name"
          role="combobox"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-activedescendant={activeOption ? `${optionIdPrefix}-${activeIndex}` : undefined}
          value={value}
          readOnly={readOnly}
          disabled={disabled}
          onFocus={() => {
            if (interactive) setOpen(true)
          }}
          onChange={(event) => {
            onValueChange(event.target.value)
            setOpen(true)
          }}
          onKeyDown={(event) => {
            if (!interactive) return
            if (event.key === "ArrowDown") {
              event.preventDefault()
              setOpen(true)
              setActiveIndex((current) => Math.min(current + 1, visibleOptions.length - 1))
            } else if (event.key === "ArrowUp") {
              event.preventDefault()
              setOpen(true)
              setActiveIndex((current) => current <= 0 ? visibleOptions.length - 1 : current - 1)
            } else if (event.key === "Enter" && open && activeOption) {
              event.preventDefault()
              selectOption(activeOption)
            } else if (event.key === "Escape" && open) {
              event.preventDefault()
              setOpen(false)
            }
          }}
        />
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="p-1.5"
        style={{ width: inputRef.current?.getBoundingClientRect().width }}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <Command
          shouldFilter={false}
          value={activeOption ?? ""}
          onValueChange={(option) => setActiveIndex(visibleOptions.indexOf(option))}
        >
          <CommandList id={listId}>
            <CommandGroup>
              {loading ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">正在扫描 Skill…</p>
              ) : null}
              {!loading && error ? (
                <p className="px-2 py-3 text-sm text-destructive">{error}</p>
              ) : null}
              {!loading && !error && visibleOptions.length === 0 ? (
                <p className="px-2 py-3 text-sm text-muted-foreground">
                  {options.length === 0 ? "未发现 Skill" : "无匹配 Skill"}
                </p>
              ) : null}
              {!loading && !error ? visibleOptions.map((option, index) => (
                <CommandItem
                  id={`${optionIdPrefix}-${index}`}
                  key={option}
                  value={option}
                  data-track="skill-uninstaller-name-option"
                  onMouseDown={(event) => event.preventDefault()}
                  onSelect={() => selectOption(option)}
                >
                  <span className="truncate">{option}</span>
                </CommandItem>
              )) : null}
              {!loading && warning ? (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">{warning}</p>
              ) : null}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
