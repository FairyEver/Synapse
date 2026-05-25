import { ChevronDown, SendHorizontal, TextCursorInput } from "lucide-react"

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

function QuickInputMenu({ quickInputs, disabled, onInsert, onDirectSend }: QuickInputMenuProps) {
  if (quickInputs.length === 0) return null

  return (
    <DropdownMenu data-track="agent-quick-inputs">
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          className="agent-composer__quick-input-trigger rounded-lg px-2.5 text-muted-foreground"
          aria-label="片段"
          data-track="agent-quick-inputs"
          disabled={disabled}
        >
          <TextCursorInput />
          <span>片段</span>
          <ChevronDown data-icon="inline-end" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-96"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        {quickInputs.map((item) => (
          <DropdownMenuItem
            key={item.id}
            aria-label={`${item.directSend ? "直接发送" : "插入"}片段：${quickInputMenuPreview(item.content)}`}
            onSelect={() => {
              if (item.directSend) {
                onDirectSend(item.content)
                return
              }
              onInsert(item.content)
            }}
          >
            {item.directSend ? (
              <SendHorizontal aria-hidden="true" data-quick-input-action="send" />
            ) : (
              <TextCursorInput aria-hidden="true" data-quick-input-action="insert" />
            )}
            <span className="max-w-80 truncate">{quickInputMenuPreview(item.content)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { QuickInputMenu }
