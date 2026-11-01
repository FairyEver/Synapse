import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { useAuthStore } from '@/stores/auth-store'
import { cloudTableApi, type CloudCollaborator } from './cloud-table-api'

export const collaboratorName = (user: CloudCollaborator) => user.nickname ? `${user.nickname}（${user.handle}）` : user.handle

export function useCloudCollaborators(tableId: string) {
  const session = useAuthStore(s => s.auth.user?.sessionId ?? 'anonymous')
  const [input, setInput] = useState('')
  const [selected, setSelected] = useState<CloudCollaborator | null>(null)
  const term = input.trim(), debounced = useDebouncedValue(term)
  const search = useQuery({
    queryKey: ['cloud-tables', session, 'collaborators', tableId, debounced],
    queryFn: ({ signal }) => cloudTableApi.searchCollaborators(tableId, debounced, signal),
    enabled: Boolean(term && term === debounced && !selected), retry: false,
  })
  const current = term === debounced && !selected
  const users = selected ? [selected] : current ? search.data?.data ?? [] : []
  function changeInput(value: string) {
    setInput(value)
    if (selected && value !== collaboratorName(selected)) setSelected(null)
  }
  function select(id: string | null) {
    const user = users.find(u => u.id === id) ?? null
    setSelected(user)
    if (user) setInput(collaboratorName(user))
  }
  function clear() { setSelected(null); setInput('') }
  return { input, changeInput, selected, select, clear, users, search, busy: Boolean(term && !selected && (!current || search.isFetching)), failed: current && search.isError, hasMore: current && search.data?.hasMore }
}
