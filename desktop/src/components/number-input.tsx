import { useEffect, useState, type ComponentProps } from "react"
import { Input } from "@/components/ui/input"

/** Keep empty and incomplete numeric input editable; validation owns the numeric value. */
export function NumberInput({ value, onValueChange, ...props }: Omit<ComponentProps<typeof Input>, "value" | "onChange"> & { value: number; onValueChange: (value: number) => void }) {
  const [text, setText] = useState(Number.isFinite(value) ? String(value) : "")
  useEffect(() => { if (Number.isFinite(value)) setText(current => Number(current) === value && current.trim() ? current : String(value)) }, [value])
  const invalid = !Number.isFinite(value) || (props.min !== undefined && value < Number(props.min)) || (props.max !== undefined && value > Number(props.max))
  return <Input {...props} aria-invalid={props["aria-invalid"] || invalid || undefined} inputMode="numeric" value={text} onChange={event => {
    const next = event.target.value
    setText(next)
    onValueChange(next.trim() ? Number(next) : Number.NaN)
  }} />
}
