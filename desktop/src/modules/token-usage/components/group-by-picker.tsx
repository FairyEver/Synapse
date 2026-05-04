import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export type GroupByMode = "model" | "clientModel" | "clientProviderModel" | "workspaceModel"

const GROUP_BY_OPTIONS: { value: GroupByMode; label: string }[] = [
  { value: "model", label: "Model" },
  { value: "clientModel", label: "Client + Model" },
  { value: "clientProviderModel", label: "Client + Provider + Model" },
  { value: "workspaceModel", label: "Workspace + Model" },
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
