import { ExternalLinkIcon } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type {
  SynapseAgentProviderCategory,
  SynapseAgentProviderPreset,
} from "@/types/bridge"

type ProviderCategoryOption = {
  readonly value: SynapseAgentProviderCategory
  readonly label: string
}

type ProviderPresetOption = {
  readonly value: string
  readonly preset: SynapseAgentProviderPreset
}

type ProviderPresetPickerDialogProps = {
  readonly open: boolean
  readonly options: readonly ProviderPresetOption[]
  readonly categories: readonly ProviderCategoryOption[]
  readonly selectedValue: string
  readonly customValue: string
  readonly onOpenChange: (open: boolean) => void
  readonly onSelect: (value: string) => void
}

type ResultGroup = {
  readonly category: SynapseAgentProviderCategory
  readonly label: string
  readonly options: readonly ProviderPresetOption[]
}

const ALL_CATEGORIES = "all"

type CategoryFilter = SynapseAgentProviderCategory | typeof ALL_CATEGORIES

function ProviderPresetPickerDialog({
  open,
  options,
  categories,
  selectedValue,
  customValue,
  onOpenChange,
  onSelect,
}: ProviderPresetPickerDialogProps) {
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState<CategoryFilter>(ALL_CATEGORIES)
  const [initial, setInitial] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQuery("")
    setCategory(ALL_CATEGORIES)
    setInitial(null)
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const categoryLabels = useMemo(
    () => new Map(categories.map((item) => [item.value, item.label])),
    [categories],
  )
  const initials = useMemo(() => presetInitials(options), [options])
  const groups = useMemo(
    () => groupPresetOptions({
      options,
      category,
      initial,
      query,
      categoryLabels,
    }),
    [category, categoryLabels, initial, options, query],
  )

  const handleSelect = (value: string) => {
    onOpenChange(false)
    onSelect(value)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>选择提供商预设</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          <Input
            ref={inputRef}
            value={query}
            placeholder="搜索名称、模型或地址"
            onChange={(event) => setQuery(event.target.value)}
          />

          <Tabs
            value={category}
            onValueChange={(value) => setCategory(value as CategoryFilter)}
          >
            <TabsList variant="line" className="flex h-auto flex-wrap justify-start">
              <TabsTrigger value={ALL_CATEGORIES}>全部</TabsTrigger>
              {categories.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {initials.length > 0 ? (
            <ToggleGroup
              type="single"
              value={initial ?? ""}
              variant="default"
              size="sm"
              spacing={1}
              className="flex flex-wrap justify-start"
              onValueChange={(value) => setInitial(value || null)}
            >
              {initials.map((letter) => (
                <ToggleGroupItem
                  key={letter}
                  value={letter}
                  aria-label={`筛选 ${letter}`}
                >
                  {letter}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          ) : null}

          <button
            data-track="settings.provider-preset.custom.select"
            data-track-native="true"
            type="button"
            data-selected={selectedValue === customValue}
            className="flex h-10 w-full items-center rounded-lg bg-muted/40 px-3 text-left text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[selected=true]:bg-muted"
            onClick={() => handleSelect(customValue)}
          >
            自定义
          </button>

          <ScrollArea className="h-80">
            <div className="flex flex-col gap-2 pr-3">
              {groups.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的预设</p>
              ) : groups.map((group) => (
                <section key={group.category} className="flex flex-col gap-2">
                  <div className="text-xs font-medium text-muted-foreground">{group.label}</div>
                  <div className="flex flex-col gap-1">
                    {group.options.map((option) => (
                      <ProviderPresetRow
                        key={option.value}
                        option={option}
                        selected={option.value === selectedValue}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderPresetRow({
  option,
  selected,
  onSelect,
}: {
  readonly option: ProviderPresetOption
  readonly selected: boolean
  readonly onSelect: (value: string) => void
}) {
  const detail = presetDetail(option.preset)
  const link = option.preset.apiKeyUrl ?? option.preset.websiteUrl

  return (
    <div
      data-selected={selected}
      className="flex w-full items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 transition-colors hover:bg-muted data-[selected=true]:bg-muted"
    >
      <button
        data-track="settings.provider-preset.select"
        data-track-native="true"
        type="button"
        className="min-w-0 flex-1 text-left"
        onClick={() => onSelect(option.value)}
      >
        <span className="block truncate text-sm font-medium">{option.preset.name}</span>
        {detail ? <span className="block truncate text-xs text-muted-foreground">{detail}</span> : null}
      </button>
      {link ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`打开 ${option.preset.name} 链接`}
          onClick={(event) => {
            event.stopPropagation()
            window.synapse?.shell.openExternal(link).catch(() => {})
          }}
        >
          <ExternalLinkIcon data-icon="inline-start" />
        </Button>
      ) : null}
    </div>
  )
}

function groupPresetOptions({
  options,
  category,
  initial,
  query,
  categoryLabels,
}: {
  readonly options: readonly ProviderPresetOption[]
  readonly category: CategoryFilter
  readonly initial: string | null
  readonly query: string
  readonly categoryLabels: ReadonlyMap<SynapseAgentProviderCategory, string>
}): ResultGroup[] {
  const normalizedQuery = normalizeSearchText(query)
  const filtered = options
    .filter((option) => category === ALL_CATEGORIES || option.preset.category === category)
    .filter((option) => !initial || presetInitial(option.preset.name) === initial)
    .filter((option) => matchesPresetQuery(option.preset, normalizedQuery))
    .slice()
    .sort((left, right) => left.preset.name.localeCompare(right.preset.name))

  const byCategory = new Map<SynapseAgentProviderCategory, ProviderPresetOption[]>()
  for (const option of filtered) {
    const group = byCategory.get(option.preset.category) ?? []
    group.push(option)
    byCategory.set(option.preset.category, group)
  }

  return Array.from(byCategory.entries()).map(([groupCategory, groupOptions]) => ({
    category: groupCategory,
    label: categoryLabels.get(groupCategory) ?? groupCategory,
    options: groupOptions,
  }))
}

function presetInitials(options: readonly ProviderPresetOption[]): string[] {
  return Array.from(new Set(options.map((option) => presetInitial(option.preset.name)).filter(Boolean))).sort()
}

function presetInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase()
}

function matchesPresetQuery(preset: SynapseAgentProviderPreset, query: string): boolean {
  if (!query) return true
  return [
    preset.name,
    preset.model,
    preset.baseUrl,
    preset.websiteUrl,
  ].some((value) => normalizeSearchText(value ?? "").includes(query))
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase()
}

function presetDetail(preset: SynapseAgentProviderPreset): string {
  return preset.model ?? preset.baseUrl ?? domainFromUrl(preset.websiteUrl) ?? ""
}

function domainFromUrl(url: string | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export { ProviderPresetPickerDialog }
export type { ProviderPresetOption }
