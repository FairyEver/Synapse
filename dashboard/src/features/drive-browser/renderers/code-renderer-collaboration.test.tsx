// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { driveBrowserApi } from '@/lib/api'
import { DriveCodeRenderer } from './code-renderer'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const editorModel = {}
const ctrlCmd = 1 << 11
const keyS = 49
let saveCommand: { readonly keybinding: number; readonly handler: () => void } | null = null
const editorInstance = {
  getModel: () => editorModel,
  addCommand: (keybinding: number, handler: () => void) => {
    saveCommand = { keybinding, handler }
    return 'drive-save-version'
  },
}
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
let registeredToolbarItems: readonly { readonly id: string; readonly ariaKeyShortcuts?: string }[] = []

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: ({ onMount }: {
      readonly onMount?: (
        editor: typeof editorInstance,
        monaco: { KeyMod: { CtrlCmd: number }; KeyCode: { KeyS: number } },
      ) => void
    }) => {
      React.useEffect(() => {
        onMount?.(editorInstance, { KeyMod: { CtrlCmd: ctrlCmd }, KeyCode: { KeyS: keyS } })
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
  useRegisterDriveRendererToolbarItems: (_scope: string, items: typeof registeredToolbarItems) => {
    registeredToolbarItems = items
  },
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
  saveCommand = null
  registeredToolbarItems = []
  forceCollaborationHookRender = null
  bindingConstructed.mockClear()
  vi.restoreAllMocks()
})

describe('DriveCodeRenderer collaboration binding', () => {
  it('binds an editor that mounted before the collaboration session became available', async () => {
    await renderCollaborativeRenderer()
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

  it('creates a collaboration checkpoint with the platform save command', async () => {
    const checkpointOwner = vi.spyOn(driveBrowserApi, 'checkpointOwner').mockResolvedValue({
      created: false,
      item: null,
      version: null,
    })
    collaborationHookResult = {
      session: {
        doc: { isDestroyed: false },
        text: { toString: () => '# Initial' },
        awareness: {},
      },
      state: { canWrite: true, onlineCount: 1, status: 'synced', error: null, epoch: 'epoch-1' },
    }
    await renderCollaborativeRenderer()

    expect(saveCommand?.keybinding).toBe(ctrlCmd | keyS)
    expect(registeredToolbarItems.find((item) => item.id === 'code-checkpoint')?.ariaKeyShortcuts)
      .toBe('Meta+S Control+S')
    await act(async () => {
      saveCommand?.handler()
      await vi.waitFor(() => expect(checkpointOwner).toHaveBeenCalled())
    })
    expect(checkpointOwner).toHaveBeenCalledWith('item-1', expect.objectContaining({ epoch: 'epoch-1' }))
  })
})

async function renderCollaborativeRenderer(): Promise<void> {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(
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
  })
}
