import * as React from "react"
import { PageState } from "@/components/page-state"
import { StatusBadge } from "@/components/status-badge"
import {
  DeviceStatusActionButtons,
  TableActionCell,
  TableActionHead,
} from "@/components/table-actions"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type DeviceStatus } from "@/lib/api"
import { includesSearch } from "@/lib/filter"
import { formatDate } from "@/lib/format"

type DeviceStatusFilter = DeviceStatus | "all"

const filterControlClassName = "w-32 shrink-0"
const deviceStatusOptions: Array<{ label: string; value: DeviceStatusFilter }> = [
  { label: "全部状态", value: "all" },
  { label: "启用", value: "active" },
  { label: "撤销", value: "revoked" },
]

export function DevicesPage() {
  const { data, error, loading, reload } = useApiResource(adminApi.listDevices)
  const [accountSearch, setAccountSearch] = React.useState("")
  const [platformSearch, setPlatformSearch] = React.useState("")
  const [statusFilter, setStatusFilter] = React.useState<DeviceStatusFilter>("all")
  const [versionSearch, setVersionSearch] = React.useState("")
  const [nameSearch, setNameSearch] = React.useState("")
  const devices = data ?? []
  const filteredDevices = React.useMemo(
    () => devices.filter((device) => (
      includesSearch(device.license.account.email, accountSearch)
      && includesSearch(device.platform, platformSearch)
      && (statusFilter === "all" || device.status === statusFilter)
      && includesSearch(device.appVersion, versionSearch)
      && includesSearch(device.name, nameSearch)
    )),
    [accountSearch, devices, nameSearch, platformSearch, statusFilter, versionSearch],
  )

  async function updateDevice(id: string, status: DeviceStatus) {
    await adminApi.updateDevice(id, status)
    reload()
  }

  const hasDevices = devices.length > 0

  return (
    <div className="grid gap-4">
      <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 py-1">
        <Input
          id="device-name-search"
          aria-label="名称"
          placeholder="名称"
          className={filterControlClassName}
          value={nameSearch}
          onChange={(event) => setNameSearch(event.target.value)}
        />
        <Input
          id="device-account-search"
          aria-label="账号"
          placeholder="账号"
          className={filterControlClassName}
          value={accountSearch}
          onChange={(event) => setAccountSearch(event.target.value)}
        />
        <Input
          id="device-platform-search"
          aria-label="平台"
          placeholder="平台"
          className={filterControlClassName}
          value={platformSearch}
          onChange={(event) => setPlatformSearch(event.target.value)}
        />
        <Select
          value={statusFilter}
          onValueChange={(next) => setStatusFilter(next as DeviceStatusFilter)}
        >
          <SelectTrigger
            id="device-status-search"
            aria-label="状态"
            className={filterControlClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {deviceStatusOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
        <Input
          id="device-version-search"
          aria-label="版本"
          placeholder="版本"
          className={filterControlClassName}
          value={versionSearch}
          onChange={(event) => setVersionSearch(event.target.value)}
        />
      </div>
      {loading ? <PageState>加载中</PageState> : null}
      {error ? <PageState>{error}</PageState> : null}
      {!loading && !error && !hasDevices ? <PageState>暂无设备</PageState> : null}
      {!loading && !error && hasDevices && filteredDevices.length === 0 ? (
        <PageState>无匹配设备</PageState>
      ) : null}
      {filteredDevices.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>账号</TableHead>
              <TableHead>激活码</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>平台</TableHead>
              <TableHead>版本</TableHead>
              <TableHead>最近</TableHead>
              <TableActionHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDevices.map((device) => (
              <TableRow key={device.id}>
                <TableCell>{device.name}</TableCell>
                <TableCell>{device.license.account.email}</TableCell>
                <TableCell>{device.license.activationCode.codeHint ?? device.license.id}</TableCell>
                <TableCell>
                  <StatusBadge status={device.status} />
                </TableCell>
                <TableCell>{device.platform}</TableCell>
                <TableCell>{device.appVersion}</TableCell>
                <TableCell>{formatDate(device.lastSeenAt)}</TableCell>
                <TableActionCell>
                  <DeviceStatusActionButtons
                    value={device.status}
                    onChange={(next) => updateDevice(device.id, next)}
                  />
                </TableActionCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
