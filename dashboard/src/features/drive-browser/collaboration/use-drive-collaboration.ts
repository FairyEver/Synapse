import { useEffect, useState, useSyncExternalStore } from 'react'
import type { DriveBrowserCollaborationCapabilityDto, DriveCollaborationJoinContext } from '@synapse/shared'
import { DriveCollaborationSession } from './drive-collaboration-session'

export function useDriveCollaboration(input: {
  readonly itemId: string
  readonly context: DriveCollaborationJoinContext
  readonly capability: DriveBrowserCollaborationCapabilityDto | null | undefined
  readonly onEpochReloadRequired?: () => void
}): { readonly session: DriveCollaborationSession | null; readonly state: ReturnType<DriveCollaborationSession['getSnapshot']> | null } {
  const contextKey = input.context.kind === 'owner'
    ? `owner:${input.context.itemId}`
    : `share:${input.context.shareId}:${input.context.itemId ?? ''}`
  const capabilityKey = input.capability
    ? `${input.capability.enabled}:${input.capability.epoch ?? ''}:${input.capability.checkpointVersionId ?? ''}:${input.capability.canWrite}`
    : 'none'
  const sessionKey = `${input.itemId}:${contextKey}:${capabilityKey}`
  const [entry, setEntry] = useState<{
    readonly key: string
    readonly session: DriveCollaborationSession
  } | null>(null)
  const session = entry?.key === sessionKey ? entry.session : null
  const state = useSyncExternalStore(
    session?.subscribe ?? emptySubscribe,
    session?.getSnapshot ?? nullSnapshot,
    session?.getSnapshot ?? nullSnapshot,
  )

  useEffect(() => {
    if (!input.capability?.enabled) {
      setEntry(null)
      return
    }
    const nextSession = new DriveCollaborationSession({
      itemId: input.itemId,
      context: input.context,
      capability: input.capability,
      onEpochReloadRequired: input.onEpochReloadRequired,
    })
    setEntry({ key: sessionKey, session: nextSession })
    void nextSession.connect()
    return nextSession.destroy
  }, [capabilityKey, contextKey, input.itemId, sessionKey])

  return { session, state }
}

function emptySubscribe(): () => void {
  return () => undefined
}

function nullSnapshot(): null {
  return null
}
