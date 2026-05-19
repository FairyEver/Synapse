import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { USAGE_RANGE_OPTIONS } from "../range"
import type { UsageRangePreset } from "../types"

interface RangePickerProps {
  value: UsageRangePreset
  onChange: (value: UsageRangePreset) => void
}

export function RangePicker({ value, onChange }: RangePickerProps) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as UsageRangePreset)}>
      <TabsList>
        {USAGE_RANGE_OPTIONS.map((option) => (
          <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  )
}
