// @vitest-environment jsdom

import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DriveMessageRichComposer } from './drive-message-rich-composer'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('Drive message CommonMark editing', () => {
  it('opens and submits Chinese angle brackets without falling back to source or losing the draft', async () => {
    const onSubmit = vi.fn()
    function Composer() {
      const [value, setValue] = useState('<你好> 和 <未闭合')
      return <DriveMessageRichComposer value={value} onChange={setValue}
        onSubmit={() => onSubmit(value)} busy={false} label='留言正文' submitLabel='发布留言' />
    }
    await act(async () => {
      root.render(<Composer />)
      await Promise.resolve()
    })
    const editable = host.querySelector<HTMLElement>('.drive-mdxeditor-content[contenteditable="true"]')
    expect(editable?.textContent).toBe('<你好> 和 <未闭合')
    expect(host.querySelector('textarea')).toBeNull()
    expect(host.textContent).not.toContain('格式无法编辑')
    await act(async () => {
      const button = Array.from(host.querySelectorAll('button')).find(item => item.textContent === '发布留言')
      button?.click()
    })
    expect(onSubmit).toHaveBeenCalledWith('<你好> 和 <未闭合')
  })
})
