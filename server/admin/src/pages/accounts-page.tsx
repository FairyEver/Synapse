import * as React from "react"
import { PageState } from "@/components/page-state"
import { StatusBadge } from "@/components/status-badge"
import {
  TableActionButton,
  TableActionCell,
  TableActionGroup,
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
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi } from "@/lib/api"
import { includesSearch } from "@/lib/filter"
import { formatDate } from "@/lib/format"

const filterControlClassName = "w-32 shrink-0"

export function AccountsPage() {
  const { data, error, loading } = useApiResource(adminApi.listAccounts)
  const [emailSearch, setEmailSearch] = React.useState("")
  const accounts = data ?? []
  const filteredAccounts = React.useMemo(
    () => accounts.filter((account) => includesSearch(account.email, emailSearch)),
    [accounts, emailSearch],
  )

  const hasAccounts = accounts.length > 0

  return (
    <div className="grid gap-4">
      <div className="-mx-1 flex flex-nowrap items-center gap-2 overflow-x-auto px-1 py-1">
        <Input
          id="account-email-search"
          aria-label="邮箱"
          placeholder="邮箱"
          className={filterControlClassName}
          value={emailSearch}
          onChange={(event) => setEmailSearch(event.target.value)}
        />
      </div>
      {loading ? <PageState>加载中</PageState> : null}
      {error ? <PageState>{error}</PageState> : null}
      {!loading && !error && !hasAccounts ? <PageState>暂无账号</PageState> : null}
      {!loading && !error && hasAccounts && filteredAccounts.length === 0 ? (
        <PageState>无匹配账号</PageState>
      ) : null}
      {filteredAccounts.length > 0 ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>邮箱</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right">授权</TableHead>
              <TableHead className="text-right">设备</TableHead>
              <TableHead>创建</TableHead>
              <TableActionHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAccounts.map((account) => {
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
                  <TableActionCell>
                    <TableActionGroup>
                      <TableActionButton asChild>
                        <a href={`#/accounts/${account.id}`}>详情</a>
                      </TableActionButton>
                    </TableActionGroup>
                  </TableActionCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      ) : null}
    </div>
  )
}
