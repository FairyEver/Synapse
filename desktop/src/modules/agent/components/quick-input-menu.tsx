import { ChevronDown, TextCursorInput } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SynapseQuickInput } from "@/types/config"

type QuickInputMenuProps = {
  readonly quickInputs: readonly SynapseQuickInput[]
  readonly disabled?: boolean
  readonly onInsert: (content: string) => void
}

function quickInputMenuLabel(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? content.trim()
}

function QuickInputMenu({ quickInputs, disabled, onInsert }: QuickInputMenuProps) {
  if (quickInputs.length === 0) return null

  return (
    <DropdownMenu data-track="agent-quick-inputs">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__quick-input-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="快速输入"
          data-track="agent-quick-inputs"
          disabled={disabled}
        >
          <TextCursorInput />
          <span>快速输入</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {quickInputs.map((item) => (
          <DropdownMenuItem key={item.id} onSelect={() => onInsert(item.content)}>
            <span className="max-w-80 truncate">{quickInputMenuLabel(item.content)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { QuickInputMenu }
