import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from '@heroui/react'
import type { StateSyncRole } from '@synapse/shared/state-sync-contracts'
import { useAuthStore } from '@/stores/auth-store'
import { stateSyncApi, type StateSyncSpaceSummary } from './state-sync-api'

export type StateSyncDialogState =
  | null
  | { kind: 'createSpace' }
  | { kind: 'deleteSpace' }
  | { kind: 'deleteSpaceFromList'; space: StateSyncSpaceSummary }

export function useStateSync() {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? 'anonymous')
  const cache = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState('debugger')
  const [dialog, setDialog] = useState<StateSyncDialogState>(null)

  useEffect(() => () => {
    void cache.cancelQueries({ queryKey: ['state-sync', session] })
  }, [cache, session])

  const spaces = useQuery({
    queryKey: ['state-sync', session, 'list'],
    queryFn: ({ signal }) => stateSyncApi.listSpaces(signal),
  })

  const detail = useQuery({
    queryKey: ['state-sync', session, 'detail', selectedId],
    queryFn: ({ signal }) => stateSyncApi.getSpace(selectedId!, signal),
    enabled: Boolean(selectedId),
  })

  const docs = useQuery({
    queryKey: ['state-sync', session, 'docs', selectedId],
    queryFn: ({ signal }) => stateSyncApi.listDocs(selectedId!, { limit: 100 }, signal),
    enabled: Boolean(selectedId && tab === 'debugger'),
  })

  const tokens = useQuery({
    queryKey: ['state-sync', session, 'tokens', selectedId],
    queryFn: ({ signal }) => stateSyncApi.listTokens(selectedId!, signal),
    enabled: Boolean(selectedId && tab === 'tokens'),
  })

  const invalidate = () => void cache.invalidateQueries({ queryKey: ['state-sync', session] })

  const createSpace = useMutation({
    mutationFn: (body: {
      name: string
      description: string
      defaultDocTtlSeconds?: number | null
      maxDocs?: number
    }) => stateSyncApi.createSpace(body),
    onSuccess: (created) => {
      setDialog(null)
      setSelectedId(created.id)
      setTab('debugger')
      invalidate()
      toast.success('同步空间已创建')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const updateSpace = useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: string
      body: {
        name?: string
        description?: string
        defaultDocTtlSeconds?: number | null
        maxDocs?: number
      }
    }) => stateSyncApi.updateSpace(id, body),
    onSuccess: () => {
      invalidate()
      toast.success('设置已保存')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const deleteSpace = useMutation({
    mutationFn: (id: string) => stateSyncApi.deleteSpace(id),
    onSuccess: (_result, deletedId) => {
      setDialog(null)
      if (selectedId === deletedId) setSelectedId(null)
      invalidate()
      toast.success('同步空间已删除')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const createToken = useMutation({
    mutationFn: ({ id, body }: { id: string; body: { name: string; role: StateSyncRole } }) =>
      stateSyncApi.createToken(id, body),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.danger(e.message),
  })

  const revokeToken = useMutation({
    mutationFn: ({ id, tokenId }: { id: string; tokenId: string }) =>
      stateSyncApi.revokeToken(id, tokenId),
    onSuccess: () => {
      invalidate()
      toast.success('凭证已撤销')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const createDoc = useMutation({
    mutationFn: ({
      spaceId,
      body,
    }: {
      spaceId: string
      body: { docId?: string; initialData?: Record<string, unknown>; ttlSeconds?: number | null }
    }) => stateSyncApi.createDoc(spaceId, body),
    onSuccess: () => {
      invalidate()
      toast.success('房间已创建')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  const deleteDoc = useMutation({
    mutationFn: ({ spaceId, docId }: { spaceId: string; docId: string }) =>
      stateSyncApi.deleteDoc(spaceId, docId),
    onSuccess: () => {
      invalidate()
      toast.success('房间已删除')
    },
    onError: (e: Error) => toast.danger(e.message),
  })

  return {
    selectedId,
    select: (id: string | null) => {
      setSelectedId(id)
      setTab('debugger')
    },
    tab,
    setTab,
    dialog,
    setDialog,
    spaces,
    detail,
    docs,
    tokens,
    invalidate,
    createSpace,
    updateSpace,
    deleteSpace,
    createToken,
    revokeToken,
    createDoc,
    deleteDoc,
  }
}

export type StateSyncModel = ReturnType<typeof useStateSync>
