import { useEffect, useState } from "react"

import { Input } from "../../../src/components/ui/input"

export function DraftInput<T>({
  value,
  parse,
  onChange,
  placeholder,
}: {
  readonly value: T
  readonly parse: (text: string) => { readonly ok: true; readonly value: T } | { readonly ok: false }
  readonly onChange: (value: T) => void
  readonly placeholder?: string
}) {
  const canonical = JSON.stringify(value)
  const [draft, setDraft] = useState(canonical)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    setDraft(canonical)
    setInvalid(false)
  }, [canonical])

  return (
    <Input
      value={draft}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(event) => {
        const next = event.target.value
        setDraft(next)
        const parsed = parse(next)
        setInvalid(!parsed.ok)
        if (parsed.ok) onChange(parsed.value)
      }}
    />
  )
}
