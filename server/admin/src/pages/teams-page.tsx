import * as React from "react"
import { PageState } from "@/components/page-state"
import { PaginationFooter } from "@/components/pagination-footer"
import { Badge } from "@/components/ui/badge"
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

const teamRoleLabels = {
  owner: "所有者",
  member: "成员",
} as const

function formatTeamRole(role: AdminTeamRow["memberships"][number]["role"]): string {
  return teamRoleLabels[role]
}

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
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>Owner</TableHead>
            <TableHead>成员</TableHead>
            <TableHead>创建时间</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.data.map((team) => (
            <TableRow key={team.id}>
              <TableCell>{team.name}</TableCell>
              <TableCell>{team.createdByUser.email}</TableCell>
              <TableCell className="min-w-64 whitespace-normal">
                <div className="flex flex-col gap-1">
                  {team.memberships.map((membership) => (
                    <div
                      key={`${membership.user.email}-${membership.role}-${membership.createdAt}`}
                      className="flex min-w-0 items-center gap-2"
                    >
                      <span className="truncate">{membership.user.email}</span>
                      <Badge variant="outline" className="shrink-0">{formatTeamRole(membership.role)}</Badge>
                    </div>
                  ))}
                </div>
              </TableCell>
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
