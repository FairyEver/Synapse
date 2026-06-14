import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DriveBrowserPasswordRequiredDto,
  DriveBrowserSnapshotDto,
  DriveBrowserSurface,
} from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'

export type DriveBrowserInput =
  | {
      context: 'owner'
      surface: DriveBrowserSurface
      rootItemId: string
      itemId?: string
    }
  | {
      context: 'share'
      shareId: string
      itemId?: string
      initialPassword?: string
    }
  | {
      context: 'console-root'
    }

export type DriveBrowserState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | {
      status: 'passwordRequired'
      message: string
      unlock: (password: string) => void
      unlocking: boolean
      unlockError: string | null
    }
  | {
      status: 'ready'
      snapshot: DriveBrowserSnapshotDto
      loadMoreChildren?: () => void
      loadingMoreChildren: boolean
      loadMoreChildrenError: string | null
    }

type DriveBrowserLoadOptions = {
  childrenOffset?: number
  childrenLimit?: number
}

export function useDriveBrowser(input: DriveBrowserInput): DriveBrowserState {
  const [unlockedSnapshot, setUnlockedSnapshot] = useState<DriveBrowserSnapshotDto | null>(null)
  const [pagedSnapshot, setPagedSnapshot] = useState<DriveBrowserSnapshotDto | null>(null)
  const queryKeyPayload = useMemo(() => toDriveBrowserQueryKey(input), [input])
  const queryKeySignature = useMemo(() => JSON.stringify(queryKeyPayload), [queryKeyPayload])
  const queryKey = useMemo(() => ['drive-browser', queryKeyPayload], [queryKeyPayload])

  useEffect(() => {
    setUnlockedSnapshot(null)
    setPagedSnapshot(null)
  }, [queryKeySignature])

  const query = useQuery({
    queryKey,
    queryFn: () => loadDriveBrowser(input),
    enabled: unlockedSnapshot === null,
  })
  const unlockMutation = useMutation({
    mutationFn: async (password: string) => {
      if (input.context !== 'share') throw new Error('当前文件不需要密码。')
      const result = await driveBrowserApi.unlockShare(input.shareId, password, input.itemId)
      if (isDriveBrowserPasswordRequired(result)) throw new Error(result.message)
      return result
    },
    onSuccess: (snapshot) => {
      setUnlockedSnapshot(snapshot)
      setPagedSnapshot(null)
    },
  })
  const loadMoreMutation = useMutation({
    mutationFn: async (snapshot: DriveBrowserSnapshotDto) => {
      const nextOffset = snapshot.childrenPage?.nextOffset
      if (nextOffset === null || nextOffset === undefined) throw new Error('没有更多文件。')
      const result = await loadDriveBrowser(input, {
        childrenOffset: nextOffset,
        childrenLimit: snapshot.childrenPage?.limit,
      })
      if (isDriveBrowserPasswordRequired(result)) throw new Error(result.message)
      return result
    },
    onSuccess: (nextSnapshot) => {
      if (unlockedSnapshot) {
        setUnlockedSnapshot((current) => current ? mergeDriveBrowserSnapshots(current, nextSnapshot) : nextSnapshot)
        return
      }
      setPagedSnapshot((current) => {
        const baseSnapshot = current ?? (isDriveBrowserPasswordRequired(query.data) ? null : query.data) ?? nextSnapshot
        return mergeDriveBrowserSnapshots(baseSnapshot, nextSnapshot)
      })
    },
  })

  const querySnapshot = isDriveBrowserPasswordRequired(query.data) ? null : query.data
  const snapshot = unlockedSnapshot ?? pagedSnapshot ?? querySnapshot
  if (snapshot) {
    return {
      status: 'ready',
      snapshot,
      loadMoreChildren: snapshot.childrenPage?.hasMore
        ? () => loadMoreMutation.mutate(snapshot)
        : undefined,
      loadingMoreChildren: loadMoreMutation.isPending,
      loadMoreChildrenError: loadMoreMutation.error ? getErrorMessage(loadMoreMutation.error) : null,
    }
  }
  if (query.isLoading) return { status: 'loading' }
  if (query.isError) return { status: 'error', message: getErrorMessage(query.error) }
  if (isDriveBrowserPasswordRequired(query.data)) {
    return {
      status: 'passwordRequired',
      message: query.data.message,
      unlock: (password) => unlockMutation.mutate(password),
      unlocking: unlockMutation.isPending,
      unlockError: unlockMutation.error ? getErrorMessage(unlockMutation.error) : null,
    }
  }
  return { status: 'loading' }
}

export function toDriveBrowserQueryKey(input: DriveBrowserInput) {
  if (input.context !== 'share') return input
  return {
    context: input.context,
    shareId: input.shareId,
    itemId: input.itemId,
    initialPasswordFingerprint: fingerprintInitialPassword(input.initialPassword),
  }
}

function fingerprintInitialPassword(value: string | undefined) {
  if (!value) return null
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash.toString(36)
}

export async function loadDriveBrowser(input: DriveBrowserInput, options: DriveBrowserLoadOptions = {}) {
  if (input.context === 'console-root') return driveBrowserApi.getConsoleRoot(options)
  if (input.context === 'owner') {
    return input.itemId
      ? driveBrowserApi.getOwnerChild(input.rootItemId, input.itemId, input.surface, options)
      : driveBrowserApi.getOwnerRoot(input.rootItemId, input.surface, options)
  }
  if (input.initialPassword) {
    return driveBrowserApi.unlockShare(input.shareId, input.initialPassword, input.itemId, options)
  }
  return input.itemId
    ? driveBrowserApi.getShareItem(input.shareId, input.itemId, options)
    : driveBrowserApi.getShareRoot(input.shareId, options)
}

export function isDriveBrowserPasswordRequired(
  value: DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto | undefined
): value is DriveBrowserPasswordRequiredDto {
  return Boolean(value && 'passwordRequired' in value && value.passwordRequired)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '加载失败'
}

function mergeDriveBrowserSnapshots(
  current: DriveBrowserSnapshotDto,
  next: DriveBrowserSnapshotDto
): DriveBrowserSnapshotDto {
  return {
    ...next,
    children: [...current.children, ...next.children],
  }
}
