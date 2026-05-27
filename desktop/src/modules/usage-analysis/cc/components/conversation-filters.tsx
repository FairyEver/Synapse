import { Search } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

const RECORD_SEARCH_PLACEHOLDER = "搜标题 / 项目 / 模型 / Session ID；打开原文后搜对话内容"

export function ConversationFilters({
  query,
  rawText,
  statusText,
  onQueryChange,
  onRawTextChange,
}: {
  readonly query: string
  readonly rawText: boolean
  readonly statusText?: string
  readonly onQueryChange: (value: string) => void
  readonly onRawTextChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 py-1">
      <InputGroup className="min-w-64 flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder={RECORD_SEARCH_PLACEHOLDER}
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </InputGroup>
      {statusText ? (
        <span className="text-sm whitespace-nowrap text-muted-foreground">{statusText}</span>
      ) : null}
      <div className="flex h-8 items-center gap-2">
        <Label htmlFor="cc-conversation-raw-text">原文</Label>
        <Switch
          id="cc-conversation-raw-text"
          size="sm"
          checked={rawText}
          onCheckedChange={onRawTextChange}
          aria-label="原文"
        />
      </div>
    </div>
  )
}
