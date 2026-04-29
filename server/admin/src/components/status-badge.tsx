import { Badge } from "@/components/ui/badge"
import type { AccountStatus, DeviceStatus, ManagedStatus } from "@/lib/api"

const labels: Record<AccountStatus | DeviceStatus | ManagedStatus, string> = {
  active: "启用",
  disabled: "停用",
  revoked: "撤销",
  expired: "过期",
}

export function StatusBadge({
  status,
}: {
  readonly status: AccountStatus | DeviceStatus | ManagedStatus
}) {
  if (status === "active") {
    return <Badge>{labels[status]}</Badge>
  }
  if (status === "revoked") {
    return <Badge variant="destructive">{labels[status]}</Badge>
  }
  return <Badge variant="secondary">{labels[status]}</Badge>
}
