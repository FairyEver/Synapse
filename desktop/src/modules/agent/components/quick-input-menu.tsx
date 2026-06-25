import { ChevronDown, TextCursorInput } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { SynapseQuickInputItem } from "@/types/quick-input"

type QuickInputMenuProps = {
  readonly quickInputs: readonly SynapseQuickInputItem[]
  readonly disabled?: boolean
  readonly onDirectSend: (content: string) => void
}

const QUICK_INPUT_PREVIEW_MAX_LENGTH = 24

function quickInputMenuLabel(content: string): string {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?? content.trim()
}

function quickInputMenuPreview(content: string): string {
  const label = quickInputMenuLabel(content)
  return label.length > QUICK_INPUT_PREVIEW_MAX_LENGTH
    ? `${label.slice(0, QUICK_INPUT_PREVIEW_MAX_LENGTH)}…`
    : label
}

function QuickInputMenu({ quickInputs, disabled, onDirectSend }: QuickInputMenuProps) {
  if (quickInputs.length === 0) return null

  return (
    <DropdownMenu data-track="agent-quick-inputs">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__quick-input-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="快捷输入"
          data-track="agent-quick-inputs"
          disabled={disabled}
        >
          <TextCursorInput />
          <span>快捷输入</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-80"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {quickInputs.map((item) => (
          <DropdownMenuItem
            key={item.id}
            aria-label={`发送快捷输入：${quickInputMenuPreview(item.content)}`}
            onSelect={() => {
              onDirectSend(item.content)
            }}
          >
            <span className="min-w-0 flex-1 truncate">{quickInputMenuPreview(item.content)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { QuickInputMenu }
