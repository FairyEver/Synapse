import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"
import {
  getContentColorOption,
  SYNAPSE_CONTENT_ICON_OPTIONS,
} from "@/lib/content-appearance"

type ContentIconPickerProps = {
  disabled?: boolean
  onValueChange: (value: string) => void
  tone?: string | null
  value: string
}

function ContentIconPicker({
  disabled = false,
  onValueChange,
  tone,
  value,
}: ContentIconPickerProps) {
  const colorOption = tone ? getContentColorOption(tone) : null

  return (
    <div className="flex flex-wrap gap-2">
      {SYNAPSE_CONTENT_ICON_OPTIONS.map((option) => {
        const Icon = option.icon
        const isSelected = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            aria-label={option.label}
            className={cn(
              "flex size-10 items-center justify-center rounded-md ring-1 ring-border/60 transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none [&_svg]:size-4",
              colorOption
                ? [colorOption.backgroundClassName, colorOption.foregroundClassName]
                : "bg-muted text-muted-foreground",
              isSelected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
              disabled && "cursor-not-allowed opacity-50",
            )}
            disabled={disabled}
            onClick={() => {
              if (!isSelected) {
                track({
                  component: "content-icon-picker",
                  name: "content-icon-picker",
                  action: "select",
                  eventKey: "content.icon.select",
                  value: option.value,
                })
              }

              onValueChange(option.value)
            }}
            title={option.label}
          >
            <Icon />
          </button>
        )
      })}
    </div>
  )
}

export { ContentIconPicker }
