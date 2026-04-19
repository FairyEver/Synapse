import {
  Field,
  FieldContent,
  FieldError,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
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
    <FieldSet className="gap-5">
      <FieldLegend className="sr-only">外观设置</FieldLegend>
      <Field data-invalid={backgroundError ? true : undefined}>
        <FieldTitle>{backgroundLabel}</FieldTitle>
        <FieldContent>
          <ContentBackgroundPicker
            value={backgroundValue}
            onValueChange={onBackgroundValueChange}
          />
          <FieldError>{backgroundError}</FieldError>
        </FieldContent>
      </Field>

      <Field data-invalid={iconError ? true : undefined}>
        <FieldTitle>{iconLabel}</FieldTitle>
        <FieldContent>
          <ContentIconPicker
            tone={backgroundValue}
            value={iconValue}
            onValueChange={onIconValueChange}
          />
          <FieldError>{iconError}</FieldError>
        </FieldContent>
      </Field>
    </FieldSet>
  )
}

export { ContentAppearanceFields }
