// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContentStorePublishDialog } from './content-store-publish-dialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
})

function renderDialog(options: {
  readonly open: boolean
  readonly visibility: 'private' | 'public'
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
        onOpenChange={vi.fn()}
        title='内容'
        type='skill'
        visibility={options.visibility}
        description='描述'
        isPublishing={false}
        onDescriptionChange={vi.fn()}
        onPublish={vi.fn(async () => undefined)}
      />
    )
  })
}

function publishSwitch() {
  const element = document.querySelector('#publish-public')
  if (!(element instanceof HTMLElement)) throw new Error('publish switch not found')
  return element
}
