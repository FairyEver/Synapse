import { Button } from "@/components/ui/button"
import { SYNAPSE_CONTENT_ICON_OPTIONS } from "@/lib/content-appearance"

type ContentIconPickerProps = {
  onValueChange: (value: string) => void
  value: string
}

function ContentIconPicker({ onValueChange, value }: ContentIconPickerProps) {
  return (
    <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
      {SYNAPSE_CONTENT_ICON_OPTIONS.map((option) => {
        const Icon = option.icon
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
            <Icon data-icon="inline-start" />
            <span className="truncate">{option.label}</span>
          </Button>
        )
      })}
    </div>
  )
}

export { ContentIconPicker }
