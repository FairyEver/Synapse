import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

type RulePromptEditorProps = {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}

export function RulePromptEditor({
  id,
  label,
  value,
  onChange,
}: RulePromptEditorProps) {
  return (
    <section className='flex min-h-0 flex-1 flex-col gap-2 overflow-hidden rounded-lg border bg-card p-4'>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='min-h-0 flex-1 resize-none font-mono text-sm'
      />
    </section>
  )
}
