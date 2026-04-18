import { Button } from "@/components/ui/button"
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
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {SYNAPSE_CONTENT_COLOR_OPTIONS.map((option) => {
        const isSelected = value === option.value

        return (
          <Button
            key={option.value}
            type="button"
            variant={isSelected ? "secondary" : "outline"}
            aria-pressed={isSelected}
            className="h-10 justify-start px-2 text-xs"
            onClick={() => onValueChange(option.value)}
            title={option.label}
          >
            <span
              className={`size-3.5 rounded-sm ring-1 ring-border/60 ${option.swatchClassName}`}
            />
            <span className="truncate">{option.label}</span>
          </Button>
        )
      })}
    </div>
  )
}

export { ContentBackgroundPicker }
