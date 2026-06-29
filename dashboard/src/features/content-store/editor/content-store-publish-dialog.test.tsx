// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { ContentStorePublishDialog } from './content-store-publish-dialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}))

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  vi.clearAllMocks()
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  document.body.innerHTML = ''
})

describe('ContentStorePublishDialog', () => {
  it('resets publish visibility from current content visibility when reopened', () => {
    renderDialog({ open: true, visibility: 'public' })
    expect(publishSwitch().getAttribute('aria-checked')).toBe('true')

    renderDialog({ open: false, visibility: 'private' })
    renderDialog({ open: true, visibility: 'private' })

    expect(publishSwitch().getAttribute('aria-checked')).toBe('false')
  })

  it('keeps the dialog open and shows feedback when publish fails', async () => {
    const onOpenChange = vi.fn()
    const onPublish = vi.fn(async () => {
      throw new Error('发布接口失败')
    })

    renderDialog({ open: true, visibility: 'public', onOpenChange, onPublish })

    await act(async () => {
      publishButton().click()
    })

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(toast.error).toHaveBeenCalledWith('发布接口失败')
  })

  it('prevents duplicate publish clicks while the request is pending', async () => {
    let resolvePublish: (() => void) | undefined
    const onPublish = vi.fn(() => new Promise<void>((resolve) => {
      resolvePublish = resolve
    }))

    renderDialog({ open: true, visibility: 'public', onPublish })

    await act(async () => {
      publishButton().click()
    })

    expect(publishButton().disabled).toBe(true)

    await act(async () => {
      publishButton().click()
    })

    expect(onPublish).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolvePublish?.()
    })
  })
})

function renderDialog(options: {
  readonly open: boolean
  readonly visibility: 'private' | 'public'
  readonly onOpenChange?: (open: boolean) => void
  readonly onPublish?: (publishPublic: boolean) => Promise<unknown>
}) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }

  act(() => {
    root?.render(
      <ContentStorePublishDialog
        open={options.open}
        onOpenChange={options.onOpenChange ?? vi.fn()}
        title='内容'
        type='skill'
        visibility={options.visibility}
        description='描述'
        isPublishing={false}
        onDescriptionChange={vi.fn()}
        onPublish={options.onPublish ?? vi.fn(async () => undefined)}
      />
    )
  })
}

function publishSwitch() {
  const element = document.querySelector('#publish-public')
  if (!(element instanceof HTMLElement)) throw new Error('publish switch not found')
  return element
}

function publishButton() {
  const element = [...document.querySelectorAll('button')]
    .find((button) => button.textContent === '发布')
  if (!(element instanceof HTMLButtonElement)) throw new Error('publish button not found')
  return element
}
