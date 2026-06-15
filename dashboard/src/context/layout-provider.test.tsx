// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LayoutProvider, useLayout } from './layout-provider'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
let snapshot: ReturnType<typeof useLayout> | null = null

beforeEach(() => {
  clearLayoutCookies()
  snapshot = null
})

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  host?.remove()
  root = null
  host = null
  snapshot = null
  clearLayoutCookies()
})

describe('LayoutProvider', () => {
  it('defaults to the standard sidebar with compact collapse available', () => {
    renderLayoutProbe()

    expect(snapshot?.defaultVariant).toBe('sidebar')
    expect(snapshot?.variant).toBe('sidebar')
    expect(snapshot?.defaultCollapsible).toBe('icon')
    expect(snapshot?.collapsible).toBe('icon')
  })
})

function LayoutProbe() {
  snapshot = useLayout()
  return null
}

function renderLayoutProbe() {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(
      <LayoutProvider>
        <LayoutProbe />
      </LayoutProvider>
    )
  })
}

function clearLayoutCookies() {
  document.cookie = 'layout_variant=; path=/; max-age=0'
  document.cookie = 'layout_collapsible=; path=/; max-age=0'
}
