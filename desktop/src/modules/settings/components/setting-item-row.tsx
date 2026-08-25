import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SettingsFieldRow } from "@/modules/settings/components/settings-field-row"
import { Switch } from "@/components/ui/switch"
import type { SettingItem, SettingsContext } from "@/modules/settings/types"

type SettingItemRowProps = {
  item: SettingItem
  value: unknown
  context: SettingsContext
  onSave: (item: SettingItem, value: unknown) => Promise<boolean>
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
  const currentInputValueRef = useRef(currentInputValue)
  const latestDraftValueRef = useRef(draftValue)
  const controlClassName = "border-border/70"
  const trackName = `settings.${item.key}`

  useEffect(() => {
    currentInputValueRef.current = currentInputValue
    latestDraftValueRef.current = currentInputValue
    setDraftValue(currentInputValue)
  }, [currentInputValue, item.key])

  useEffect(() => {
    latestDraftValueRef.current = draftValue
  }, [draftValue])

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
      }
    }
  }, [])

  const candidateValue = supportsDraftInput ? parseDraftValue(draftValue, item.type) : value
  const validationMessage = item.validation?.(candidateValue, context) ?? null

  const handleFailedDraftSave = useCallback((submittedDraftValue: string) => {
    if (latestDraftValueRef.current !== submittedDraftValue) {
      hasLocalEditRef.current = true
      return
    }

    const nextDraftValue = currentInputValueRef.current
    latestDraftValueRef.current = nextDraftValue
    hasLocalEditRef.current = false
    setDraftValue(nextDraftValue)
  }, [])

  const saveDraftValue = useCallback(
    (submittedDraftValue: string, submittedValue: unknown) => {
      hasLocalEditRef.current = false
      void onSave(item, submittedValue)
        .then((saved) => {
          if (!saved) {
            handleFailedDraftSave(submittedDraftValue)
          }
        })
        .catch(() => {
          handleFailedDraftSave(submittedDraftValue)
        })
    },
    [handleFailedDraftSave, item, onSave],
  )

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

    saveDraftValue(draftValue, candidateValue)
  }

  useEffect(() => {
    if (!supportsDraftInput || item.readOnly || !hasLocalEditRef.current) {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = null
      }
      return
    }

    if (draftValue === currentInputValue || validationMessage !== null) {
      // External value sync or validation failure: cancel any pending stale save
      // so an earlier debounce timer doesn't overwrite the externally-set value.
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = null
      }
      return
    }

    if (pendingSaveRef.current !== null) {
      window.clearTimeout(pendingSaveRef.current)
    }

    pendingSaveRef.current = window.setTimeout(() => {
      pendingSaveRef.current = null
      saveDraftValue(draftValue, candidateValue)
    }, 300)

    return () => {
      if (pendingSaveRef.current !== null) {
        window.clearTimeout(pendingSaveRef.current)
        pendingSaveRef.current = null
      }
    }
  }, [candidateValue, currentInputValue, draftValue, item.readOnly, saveDraftValue, supportsDraftInput, validationMessage])

  return (
    <SettingsFieldRow
      label={item.label}
      description={item.description}
      error={validationMessage}
      controlClassName={item.type === "toggle" ? "flex w-full justify-end" : undefined}
    >
      {item.type === "select" ? (
        <Select
          data-track={trackName}
          value={typeof value === "string" ? value : undefined}
          onValueChange={(nextValue) => {
            void onSave(item, nextValue)
          }}
        >
          <SelectTrigger className="w-full border-border/70">
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
        <Switch
          data-track={trackName}
          checked={Boolean(value)}
          onCheckedChange={(checked) => {
            void onSave(item, checked)
          }}
        />
      ) : null}

      {supportsDraftInput ? (
        <Input
          data-track={trackName}
          className={controlClassName}
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
    </SettingsFieldRow>
  )
}

export { SettingItemRow }
