import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { DeviceStatus, ManagedStatus } from "@/lib/api"

const managedStatuses: Array<{ label: string; value: ManagedStatus }> = [
  { label: "启用", value: "active" },
  { label: "停用", value: "disabled" },
  { label: "撤销", value: "revoked" },
  { label: "过期", value: "expired" },
]

const deviceStatuses: Array<{ label: string; value: DeviceStatus }> = [
  { label: "启用", value: "active" },
  { label: "撤销", value: "revoked" },
]

export function ManagedStatusSelect({
  value,
  onChange,
}: {
  readonly value: ManagedStatus
  readonly onChange: (value: ManagedStatus) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as ManagedStatus)}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {managedStatuses.map((status) => (
          <SelectItem key={status.value} value={status.value}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function DeviceStatusSelect({
  value,
  onChange,
}: {
  readonly value: DeviceStatus
  readonly onChange: (value: DeviceStatus) => void
}) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as DeviceStatus)}>
      <SelectTrigger size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {deviceStatuses.map((status) => (
          <SelectItem key={status.value} value={status.value}>
            {status.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
