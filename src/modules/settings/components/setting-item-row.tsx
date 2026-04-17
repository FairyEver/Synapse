import { useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import type { SettingItem, SettingsContext } from "@/modules/settings/types"

type SettingItemRowProps = {
  item: SettingItem
  value: unknown
  context: SettingsContext
  onSave: (item: SettingItem, value: unknown) => Promise<void>
}

function toInputValue(value: unknown, type: SettingItem["type"]): string {
  if (type === "number") {
    return typeof value === "number" && Number.isFinite(value) ? String(value) : ""
  }

  return typeof value === "string" ? value : ""
}

function parseDraftValue(value: string, type: SettingItem["type"]): unknown {
  if (type === "number") {
    if (!value.trim()) {
      return Number.NaN
    }

    return Number(value)
  }

  return value
}

function SettingItemRow({ item, value, context, onSave }: SettingItemRowProps) {
  const supportsDraftInput = item.type === "text" || item.type === "path" || item.type === "number"
  const currentInputValue = useMemo(() => toInputValue(value, item.type), [item.type, value])
  const [draftValue, setDraftValue] = useState(currentInputValue)
  const pendingSaveRef = useRef<number | null>(null)
  const hasLocalEditRef = useRef(false)

  useEffect(() => {
    setDraftValue(currentInputValue)
  }, [currentInputValue, item.key])

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
      }
    }
  }, [])

  const candidateValue = supportsDraftInput ? parseDraftValue(draftValue, item.type) : value
  const validationMessage = item.validation?.(candidateValue, context) ?? null

  const commitDraftValue = () => {
    if (!supportsDraftInput || item.readOnly) {
      return
    }

    if (draftValue === currentInputValue || validationMessage !== null) {
      return
    }

    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
      pendingSaveRef.current = null
    }

    hasLocalEditRef.current = false
    void onSave(item, candidateValue)
  }

  useEffect(() => {
    if (!supportsDraftInput || item.readOnly || !hasLocalEditRef.current) {
      return
    }

    if (draftValue === currentInputValue || validationMessage !== null) {
      return
    }

    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
    }

    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null
      hasLocalEditRef.current = false
      void onSave(item, candidateValue)
    }, 300)

    return () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = null
      }
    }
  }, [candidateValue, currentInputValue, draftValue, item, item.readOnly, onSave, supportsDraftInput, validationMessage])

  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
      <div className="flex max-w-2xl flex-col gap-1">
        <p className="text-sm font-medium">{item.label}</p>
        {item.description ? (
          <p className="text-sm text-muted-foreground">{item.description}</p>
        ) : null}
        {validationMessage ? (
          <p className="text-sm text-destructive">{validationMessage}</p>
        ) : null}
      </div>

      <div className="w-full md:max-w-sm">
        {item.type === "select" ? (
          <Select
            value={typeof value === "string" ? value : undefined}
            onValueChange={(nextValue) => {
              void onSave(item, nextValue)
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {item.options?.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : null}

        {item.type === "toggle" ? (
          <div className="flex justify-end">
            <Switch
              checked={Boolean(value)}
              onCheckedChange={(checked) => {
                void onSave(item, checked)
              }}
            />
          </div>
        ) : null}

        {supportsDraftInput ? (
          <Input
            type={item.type === "number" ? "number" : "text"}
            value={draftValue}
            readOnly={item.readOnly}
            disabled={item.readOnly}
            aria-invalid={validationMessage ? true : undefined}
            onBlur={commitDraftValue}
            onChange={(event) => {
              hasLocalEditRef.current = true
              setDraftValue(event.target.value)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

export { SettingItemRow }
