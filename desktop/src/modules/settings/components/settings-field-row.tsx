import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldTitle,
} from "@/components/ui/field"
import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

const SETTINGS_FIELD_CONTROL_CLASSNAME = "w-full md:w-full md:max-w-sm"

type SettingsFieldRowProps = {
  children: ReactNode
  className?: string
  contentClassName?: string
  controlClassName?: string
  description?: string
  error?: string | null
  label: string
}

function SettingsFieldRow({
  children,
  className,
  contentClassName,
  controlClassName = SETTINGS_FIELD_CONTROL_CLASSNAME,
  description,
  error,
  label,
}: SettingsFieldRowProps) {
  return (
    <Field
      orientation="responsive"
      data-invalid={error ? true : undefined}
      className={className}
    >
      <FieldTitle>{label}</FieldTitle>
      <FieldContent className={cn("w-full md:max-w-sm", contentClassName)}>
        <div className={cn("w-full", controlClassName)}>{children}</div>
        {description ? <FieldDescription>{description}</FieldDescription> : null}
        <FieldError>{error}</FieldError>
      </FieldContent>
    </Field>
  )
}

export { SettingsFieldRow, SETTINGS_FIELD_CONTROL_CLASSNAME }
