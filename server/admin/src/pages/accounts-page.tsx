import { PageState } from "@/components/page-state"
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
import { adminApi } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function AccountsPage() {
  const { data, error, loading } = useApiResource(adminApi.listAccounts)

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!data?.length) return <PageState>暂无账号</PageState>

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>邮箱</TableHead>
          <TableHead>状态</TableHead>
          <TableHead className="text-right">授权</TableHead>
          <TableHead className="text-right">设备</TableHead>
          <TableHead>创建</TableHead>
          <TableHead>操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {data.map((account) => {
          const deviceCount = account.licenses.reduce(
            (total, license) => total + license.devices.length,
            0,
          )
          return (
            <TableRow key={account.id}>
              <TableCell>{account.email}</TableCell>
              <TableCell>
                <StatusBadge status={account.status} />
              </TableCell>
              <TableCell className="text-right">{account.licenses.length}</TableCell>
              <TableCell className="text-right">{deviceCount}</TableCell>
              <TableCell>{formatDate(account.createdAt)}</TableCell>
              <TableCell>
                <Button asChild variant="outline" size="sm">
                  <a href={`#/accounts/${account.id}`}>详情</a>
                </Button>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
