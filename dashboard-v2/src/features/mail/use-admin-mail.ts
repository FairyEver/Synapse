import { useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import type { SortingState } from '@tanstack/react-table'
import { adminApi, type AdminMailListOptions } from '@/lib/api'
import { DEFAULT_DASHBOARD_PAGE_SIZE, getServerTableSortQuery } from '@/components/data-table'

export type MailSearch = {
  page?: number
  pageSize?: number
  sortBy?: 'sentAt' | 'subject' | 'kind'
  sortOrder?: 'asc' | 'desc'
  search?: string
  kind?: 'user' | 'platform_broadcast'
  teamId?: string
  from?: string
  to?: string
}

export function useAdminMail(search: MailSearch) {
  const [page, setPage] = useState(search.page ?? 1)
  const [pageSize, setPageSize] = useState(search.pageSize ?? DEFAULT_DASHBOARD_PAGE_SIZE)
  const [sorting, setSorting] = useState<SortingState>([
    { id: search.sortBy ?? 'sentAt', desc: search.sortOrder !== 'asc' },
  ])
  const [query, setQuery] = useState(search.search ?? '')
  const [kind, setKind] = useState(search.kind ?? '')
  const [teamId, setTeamId] = useState(search.teamId ?? '')
  const [from, setFrom] = useState(search.from ?? '')
  const [to, setTo] = useState(search.to ?? '')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sortQuery = getServerTableSortQuery(sorting)
  const listOptions: AdminMailListOptions = {
    page,
    pageSize,
    ...sortQuery,
    search: query || undefined,
    kind: kind === 'user' || kind === 'platform_broadcast' ? kind : undefined,
    teamId: teamId || undefined,
    from: from || undefined,
    to: to || undefined,
  }

  const listQuery = useQuery({
    queryKey: ['admin-mail-messages', listOptions],
    queryFn: () => adminApi.listMailMessages(listOptions),
  })
  const detailQuery = useQuery({
    queryKey: ['admin-mail-message', selectedId],
    queryFn: () => adminApi.getMailMessage(selectedId!),
    enabled: selectedId !== null,
  })
  const contextQuery = useInfiniteQuery({
    queryKey: ['admin-mail-context', selectedId],
    queryFn: ({ pageParam }) => adminApi.listMailContext(selectedId!, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: selectedId !== null,
  })
  const teamsQuery = useQuery({
    queryKey: ['admin-mail-teams'],
    queryFn: () => adminApi.listTeams({ page: 1, pageSize: 100, sortBy: 'name', sortOrder: 'asc' }),
  })

  function resetPage() { setPage(1) }
  const contextItems = contextQuery.data?.pages.slice().reverse().flatMap((item) => item.items) ?? []
  return {
    page, setPage, pageSize, setPageSize, sorting, setSorting, query, setQuery,
    kind, setKind, teamId, setTeamId, from, setFrom, to, setTo, resetPage,
    selectedId, setSelectedId, listQuery, detailQuery, contextQuery, teamsQuery, contextItems,
  }
}
