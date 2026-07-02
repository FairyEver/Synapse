// @vitest-environment jsdom

import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/lib/api'
import { FileBrowserCodeRenderer } from './code-renderer'
import { FileRendererShell, type FileRendererEditContext } from './renderer-shell'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: ({
      value,
      onChange,
      options,
    }: {
      readonly value?: string
      readonly onChange?: (value?: string) => void
      readonly options?: { readonly readOnly?: boolean }
    }) => React.createElement('textarea', {
      'data-monaco-editor': 'true',
      readOnly: options?.readOnly,
      value: value ?? '',
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(event.currentTarget.value),
    }),
  }
})

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
  vi.clearAllMocks()
})

describe('FileBrowserCodeRenderer', () => {
  it('saves text with the current base version id', async () => {
    const editContext = createEditContext()
    renderRenderer(editContext)

    await inputValue(editor(), '# Updated')
    await click(buttonWithText('保存'))

    expect(editContext.saveText).toHaveBeenCalledWith({
      text: '# Updated',
      baseVersionId: 'sha-1',
    })
    expect(document.body.textContent).toContain('已同步')
  })

  it('keeps local edits when save detects a conflict', async () => {
    const editContext = createEditContext({
      saveText: vi.fn(async () => {
        throw new ApiError('文件已有新内容。', 409)
      }),
    })
    renderRenderer(editContext)

    await inputValue(editor(), '# Local')
    await click(buttonWithText('保存'))

    expect(document.body.textContent).toContain('文件已有新内容')
    expect(editor().value).toBe('# Local')
    expect(document.body.textContent).toContain('下载本地版本')
    expect(document.body.textContent).toContain('重新加载')
  })
})

function renderRenderer(editContext: FileRendererEditContext) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <FileRendererShell title='SKILL.md'>
        <FileBrowserCodeRenderer
          path='SKILL.md'
          text='# Skill'
          baseVersionId='sha-1'
          editContext={editContext}
        />
      </FileRendererShell>
    )
  })
}

function createEditContext(overrides: Partial<FileRendererEditContext> = {}): FileRendererEditContext {
  return {
    reload: vi.fn(async () => ({ text: '# Remote', baseVersionId: 'sha-2' })),
    reloading: false,
    saveText: vi.fn(async () => ({ baseVersionId: 'sha-2' })),
    savingText: false,
    ...overrides,
  }
}

function editor(): HTMLTextAreaElement {
  const element = document.querySelector('[data-monaco-editor="true"]')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('editor not found')
  return element
}

async function inputValue(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set
    valueSetter?.call(element, value)
    element.dispatchEvent(new Event('input', { bubbles: true }))
    element.dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

function buttonWithText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.includes(text))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`button not found: ${text}`)
  return button
}
