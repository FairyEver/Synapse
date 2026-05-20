import { PageState } from "@/components/page-state"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi } from "@/lib/api"
import { formatCount, formatDate } from "@/lib/format"

export function SystemPage() {
  const { data, error, loading } = useApiResource(adminApi.getSystemOverview)

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data) return <PageState>暂无数据</PageState>

  const items = [
    { label: "激活码", value: data.counts.activationCodes, active: data.counts.activeActivationCodes },
    { label: "账号", value: data.counts.accounts, active: data.counts.activeAccounts },
    { label: "授权", value: data.counts.licenses, active: data.counts.activeLicenses },
    { label: "设备", value: data.counts.devices, active: data.counts.activeDevices },
    { label: "租约", value: data.counts.leases, active: null },
  ]

  return (
    <div className="grid gap-4">
      <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-5">
        {items.map((item) => (
          <Card key={item.label} size="sm">
            <CardHeader>
              <CardTitle>{item.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold">{formatCount(item.value)}</div>
              {item.active === null ? null : (
                <div className="text-sm text-muted-foreground">启用 {formatCount(item.active)}</div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="text-sm text-muted-foreground">服务器时间：{formatDate(data.serverTime)}</div>
    </div>
  )
}
