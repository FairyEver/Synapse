import { useId } from "react"
import { Check } from "lucide-react"

import { Field, FieldLabel, FieldLegend, FieldSet } from "../../../src/components/ui/field"
import { RadioGroup, RadioGroupItem } from "../../../src/components/ui/radio-group"
import { TERMINAL_THEMES, isTerminalThemeId, type TerminalThemeId } from "../shared/terminal-themes"
import type { TerminalAppearanceSize } from "./terminal-appearance"
import { TerminalThemePreview } from "./terminal-theme-preview"

export function TerminalThemePicker({ value, size, onValueChange }: {
  readonly value: TerminalThemeId
  readonly size: TerminalAppearanceSize
  readonly onValueChange: (theme: TerminalThemeId) => void
}) {
  const id = useId()

  return (
    <FieldSet>
      <FieldLegend variant="label">主题</FieldLegend>
      <RadioGroup
        aria-label="主题"
        data-track="terminal-appearance-theme"
        value={value}
        onValueChange={(theme) => {
          if (isTerminalThemeId(theme)) onValueChange(theme)
        }}
        className="grid-cols-1 gap-3 @md:grid-cols-2 @2xl:grid-cols-3"
      >
        {Object.entries(TERMINAL_THEMES).map(([themeId, theme]) => (
          <FieldLabel
            key={themeId}
            htmlFor={`${id}-${themeId}`}
            className="min-w-0 cursor-pointer has-focus-visible:ring-2 has-focus-visible:ring-ring"
          >
            <Field className="min-w-0" data-checked={value === themeId ? "" : undefined}>
              <div className="flex min-w-0 items-center justify-between gap-2">
                <span className="truncate">{theme.label}</span>
                <RadioGroupItem id={`${id}-${themeId}`} value={themeId} aria-label={theme.label} className="sr-only" />
                <Check aria-hidden="true" className={value === themeId ? "size-4 shrink-0" : "invisible size-4 shrink-0"} />
              </div>
              <TerminalThemePreview theme={themeId as TerminalThemeId} size={size} />
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  )
}
