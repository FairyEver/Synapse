import { PageState } from "@/components/page-state"
import { DeviceStatusSelect } from "@/components/status-select"
import { StatusBadge } from "@/components/status-badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type DeviceStatus } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function DevicesPage() {
  const { data, error, loading, reload } = useApiResource(adminApi.listDevices)

  async function updateDevice(id: string, status: DeviceStatus) {
    await adminApi.updateDevice(id, status)
    reload()
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data?.length) return <PageState>暂无设备</PageState>

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>名称</TableHead>
          <TableHead>账号</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>平台</TableHead>
          <TableHead>版本</TableHead>
          <TableHead>最近</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((device) => (
          <TableRow key={device.id}>
            <TableCell>{device.name}</TableCell>
            <TableCell>{device.license.account.email}</TableCell>
            <TableCell>
              <StatusBadge status={device.status} />
            </TableCell>
            <TableCell>{device.platform}</TableCell>
            <TableCell>{device.appVersion}</TableCell>
            <TableCell>{formatDate(device.lastSeenAt)}</TableCell>
            <TableCell>
              <DeviceStatusSelect
                value={device.status}
                onChange={(next) => updateDevice(device.id, next)}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
