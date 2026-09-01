import { cn } from "@/lib/utils"
import { track } from "@/lib/ui-tracking"
import { SYNAPSE_CONTENT_COLOR_OPTIONS } from "@/lib/content-appearance"

type ContentBackgroundPickerProps = {
  onValueChange: (value: string) => void
  value: string
}

function ContentBackgroundPicker({
  onValueChange,
  value,
}: ContentBackgroundPickerProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {SYNAPSE_CONTENT_COLOR_OPTIONS.map((option) => {
        const isSelected = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isSelected}
            aria-label={option.label}
            className={cn(
              "size-10 cursor-pointer rounded-md ring-1 ring-border/60 transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none",
              option.backgroundClassName,
              isSelected && "ring-2 ring-foreground/70 ring-offset-2 ring-offset-background",
            )}
            onClick={() => {
              if (!isSelected) {
                track({
                  component: "content-background-picker",
                  name: "content-background-picker",
                  action: "select",
                  eventKey: "content.background.select",
                  value: option.value,
                })
              }

              onValueChange(option.value)
            }}
            title={option.label}
          />
        )
      })}
    </div>
  )
}

export { ContentBackgroundPicker }
