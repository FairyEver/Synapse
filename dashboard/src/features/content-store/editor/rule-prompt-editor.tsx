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
    <div className='flex flex-col gap-2'>
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className='min-h-120 resize-y font-mono text-sm'
      />
    </div>
  )
}
