import { Search } from "lucide-react"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"

export function ConversationFilters({
  query,
  rawText,
  onQueryChange,
  onRawTextChange,
}: {
  readonly query: string
  readonly rawText: boolean
  readonly onQueryChange: (value: string) => void
  readonly onRawTextChange: (value: boolean) => void
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <InputGroup className="min-w-64 flex-1">
        <InputGroupAddon>
          <Search />
        </InputGroupAddon>
        <InputGroupInput
          value={query}
          placeholder="搜索"
          onChange={(event) => onQueryChange(event.target.value)}
        />
      </InputGroup>
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
