// @vitest-environment jsdom

import { act, type ComponentProps } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DriveMarkdownOutlineItemDto } from '@synapse/shared'
import { DriveDocumentOutlineTree } from './drive-document-outline'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const items: DriveMarkdownOutlineItemDto[] = [
  {
    id: 'parent', text: '修改方案', depth: 1,
    children: [
      {
        id: 'child', text: '公共列表', depth: 2,
        children: [{ id: 'grandchild', text: '请求校验', depth: 3, children: [] }],
      },
      { id: 'leaf', text: '商品排序', depth: 2, children: [] },
    ],
  },
  { id: 'sibling', text: '验收说明', depth: 1, children: [] },
]

let root: Root | null = null
let host: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe.each([false, true])('DriveDocumentOutlineTree (compact: %s)', (compact) => {
  it('starts expanded and toggles only the selected branch without navigating', async () => {
    const onSelect = vi.fn()
    renderOutline({ compact, onSelect })

    expect(host?.querySelectorAll('a')).toHaveLength(5)
    expect(host?.querySelectorAll('button')).toHaveLength(2)
    expect(toggle('修改方案').getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle('修改方案').getAttribute('aria-controls')!)?.contains(link('child'))).toBe(true)

    await click(toggle('修改方案'))

    expect(link('child')).toBeNull()
    expect(link('grandchild')).toBeNull()
    expect(link('leaf')).toBeNull()
    expect(link('parent')).not.toBeNull()
    expect(link('sibling')).not.toBeNull()
    expect(toggle('修改方案').getAttribute('aria-expanded')).toBe('false')
    expect(onSelect).not.toHaveBeenCalled()

    await click(toggle('修改方案'))

    expect(host?.querySelectorAll('a')).toHaveLength(5)
    expect(toggle('修改方案').getAttribute('aria-expanded')).toBe('true')
  })

  it('preserves a nested collapse when its parent is closed and reopened', async () => {
    renderOutline({ compact })

    await click(toggle('公共列表'))
    await click(toggle('修改方案'))
    await click(toggle('修改方案'))

    expect(link('child')).not.toBeNull()
    expect(link('leaf')).not.toBeNull()
    expect(link('grandchild')).toBeNull()
    expect(toggle('公共列表').getAttribute('aria-expanded')).toBe('false')

    await click(toggle('公共列表'))
    expect(link('grandchild')).not.toBeNull()
  })

  it('keeps heading navigation separate from expansion', async () => {
    const onSelect = vi.fn()
    renderOutline({ compact, onSelect, activeItemId: 'leaf' })
    expect(link('leaf')?.getAttribute('aria-current')).toBe('location')

    await click(toggle('修改方案'))
    const parent = link('parent')!
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    await act(async () => { parent.dispatchEvent(event) })

    expect(parent.getAttribute('href')).toBe('#parent')
    expect(event.defaultPrevented).toBe(true)
    expect(onSelect).toHaveBeenCalledExactlyOnceWith('parent')
    expect(toggle('修改方案').getAttribute('aria-expanded')).toBe('false')
  })

  it('keeps collapsed branches closed when the active heading and outline update', async () => {
    renderOutline({ compact })
    await click(toggle('修改方案'))

    renderOutline({
      compact,
      activeItemId: 'new-child',
      items: [
        { ...items[0], children: [...items[0].children, { id: 'new-child', text: '新增小节', depth: 2, children: [] }] },
        items[1],
      ],
    })

    expect(toggle('修改方案').getAttribute('aria-expanded')).toBe('false')
    expect(link('new-child')).toBeNull()

    await click(toggle('修改方案'))
    expect(link('new-child')?.getAttribute('aria-current')).toBe('location')
  })
})

function renderOutline(props: Partial<ComponentProps<typeof DriveDocumentOutlineTree>>) {
  if (!host) {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
  }
  act(() => root?.render(<DriveDocumentOutlineTree items={items} {...props} />))
}

function link(id: string) {
  return host?.querySelector<HTMLAnchorElement>(`a[data-markdown-outline-id="${id}"]`) ?? null
}

function toggle(text: string) {
  const button = Array.from(host?.querySelectorAll('button') ?? [])
    .find((item) => item.getAttribute('aria-label') === `折叠 ${text}` || item.getAttribute('aria-label') === `展开 ${text}`)
  expect(button, `Missing outline toggle for ${text}`).toBeDefined()
  return button!
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}
