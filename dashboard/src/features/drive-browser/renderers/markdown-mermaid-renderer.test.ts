// @vitest-environment jsdom

import type { Mermaid } from 'mermaid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createDriveMermaidConfig,
  renderDriveMermaidDiagrams,
  restoreDriveMermaidDiagrams,
} from './markdown-mermaid-renderer'

const THEME_TOKENS = [
  '--background',
  '--foreground',
  '--muted',
  '--muted-foreground',
  '--border',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
]

beforeEach(() => {
  document.body.innerHTML = ''
  THEME_TOKENS.forEach((token) => document.documentElement.style.setProperty(token, 'oklch(0.5 0 0)'))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    getImageData: vi.fn(() => ({ data: new Uint8ClampedArray([18, 52, 86, 255]) } as ImageData)),
    fillStyle: '',
  } as unknown as CanvasRenderingContext2D)
})

afterEach(() => {
  THEME_TOKENS.forEach((token) => document.documentElement.style.removeProperty(token))
  vi.restoreAllMocks()
})

describe('drive markdown Mermaid renderer', () => {
  it('does not load Mermaid when the document has no Mermaid code blocks', async () => {
    const root = markdownRoot('<pre><code class="language-ts">const ok = true</code></pre>')
    const loadMermaid = vi.fn(async () => mermaidApi())

    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'light', loadMermaid })

    expect(loadMermaid).not.toHaveBeenCalled()
    expect(root.querySelector('[data-drive-mermaid-diagram="true"]')).toBeNull()
  })

  it('renders multiple Mermaid diagram types with unique ids and keeps their source', async () => {
    const root = markdownRoot([
      mermaidBlock('flowchart TB\nA --> B'),
      mermaidBlock('stateDiagram-v2\n[*] --> Ready'),
      mermaidBlock('sequenceDiagram\nA->>B: Ping'),
    ].join(''))
    const mermaid = mermaidApi()
    const loadMermaid = vi.fn(async () => mermaid)

    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'light', loadMermaid })

    expect(loadMermaid).toHaveBeenCalledTimes(1)
    expect(mermaid.render).toHaveBeenCalledTimes(3)
    const ids = vi.mocked(mermaid.render).mock.calls.map(([id]) => id)
    expect(new Set(ids).size).toBe(3)
    expect(root.querySelectorAll('[data-drive-mermaid-diagram="true"]')).toHaveLength(3)
    expect(root.querySelectorAll('[data-drive-mermaid-rendered="true"] svg')).toHaveLength(3)
    expect(root.querySelector('svg')?.getAttribute('role')).toBe('img')
    expect(root.querySelector('svg')?.getAttribute('aria-label')).toBe('Mermaid 流程图')
    expect(root.querySelector('figure')?.className).toContain('overflow-x-auto')
    expect(root.querySelector('figure')?.className).toContain('bg-muted/40')
    expect(root.querySelector('figure')?.className).toContain('mx-0')
    expect(root.querySelector('pre')?.classList.contains('hidden')).toBe(true)
    expect(root.querySelector('pre')?.textContent).toContain('flowchart TB')
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: 'strict',
      suppressErrorRendering: true,
      theme: 'base',
      themeVariables: expect.objectContaining({
        background: '#123456',
        primaryColor: '#123456',
        textColor: '#123456',
      }),
    }))
  })

  it('keeps invalid diagram source visible and continues rendering later diagrams', async () => {
    const root = markdownRoot([
      mermaidBlock('invalid diagram'),
      mermaidBlock('flowchart LR\nA --> B'),
    ].join(''))
    const mermaid = mermaidApi({
      render: vi.fn(async (_id: string, source: string) => {
        if (source.startsWith('invalid')) throw new Error('syntax error')
        return { svg: '<svg viewBox="0 0 100 50"><text>ok</text></svg>' }
      }),
    })

    await renderDriveMermaidDiagrams({
      root,
      resolvedTheme: 'light',
      loadMermaid: async () => mermaid,
    })

    expect(root.querySelector('[data-drive-mermaid-error="true"]')?.textContent).toBe('无法渲染流程图，已显示源码。')
    expect(root.querySelector('[data-drive-mermaid-error="true"] + pre')?.classList.contains('hidden')).toBe(false)
    expect(root.querySelectorAll('[data-drive-mermaid-diagram="true"]')).toHaveLength(1)
    expect(mermaid.render).toHaveBeenCalledTimes(2)
  })

  it('keeps wide SVG content at its intrinsic width inside the horizontal scroller', async () => {
    const root = markdownRoot(mermaidBlock('flowchart LR\nA --> B --> C --> D'))
    const mermaid = mermaidApi({
      render: vi.fn(async () => ({
        svg: '<svg width="1200" viewBox="0 0 1200 200" style="max-width: 100%"><text>wide</text></svg>',
      })),
    })

    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'light', loadMermaid: async () => mermaid })

    const figure = root.querySelector('figure')
    const rendered = root.querySelector('[data-drive-mermaid-rendered="true"]')
    const svg = root.querySelector('svg')
    expect(figure?.className).toContain('mx-0')
    expect(figure?.className).toContain('max-w-full')
    expect(figure?.className).toContain('overflow-x-auto')
    expect(rendered?.className).toContain('min-w-fit')
    expect(svg?.getAttribute('width')).toBe('1200')
    expect(svg?.style.maxWidth).toBe('')
    expect(svg?.classList.contains('max-w-none')).toBe(true)
  })

  it('keeps source visible when the Mermaid chunk cannot load', async () => {
    const root = markdownRoot(mermaidBlock('flowchart LR\nA --> B'))

    await renderDriveMermaidDiagrams({
      root,
      resolvedTheme: 'light',
      loadMermaid: async () => { throw new Error('chunk unavailable') },
    })

    expect(root.querySelector('[data-drive-mermaid-error="true"]')?.textContent).toBe('无法渲染流程图，已显示源码。')
    expect(root.querySelector('pre')?.classList.contains('hidden')).toBe(false)
  })

  it('does not apply stale render results after cancellation', async () => {
    const root = markdownRoot(mermaidBlock('flowchart TB\nA --> B'))
    let resolveRender: ((value: { svg: string }) => void) | undefined
    const mermaid = mermaidApi({
      render: vi.fn(() => new Promise((resolve) => {
        resolveRender = resolve
      })),
    })
    const controller = new AbortController()
    const renderPromise = renderDriveMermaidDiagrams({
      root,
      resolvedTheme: 'light',
      signal: controller.signal,
      loadMermaid: async () => mermaid,
    })
    await vi.waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1))

    controller.abort()
    resolveRender?.({ svg: '<svg viewBox="0 0 100 50"></svg>' })
    await renderPromise

    expect(root.querySelector('[data-drive-mermaid-diagram="true"]')).toBeNull()
    expect(root.querySelector('pre')?.classList.contains('hidden')).toBe(false)
  })

  it('restores source before a theme rerender and uses the dark token configuration', async () => {
    const root = markdownRoot(mermaidBlock('flowchart TB\nA --> B'))
    const mermaid = mermaidApi()
    const loadMermaid = vi.fn(async () => mermaid)
    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'light', loadMermaid })

    restoreDriveMermaidDiagrams(root)
    expect(root.querySelector('[data-drive-mermaid-diagram="true"]')).toBeNull()
    expect(root.querySelector('pre')?.classList.contains('hidden')).toBe(false)
    await renderDriveMermaidDiagrams({ root, resolvedTheme: 'dark', loadMermaid })

    expect(root.querySelectorAll('[data-drive-mermaid-diagram="true"]')).toHaveLength(1)
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({
      theme: 'base',
      themeVariables: expect.objectContaining({ darkMode: true }),
    }))
  })

  it('falls back to a built-in theme when browser color resolution is unavailable', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null)
    const root = markdownRoot('')

    expect(createDriveMermaidConfig(root, 'dark')).toMatchObject({ theme: 'dark' })
    expect(createDriveMermaidConfig(root, 'dark').themeVariables).toBeUndefined()
  })
})

function markdownRoot(html: string): HTMLElement {
  const root = document.createElement('main')
  root.innerHTML = html
  document.body.append(root)
  return root
}

function mermaidBlock(source: string): string {
  return `<pre><code class="language-mermaid">${source}</code></pre>`
}

function mermaidApi(overrides: Partial<Pick<Mermaid, 'initialize' | 'render'>> = {}): Pick<Mermaid, 'initialize' | 'render'> {
  return {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg viewBox="0 0 100 50"><text>diagram</text></svg>' })),
    ...overrides,
  }
}
