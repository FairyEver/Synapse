import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FilePreviewLayout,
  useFilePreviewLayoutMode,
  type FilePreviewLayoutMode,
} from './file-preview-layout'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('FilePreviewLayout browser sizing', () => {
  it.each([
    [390, 'compact'],
    [834, 'compact'],
    [1280, 'regular'],
  ] as const)('uses %ipx containers as %s mode', async (width, expectedMode) => {
    host = document.createElement('div')
    host.style.width = `${width}px`
    document.body.append(host)
    root = createRoot(host)

    act(() => {
      root?.render(
        <FilePreviewLayout>
          <LayoutModeProbe />
        </FilePreviewLayout>
      )
    })

    await vi.waitFor(() => {
      expect(probe().dataset.mode).toBe(expectedMode)
    })
  })

})

function LayoutModeProbe() {
  const mode: FilePreviewLayoutMode = useFilePreviewLayoutMode()
  return <div data-testid='layout-mode' data-mode={mode} />
}

function probe(): HTMLElement {
  const element = document.querySelector('[data-testid="layout-mode"]')
  if (!(element instanceof HTMLElement)) throw new Error('Missing layout mode probe')
  return element
}
