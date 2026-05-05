import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Filter } from "lucide-react"

interface SourcePickerProps {
  clients: string[]
  selected: Set<string>
  onChange: (selected: Set<string>) => void
}

export function SourcePicker({ clients, selected, onChange }: SourcePickerProps) {
  if (clients.length <= 1) return null

  const allSelected = clients.every((c) => selected.has(c))

  function toggle(client: string) {
    const next = new Set(selected)
    if (next.has(client)) {
      if (next.size <= 1) return
      next.delete(client)
    } else {
      next.add(client)
    }
    onChange(next)
  }

  function toggleAll() {
    if (allSelected) return
    onChange(new Set(clients))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Filter className="h-3.5 w-3.5" />
          来源
          {selected.size < clients.length && (
            <span className="bg-primary text-primary-foreground ml-0.5 rounded-full px-1.5 text-xs">
              {selected.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-2" align="end">
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mb-1 w-full px-2 py-1 text-left text-xs"
          onClick={toggleAll}
        >
          全选
        </button>
        {clients.map((client) => (
          <label
            key={client}
            className="hover:bg-muted flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm"
          >
            <Checkbox
              checked={selected.has(client)}
              onCheckedChange={() => toggle(client)}
            />
            {client}
          </label>
        ))}
      </PopoverContent>
    </Popover>
  )
}
