// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { createDriveLazyComponent } from './drive-lazy-component'

globalThis.IS_REACT_ACT_ENVIRONMENT = true

describe('on-demand Drive components', () => {
  it('does not load until mounted and retries a failed download without losing parent props', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ default: ({ value }: { value: string }) => <textarea readOnly value={value} /> })
    const Component = createDriveLazyComponent<{ value: string }>(load)
    expect(load).not.toHaveBeenCalled()
    const host = document.createElement('div'); document.body.append(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<Component value='草稿' />))
      expect(host.textContent).toContain('加载失败')
      await act(async () => root.render(<Component value='修改后的草稿' />))
      await act(async () => host.querySelector('button')!.click())
      expect(host.querySelector('textarea')?.value).toBe('修改后的草稿')
      expect(load).toHaveBeenCalledTimes(2)
    } finally { await act(async () => root.unmount()); host.remove() }
  })
})
