import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type GroupByMode = "model" | "clientModel" | "clientProviderModel" | "workspaceModel"

const GROUP_BY_OPTIONS: { value: GroupByMode; label: string }[] = [
  { value: "model", label: "模型" },
  { value: "clientModel", label: "客户端 + 模型" },
  { value: "clientProviderModel", label: "客户端 + 供应商 + 模型" },
  { value: "workspaceModel", label: "工作区 + 模型" },
]

interface GroupByPickerProps {
  value: GroupByMode
  onChange: (value: GroupByMode) => void
}

export function GroupByPicker({ value, onChange }: GroupByPickerProps) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as GroupByMode)}>
      <SelectTrigger className="h-8 w-[200px] text-xs">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {GROUP_BY_OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={opt.value} className="text-xs">
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
