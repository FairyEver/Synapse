import * as React from "react"
import { PageState } from "@/components/page-state"
import { PaginationFooter } from "@/components/pagination-footer"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useApiResource } from "@/hooks/use-api-resource"
import { adminApi, type AdminTeamRow, type PaginatedResponse } from "@/lib/api"
import { formatDate } from "@/lib/format"

export function TeamsPage() {
  const [page, setPage] = React.useState(1)
  const { data: result, error, loading } = useApiResource<PaginatedResponse<AdminTeamRow>>(
    () => adminApi.listTeams({ page }),
    [page],
  )

  if (loading) return <PageState>加载中</PageState>
  if (error) return <PageState>{error}</PageState>
  if (!result || result.data.length === 0) return <PageState>暂无团队</PageState>

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead className="text-right">成员数</TableHead>
            <TableHead>创建时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((team) => (
            <TableRow key={team.id}>
              <TableCell>{team.name}</TableCell>
              <TableCell>{team.createdByUser.email}</TableCell>
              <TableCell className="text-right">{team.memberships.length}</TableCell>
              <TableCell>{formatDate(team.createdAt)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <PaginationFooter
        page={result.page}
        pageSize={result.pageSize}
        total={result.total}
        onPageChange={setPage}
      />
    </div>
  )
}
