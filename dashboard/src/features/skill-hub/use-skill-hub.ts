import { useInfiniteQuery, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useEffect } from 'react'
import type { SkillHubListInput, SkillHubPage } from '@synapse/shared/skill-hub-contracts'
import { useAuthStore } from '@/stores/auth-store'
import { loadHubTeams, skillHubApi } from './skill-hub-api'

export const hubScope = (session: string) => ['skill-hub', session] as const

export function useSkillHubSession() {
  const session = useAuthStore((s) => s.auth.user?.sessionId ?? '')
  const cache = useQueryClient()
  useEffect(() => useAuthStore.subscribe((state, previous) => {
    const old = previous.auth.user?.sessionId
    if (!old || state.auth.user?.sessionId === old) return
    void cache.cancelQueries({ queryKey: hubScope(old) })
    cache.removeQueries({ queryKey: hubScope(old) })
  }), [cache])
  return session
}

export function useSkillHubTeams(session: string) {
  return useQuery({ queryKey: [...hubScope(session), 'teams'], enabled: !!session, staleTime: 0, retry: false,
    queryFn: ({ signal }) => loadHubTeams(session, signal) })
}

export function useSkillHubCatalog(session: string, filters: SkillHubListInput) {
  return useInfiniteQuery<SkillHubPage, Error, InfiniteData<SkillHubPage>, readonly unknown[], string | undefined>({ queryKey: [...hubScope(session), 'catalog', filters], enabled: !!session, staleTime: 0, retry: false,
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    queryFn: ({ signal, pageParam }) => skillHubApi.list(session, { ...filters, cursor: pageParam }, signal) })
}

export function useSkillHubDetail(session: string, id: string) {
  return useQuery({ queryKey: [...hubScope(session), 'skill', id], enabled: !!session, staleTime: 0, retry: false,
    queryFn: ({ signal }) => skillHubApi.get(session, id, signal) })
}

export function useSkillHubMain(session: string, id: string, version: string, enabled: boolean) {
  return useQuery({ queryKey: [...hubScope(session), 'main', id, version], enabled: !!session && enabled, retry: false,
    queryFn: ({ signal }) => skillHubApi.main(session, id, version, signal) })
}

export function useSkillHubFilePreview(session: string, id: string, version: string, path: string) {
  return useQuery({ queryKey: [...hubScope(session), 'file', id, version, path], enabled: !!session, gcTime: 0, retry: false,
    refetchOnWindowFocus: false, refetchOnReconnect: false,
    queryFn: ({ signal }) => skillHubApi.preview(session, id, version, path, signal) })
}
