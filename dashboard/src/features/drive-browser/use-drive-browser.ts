import { useMemo, useState } from 'react'
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
  | { status: 'ready'; snapshot: DriveBrowserSnapshotDto }

export function useDriveBrowser(input: DriveBrowserInput): DriveBrowserState {
  const [unlockedSnapshot, setUnlockedSnapshot] = useState<DriveBrowserSnapshotDto | null>(null)
  const queryKey = useMemo(() => ['drive-browser', toDriveBrowserQueryKey(input)], [input])
  const query = useQuery({
    queryKey,
    queryFn: () => loadDriveBrowser(input),
    enabled: unlockedSnapshot === null,
  })
  const unlockMutation = useMutation({
    mutationFn: (password: string) => {
      if (input.context !== 'share') throw new Error('当前文件不需要密码。')
      return driveBrowserApi.unlockShare(input.shareId, password)
    },
    onSuccess: (snapshot) => {
      setUnlockedSnapshot(snapshot)
    },
  })

  if (unlockedSnapshot) return { status: 'ready', snapshot: unlockedSnapshot }
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
  if (query.data) return { status: 'ready', snapshot: query.data }
  return { status: 'loading' }
}

function toDriveBrowserQueryKey(input: DriveBrowserInput) {
  if (input.context !== 'share') return input
  return {
    context: input.context,
    shareId: input.shareId,
    itemId: input.itemId,
    hasInitialPassword: Boolean(input.initialPassword),
  }
}

async function loadDriveBrowser(input: DriveBrowserInput) {
  if (input.context === 'console-root') return driveBrowserApi.getConsoleRoot()
  if (input.context === 'owner') {
    return input.itemId
      ? driveBrowserApi.getOwnerChild(input.rootItemId, input.itemId, input.surface)
      : driveBrowserApi.getOwnerRoot(input.rootItemId, input.surface)
  }
  return input.itemId
    ? driveBrowserApi.getShareItem(input.shareId, input.itemId, input.initialPassword)
    : driveBrowserApi.getShareRoot(input.shareId, input.initialPassword)
}

export function isDriveBrowserPasswordRequired(
  value: DriveBrowserSnapshotDto | DriveBrowserPasswordRequiredDto | undefined
): value is DriveBrowserPasswordRequiredDto {
  return Boolean(value && 'passwordRequired' in value && value.passwordRequired)
}

function getErrorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : '加载失败'
}
