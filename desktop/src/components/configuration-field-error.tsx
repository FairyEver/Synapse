import { FieldError } from "@/components/ui/field"

export type ConfigurationFieldErrors = Readonly<Record<string, string>>

export function configurationFieldProps(errors: ConfigurationFieldErrors | undefined, key: string, id: string) {
  return { "aria-invalid": errors?.[key] ? true : undefined, "aria-describedby": errors?.[key] ? `${id}-error` : undefined }
}

export function ConfigurationFieldError({ errors, name, id }: { errors?: ConfigurationFieldErrors; name: string; id: string }) {
  return errors?.[name] ? <FieldError id={`${id}-error`}>{errors[name]}</FieldError> : null
}
