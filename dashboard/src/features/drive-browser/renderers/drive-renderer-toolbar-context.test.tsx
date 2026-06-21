// @vitest-environment jsdom

import { act, useEffect, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DriveRendererToolbarProvider,
  useDriveRendererToolbar,
} from './drive-renderer-toolbar-context'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('DriveRendererToolbarProvider', () => {
  it('replaces registered items by scope and clears them on unmount', async () => {
    render(
      <DriveRendererToolbarProvider>
        <ToolbarProbe />
        <Contributor label='未保存' />
      </DriveRendererToolbarProvider>
    )
    await act(async () => undefined)

    expect(toolbarLabels()).toBe('未保存')

    render(
      <DriveRendererToolbarProvider>
        <ToolbarProbe />
        <Contributor label='已同步' />
      </DriveRendererToolbarProvider>
    )
    await act(async () => undefined)

    expect(toolbarLabels()).toBe('已同步')

    render(
      <DriveRendererToolbarProvider>
        <ToolbarProbe />
      </DriveRendererToolbarProvider>
    )
    await act(async () => undefined)

    expect(toolbarLabels()).toBe('')
  })
})

function Contributor({ label }: { readonly label: string }) {
  const { registerItems } = useDriveRendererToolbar()
  useEffect(() => registerItems('code', [{
    kind: 'status',
    id: 'sync',
    label,
  }]), [label, registerItems])
  return null
}

function ToolbarProbe() {
  const toolbar = useDriveRendererToolbar()
  return (
    <div data-testid='toolbar-items'>
      {toolbar.items.map((item) => item.label).join('|')}
    </div>
  )
}

function render(element: ReactElement) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  act(() => root?.render(element))
}

function toolbarLabels(): string {
  return document.querySelector('[data-testid="toolbar-items"]')?.textContent ?? ''
}
