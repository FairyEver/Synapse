import { Textarea } from "../../../src/components/ui/textarea"

export function ScriptSourceEditor({
  value,
  onChange,
  id,
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly id?: string
}) {
  return (
    <Textarea
      id={id}
      className="min-h-56 resize-y font-mono text-xs"
      spellCheck={false}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}
