// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DriveCodeRenderer } from './code-renderer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editorModel = {}
const editorInstance = { getModel: () => editorModel }
const bindingConstructed = vi.fn()
let collaborationHookResult: {
  session: null | {
    doc: { isDestroyed: boolean }
    text: { toString: () => string }
    awareness: object
  }
  state: null | {
    canWrite: boolean
    onlineCount: number
    status: 'synced'
    error: null
    epoch: string
  }
} = { session: null, state: null }
let forceCollaborationHookRender: (() => void) | null = null

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: ({ onMount }: { readonly onMount?: (editor: typeof editorInstance) => void }) => {
      React.useEffect(() => {
        onMount?.(editorInstance)
      }, [])
      return React.createElement('textarea', { 'data-monaco-editor': 'true' })
    },
  }
})

vi.mock('./monaco-collaboration-binding', () => ({
  createMonacoCollaborationBinding: async (...args: unknown[]) => {
    bindingConstructed(...args)
    return { destroy: vi.fn() }
  },
}))

vi.mock('../collaboration/use-drive-collaboration', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    useDriveCollaboration: () => {
      const [, forceRender] = React.useReducer((value: number) => value + 1, 0)
      forceCollaborationHookRender = forceRender
      return collaborationHookResult
    },
  }
})

vi.mock('./drive-renderer-toolbar-context', () => ({
  useRegisterDriveRendererToolbarItems: () => undefined,
  useRegisterDriveRendererUnsavedState: () => undefined,
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  collaborationHookResult = { session: null, state: null }
  forceCollaborationHookRender = null
  bindingConstructed.mockClear()
})

describe('DriveCodeRenderer collaboration binding', () => {
  it('binds an editor that mounted before the collaboration session became available', async () => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    const render = () => root?.render(
      <DriveCodeRenderer
        current={{
          id: 'item-1',
          name: 'document.md',
          type: 'file',
          size: '8',
          mimeType: 'text/markdown',
          updatedAt: '2026-08-05T00:00:00.000Z',
          previewKind: 'markdown',
          browserUrl: '/drive/items/item-1',
          downloadUrl: '/drive/items/item-1/download',
        }}
        preview={{
          kind: 'markdown',
          text: '# Initial',
          html: null,
          outline: null,
          truncated: false,
          imageUrl: null,
          visitUrl: null,
          relativeImages: [],
        }}
        collaboration={{
          enabled: true,
          canRead: true,
          canWrite: true,
          epoch: 'epoch-1',
          checkpointVersionId: 'version-1',
          websocketPath: '/api/drive/collaboration',
          reason: null,
        }}
        collaborationContext={{ kind: 'owner', itemId: 'item-1' }}
      />
    )

    await act(async () => {
      render()
    })
    expect(bindingConstructed).not.toHaveBeenCalled()

    collaborationHookResult = {
      session: {
        doc: { isDestroyed: false },
        text: { toString: () => '# Initial' },
        awareness: {},
      },
      state: { canWrite: true, onlineCount: 1, status: 'synced', error: null, epoch: 'epoch-1' },
    }
    await act(async () => {
      forceCollaborationHookRender?.()
    })
    await act(async () => {
      await vi.waitFor(() => {
        expect(bindingConstructed).toHaveBeenCalled()
      })
    })

    expect(bindingConstructed).toHaveBeenCalledWith(
      collaborationHookResult.session?.text,
      editorModel,
      expect.any(Set),
      collaborationHookResult.session?.awareness,
    )
    expect(host?.querySelector('[data-drive-collaboration-bound="true"]')).not.toBeNull()
  })
})
