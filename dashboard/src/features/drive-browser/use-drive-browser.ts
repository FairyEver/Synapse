import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import type {
  DriveBrowserPasswordRequiredDto,
  DriveBrowserSnapshotDto,
  DriveBrowserSurface,
  DriveFileContentUpdateResult,
} from '@synapse/shared'
import { driveBrowserApi } from '@/lib/api'

export type DriveBrowserInput =
  | {
      context: 'owner'
      surface: DriveBrowserSurface
      itemId: string
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
      reload: () => Promise<DriveBrowserSnapshotDto>
      reloading: boolean
      saveText: (input: { readonly text: string; readonly baseVersionId: string }) => Promise<DriveFileContentUpdateResult>
      savingText: boolean
    }

type DriveBrowserLoadOptions = {
  childrenOffset?: number
  childrenLimit?: number
}

export function useDriveBrowser(input: DriveBrowserInput): DriveBrowserState {
  const [unlockedSnapshot, setUnlockedSnapshot] = useState<DriveBrowserSnapshotDto | null>(null)
  const [pagedSnapshot, setPagedSnapshot] = useState<DriveBrowserSnapshotDto | null>(null)
  const loadingChildrenPageKeyRef = useRef<string | null>(null)
  const queryKeyPayload = useMemo(() => toDriveBrowserQueryKey(input), [input])
  const queryKeySignature = useMemo(() => JSON.stringify(queryKeyPayload), [queryKeyPayload])
  const queryKey = useMemo(() => ['drive-browser', queryKeyPayload], [queryKeyPayload])

  const query = useQuery({
    queryKey,
    queryFn: () => loadDriveBrowser(input),
    enabled: unlockedSnapshot === null,
  })
  const unlockMutation = useMutation({
    mutationFn: async (password: string) => {
      if (input.context !== 'share') throw new Error('当前文件不需要密码。')
      const result = await driveBrowserApi.unlockShare(input.shareId, password, input.itemId)
      return requireDriveBrowserSnapshot(result)
    },
    onSuccess: (snapshot) => {
      setUnlockedSnapshot(snapshot)
      setPagedSnapshot(null)
    },
  })
  const loadMoreMutation = useMutation({
    mutationFn: async (variables: { readonly snapshot: DriveBrowserSnapshotDto; readonly pageKey: string }) => {
      const snapshot = variables.snapshot
      const nextOffset = snapshot.childrenPage?.nextOffset
      if (nextOffset === null || nextOffset === undefined) throw new Error('没有更多文件。')
      const result = await loadDriveBrowser(input, {
        childrenOffset: nextOffset,
        childrenLimit: snapshot.childrenPage?.limit,
      })
      return requireDriveBrowserSnapshot(result)
    },
    onSettled: (_data, _error, variables) => {
      if (loadingChildrenPageKeyRef.current === variables.pageKey) {
        loadingChildrenPageKeyRef.current = null
      }
    },
    onSuccess: (nextSnapshot) => {
      if (unlockedSnapshot) {
        setUnlockedSnapshot((current) => current ? mergeDriveBrowserSnapshots(current, nextSnapshot) : nextSnapshot)
        return
      }
      setPagedSnapshot((current) => {
        const baseSnapshot = current ?? toDriveBrowserSnapshot(query.data) ?? nextSnapshot
        return mergeDriveBrowserSnapshots(baseSnapshot, nextSnapshot)
      })
    },
  })
  useEffect(() => {
    setUnlockedSnapshot(null)
    setPagedSnapshot(null)
    loadingChildrenPageKeyRef.current = null
    loadMoreMutation.reset()
  }, [queryKeySignature])

  const querySnapshot = toDriveBrowserSnapshot(query.data)
  const snapshot = unlockedSnapshot ?? pagedSnapshot ?? querySnapshot
  const reloadMutation = useMutation({
    mutationFn: async () => requireDriveBrowserSnapshot(await loadDriveBrowser(input)),
    onSuccess: (nextSnapshot) => {
      if (input.context === 'share') {
        setUnlockedSnapshot(nextSnapshot)
      } else {
        setPagedSnapshot(nextSnapshot)
      }
    },
  })
  const saveTextMutation = useMutation({
    mutationFn: async (variables: {
      readonly snapshot: DriveBrowserSnapshotDto
      readonly text: string
      readonly baseVersionId: string
    }) => {
      const result = await saveDriveBrowserText(input, variables.snapshot, {
        text: variables.text,
        baseVersionId: variables.baseVersionId,
      })
      const nextSnapshot = requireDriveBrowserSnapshot(await loadDriveBrowser(input))
      if (input.context === 'share') {
        setUnlockedSnapshot(nextSnapshot)
      } else {
        setPagedSnapshot(nextSnapshot)
      }
      return result
    },
  })
  if (snapshot) {
    return {
      status: 'ready',
      snapshot,
      loadMoreChildren: snapshot.childrenPage?.hasMore
        ? () => {
            const pageKey = driveBrowserChildrenPageKey(snapshot)
            if (loadingChildrenPageKeyRef.current === pageKey) return
            loadingChildrenPageKeyRef.current = pageKey
            loadMoreMutation.mutate({ snapshot, pageKey })
          }
        : undefined,
      loadingMoreChildren: loadMoreMutation.isPending,
      loadMoreChildrenError: loadMoreMutation.error ? getErrorMessage(loadMoreMutation.error) : null,
      reload: () => reloadMutation.mutateAsync(),
      reloading: reloadMutation.isPending,
      saveText: (variables) => saveTextMutation.mutateAsync({ snapshot, ...variables }),
      savingText: saveTextMutation.isPending,
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

async function saveDriveBrowserText(
  input: DriveBrowserInput,
  snapshot: DriveBrowserSnapshotDto,
  variables: { readonly text: string; readonly baseVersionId: string }
) {
  const body = {
    contentType: 'text' as const,
    text: variables.text,
    baseVersionId: variables.baseVersionId,
  }
  if (input.context === 'owner') {
    return driveBrowserApi.updateOwnerText(snapshot.current.id, body)
  }
  if (input.context === 'share') {
    const rootItemId = snapshot.breadcrumbs[0]?.id ?? snapshot.current.id
    return driveBrowserApi.updateShareText(
      input.shareId,
      snapshot.current.id === rootItemId ? null : snapshot.current.id,
      body
    )
  }
  throw new Error('当前文件不支持保存。')
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
    return driveBrowserApi.getOwnerItem(input.itemId, input.surface, options)
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

function toDriveBrowserSnapshot(
  value: DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto | undefined
): DriveBrowserSnapshotDto | null {
  if (!value || isDriveBrowserPasswordRequired(value)) return null
  return value
}

function requireDriveBrowserSnapshot(
  value: DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto
): DriveBrowserSnapshotDto {
  if (isDriveBrowserPasswordRequired(value)) throw new Error(value.message)
  return value
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

function driveBrowserChildrenPageKey(snapshot: DriveBrowserSnapshotDto): string {
  return [
    snapshot.context,
    snapshot.surface,
    snapshot.current.id,
    snapshot.childrenPage?.nextOffset ?? '',
    snapshot.childrenPage?.limit ?? '',
  ].join(':')
}
