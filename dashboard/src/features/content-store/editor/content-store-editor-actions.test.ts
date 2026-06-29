import { describe, expect, it, vi } from 'vitest'
import { confirmContentVisibilityChange } from './content-store-editor-actions'

describe('confirmContentVisibilityChange', () => {
  it('clears the visibility target after a successful update', async () => {
    const setVisibility = vi.fn(async () => undefined)
    const clearVisibilityTarget = vi.fn()
    const notifyError = vi.fn()

    await confirmContentVisibilityChange({
      visibilityTarget: 'public',
      setVisibility,
      clearVisibilityTarget,
      notifyError,
    })

    expect(setVisibility).toHaveBeenCalledWith('public')
    expect(clearVisibilityTarget).toHaveBeenCalled()
    expect(notifyError).not.toHaveBeenCalled()
  })

  it('keeps the visibility target and notifies when update fails', async () => {
    const setVisibility = vi.fn(async () => {
      throw new Error('可见性更新失败')
    })
    const clearVisibilityTarget = vi.fn()
    const notifyError = vi.fn()

    await confirmContentVisibilityChange({
      visibilityTarget: 'private',
      setVisibility,
      clearVisibilityTarget,
      notifyError,
    })

    expect(setVisibility).toHaveBeenCalledWith('private')
    expect(clearVisibilityTarget).not.toHaveBeenCalled()
    expect(notifyError).toHaveBeenCalledWith('可见性更新失败')
  })
})
