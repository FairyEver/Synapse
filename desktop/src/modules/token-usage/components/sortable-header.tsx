import { ArrowUp, ArrowDown } from "lucide-react"
import { TableHead } from "@/components/ui/table"

interface SortableHeaderProps<T> {
  label: string
  sortKey: keyof T & string
  currentKey: keyof T & string
  currentDir: "asc" | "desc"
  onToggle: (key: keyof T & string) => void
  className?: string
}

export function SortableHeader<T>({ label, sortKey, currentKey, currentDir, onToggle, className }: SortableHeaderProps<T>) {
  const active = sortKey === currentKey
  const Icon = currentDir === "asc" ? ArrowUp : ArrowDown

  return (
    <TableHead
      className={`cursor-pointer select-none ${className ?? ""}`}
      onClick={() => onToggle(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active && <Icon className="h-3 w-3" />}
      </span>
    </TableHead>
  )
}
