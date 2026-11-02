// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { DriveMessageComposer } from './drive-message-composer'

const state = vi.hoisted(() => ({ loads: 0, files: [] as File[] }))
vi.mock('./drive-message-rich-composer', async () => {
  state.loads++
  return { DriveMessageRichComposer: (props: { pendingImages?: readonly File[] }) => { state.files = [...props.pendingImages ?? []]; return <div data-rich-composer /> } }
})
globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('collapsed message composer', () => {
  it('defers the rich editor and preserves images pasted during expansion', async () => {
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    let expanded = false
    const render = () => root.render(<DriveMessageComposer value='草稿' onChange={() => undefined} onSubmit={() => undefined} busy={false} label='留言' submitLabel='发布' expanded={expanded} onExpand={() => { expanded = true; render() }} />)
    try {
      await act(async () => render())
      expect(state.loads).toBe(0)
      expect(host.querySelector('textarea')?.value).toBe('草稿')
      const image = new File(['image'], 'photo.png', { type: 'image/png' })
      const paste = new Event('paste', { bubbles: true, cancelable: true })
      Object.defineProperty(paste, 'clipboardData', { value: { items: [{ type: image.type, getAsFile: () => image }] } })
      await act(async () => { host.querySelector('textarea')!.dispatchEvent(paste); await vi.dynamicImportSettled() })
      expect(paste.defaultPrevented).toBe(true)
      expect(state.files).toEqual([image])
      expect(host.querySelector('[data-rich-composer]')).not.toBeNull()
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
