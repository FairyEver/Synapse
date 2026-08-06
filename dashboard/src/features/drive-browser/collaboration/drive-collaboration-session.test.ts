// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { DriveCollaborationControlMessage } from '@synapse/shared'
import { DriveCollaborationSession } from './drive-collaboration-session'

describe('DriveCollaborationSession epoch replacement', () => {
  it('reloads a reliably synchronized client into the replacement epoch', () => {
    const onEpochReloadRequired = vi.fn()
    const session = createSession(onEpochReloadRequired)

    sendControl(session, joinedMessage)
    sendControl(session, {
      type: 'durable_ack',
      epoch: 'epoch-1',
      sequence: '1',
      updateId: 'update-1',
    })
    sendControl(session, {
      type: 'epoch_replaced',
      epoch: 'epoch-2',
      checkpointVersionId: 'version-2',
    })

    expect(onEpochReloadRequired).toHaveBeenCalledOnce()
    expect(session.getSnapshot()).toMatchObject({
      epoch: 'epoch-2',
      checkpointVersionId: 'version-2',
      epochTransition: 'reload',
      error: null,
    })
    session.destroy()
  })

  it('preserves a client that still has unconfirmed local updates', () => {
    const onEpochReloadRequired = vi.fn()
    const session = createSession(onEpochReloadRequired)

    sendControl(session, joinedMessage)
    sendControl(session, {
      type: 'epoch_replaced',
      epoch: 'epoch-2',
      checkpointVersionId: 'version-2',
    })

    expect(onEpochReloadRequired).not.toHaveBeenCalled()
    expect(session.getSnapshot()).toMatchObject({
      epochTransition: 'preserve_local',
      error: '文件已切换到新的协同代际，本地副本已保留。',
    })
    session.destroy()
  })
})

const joinedMessage: DriveCollaborationControlMessage = {
  type: 'joined',
  protocolVersion: 1,
  itemId: 'item-1',
  epoch: 'epoch-1',
  checkpointVersionId: 'version-1',
  canWrite: true,
  durableSequence: '0',
}

function createSession(onEpochReloadRequired: () => void): DriveCollaborationSession {
  return new DriveCollaborationSession({
    itemId: 'item-1',
    context: { kind: 'owner', itemId: 'item-1' },
    capability: {
      enabled: true,
      canRead: true,
      canWrite: true,
      epoch: 'epoch-1',
      checkpointVersionId: 'version-1',
      websocketPath: '/api/drive/collaboration',
      reason: null,
    },
    onEpochReloadRequired,
  })
}

function sendControl(session: DriveCollaborationSession, message: DriveCollaborationControlMessage): void {
  const target = session as unknown as { handleControl: (message: DriveCollaborationControlMessage) => void }
  target.handleControl(message)
}
