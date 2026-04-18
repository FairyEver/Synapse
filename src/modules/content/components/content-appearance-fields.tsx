import { Label } from "@/components/ui/label"
import { ContentBackgroundPicker } from "@/modules/content/components/content-background-picker"
import { ContentIconPicker } from "@/modules/content/components/content-icon-picker"

type ContentAppearanceFieldsProps = {
  backgroundError?: string
  backgroundLabel?: string
  backgroundValue: string
  iconError?: string
  iconLabel?: string
  iconValue: string
  onBackgroundValueChange: (value: string) => void
  onIconValueChange: (value: string) => void
}

function FieldError({ message }: { message?: string }) {
  if (!message) {
    return null
  }

  return <p className="text-sm text-destructive">{message}</p>
}

function ContentAppearanceFields({
  backgroundError,
  backgroundLabel = "背景色",
  backgroundValue,
  iconError,
  iconLabel = "图标",
  iconValue,
  onBackgroundValueChange,
  onIconValueChange,
}: ContentAppearanceFieldsProps) {
  return (
    <>
      <div className="flex flex-col gap-3">
        <Label>{backgroundLabel}</Label>
        <ContentBackgroundPicker
          value={backgroundValue}
          onValueChange={onBackgroundValueChange}
        />
        <FieldError message={backgroundError} />
      </div>

      <div className="flex flex-col gap-3">
        <Label>{iconLabel}</Label>
        <ContentIconPicker
          tone={backgroundValue}
          value={iconValue}
          onValueChange={onIconValueChange}
        />
        <FieldError message={iconError} />
      </div>
    </>
  )
}

export { ContentAppearanceFields }
