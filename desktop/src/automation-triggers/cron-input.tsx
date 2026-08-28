import { useRef, useState } from "react"

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { CronEditorDialog } from "./cron-editor-dialog"

type CronInputProps = {
  disabled?: boolean
  id: string
  value: string
  onChange: (value: string) => void
}

function CronInput({ disabled, id, value, onChange }: CronInputProps) {
  const [editorOpen, setEditorOpen] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <InputGroup>
        <InputGroupInput
          id={id}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            ref={editButtonRef}
            type="button"
            disabled={disabled}
            onClick={() => setEditorOpen(true)}
          >
            编辑
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      <CronEditorDialog
        open={editorOpen}
        value={value}
        returnFocusRef={editButtonRef}
        onApply={onChange}
        onOpenChange={setEditorOpen}
      />
    </>
  )
}

export { CronInput }
export type { CronInputProps }
