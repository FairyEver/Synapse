import { PageState } from "@/components/page-state"
import { DeviceStatusSelect, ManagedStatusSelect } from "@/components/status-select"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type DeviceStatus, type ManagedStatus } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function AccountDetailPage({ accountId }: { readonly accountId: string }) {
  const { data, error, loading, reload } = useApiResource(
    () => adminApi.getAccount(accountId),
    [accountId],
  )

  async function updateLicense(id: string, status: ManagedStatus) {
    await adminApi.updateLicense(id, status)
    reload()
  }

  async function updateDevice(id: string, status: DeviceStatus) {
    await adminApi.updateDevice(id, status)
    reload()
  }

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data) return <PageState>未找到账号</PageState>

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="grid gap-1">
          <div className="text-base font-medium">{data.email}</div>
          <div className="text-sm text-muted-foreground">{formatDate(data.createdAt)}</div>
        </div>
        <Button asChild variant="outline">
          <a href="#/accounts">返回</a>
        </Button>
      </div>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">授权</h2>
        {!data.licenses.length ? <PageState>暂无授权</PageState> : null}
        {data.licenses.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">设备数</TableHead>
                <TableHead>到期</TableHead>
                <TableHead>创建</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.licenses.map((license) => (
                <TableRow key={license.id}>
                  <TableCell>
                    <StatusBadge status={license.status} />
                  </TableCell>
                  <TableCell className="text-right">{license.maxDevices}</TableCell>
                  <TableCell>{formatDate(license.expiresAt)}</TableCell>
                  <TableCell>{formatDate(license.createdAt)}</TableCell>
                  <TableCell>
                    <ManagedStatusSelect
                      value={license.status}
                      onChange={(next) => updateLicense(license.id, next)}
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </section>

      <section className="grid gap-3">
        <h2 className="text-sm font-medium">设备</h2>
        {!data.licenses.some((license) => license.devices.length > 0) ? (
          <PageState>暂无设备</PageState>
        ) : null}
        {data.licenses.map((license) =>
          license.devices.length ? (
            <Table key={license.id}>
              <TableHeader>
                <TableRow>
                  <TableHead>名称</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead>平台</TableHead>
                  <TableHead>版本</TableHead>
                  <TableHead>最近</TableHead>
                  <TableHead>操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {license.devices.map((device) => (
                  <TableRow key={device.id}>
                    <TableCell>{device.name}</TableCell>
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
          ) : null,
        )}
      </section>
    </div>
  )
}
