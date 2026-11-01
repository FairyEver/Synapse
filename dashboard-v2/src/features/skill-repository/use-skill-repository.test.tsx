// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileBrowserCodeRenderer } from '../file-browser/renderers/code-renderer'
import { FileRendererShell } from '../file-browser/renderers/renderer-shell'
import { skillRepositoryApi } from './skill-repository-api'
import { useSkillRepository } from './use-skill-repository'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./skill-repository-api', () => ({
  skillRepositoryApi: { get: vi.fn(), getFileContent: vi.fn() },
}))

// Monaco's browser worker is unrelated to reload errors; keep the real editor lifecycle and toolbar.
vi.mock('@monaco-editor/react', async () => {
  const React = await vi.importActual<typeof import('react')>('react')
  return {
    default: ({ value, onChange }: {
      value: string
      onChange: (value: string) => void
    }) => React.createElement('textarea', {
      'aria-label': '文件内容',
      value,
      onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => onChange(event.currentTarget.value),
    }),
  }
})

const mockedApi = vi.mocked(skillRepositoryApi)
let root: Root | null = null
let queryClient: QueryClient | null = null
let repository: ReturnType<typeof useSkillRepository>

afterEach(() => {
  act(() => root?.unmount())
  root = null
  queryClient?.clear()
  queryClient = null
  document.body.innerHTML = ''
  vi.resetAllMocks()
})

describe('Skill repository file reload', () => {
  it('rejects a failed reload instead of returning the cached file', async () => {
    await renderRepository()
    mockedApi.getFileContent.mockRejectedValue(new Error('文件读取失败'))

    await act(async () => {
      await expect(repository.reloadSelectedFile()).rejects.toThrow('文件读取失败')
    })
    expect(repository.fileContentQuery.data?.text).toBe('# Cached')
  })

  it('keeps the editor draft and unsaved state when a reload fails', async () => {
    await renderRepository(true)
    await inputEditor('# Local draft')
    mockedApi.getFileContent.mockRejectedValue(new Error('文件读取失败'))

    await clickButton('重新加载')
    await clickButton('放弃并重新加载')
    await waitFor(() => expect(document.body.textContent).toContain('文件读取失败'))

    expect(editor().value).toBe('# Local draft')
    expect(document.body.textContent).toContain('未保存')
    expect(document.body.textContent).not.toContain('已同步')
  })

  it('returns fresh text and its version after a successful reload', async () => {
    await renderRepository()
    mockedApi.getFileContent.mockResolvedValue(fileContent('# Remote', 'sha-2'))

    await act(async () => {
      await expect(repository.reloadSelectedFile()).resolves.toEqual({
        text: '# Remote',
        baseVersionId: 'sha-2',
      })
    })
    await waitFor(() => expect(repository.fileContentQuery.data?.text).toBe('# Remote'))
  })
})

async function renderRepository(withEditor = false) {
  mockedApi.get.mockResolvedValue({
    id: 'repo-1', name: 'demo', title: 'Demo', description: null,
    visibility: 'private', status: 'active', owner: { id: 'user-1', handle: 'alice' },
    forkedFromRepositoryId: null, createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z', lastSyncedAt: null, files: [],
  })
  mockedApi.getFileContent.mockResolvedValue(fileContent('# Cached', 'sha-1'))
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  function Harness() {
    repository = useSkillRepository('repo-1')
    useEffect(() => repository.setSelectedFilePath('SKILL.md'), [])
    const content = repository.fileContentQuery.data
    if (!withEditor || !content) return null
    return <FileRendererShell title='SKILL.md'>
      <FileBrowserCodeRenderer path='SKILL.md' text={content.text ?? ''} baseVersionId={content.file.sha256}
        editContext={{ reload: repository.reloadSelectedFile, reloading: repository.states.reloadingFile,
          saveText: repository.saveSelectedText, savingText: repository.states.savingText }} />
    </FileRendererShell>
  }
  act(() => root?.render(<QueryClientProvider client={queryClient!}><Harness /></QueryClientProvider>))
  await waitFor(() => expect(repository.fileContentQuery.data?.text).toBe('# Cached'))
}

function fileContent(text: string, sha256: string): Awaited<ReturnType<typeof skillRepositoryApi.getFileContent>> {
  return {
    file: { id: 'file-1', path: 'SKILL.md', size: 10, sha256, kind: 'text', mimeType: 'text/markdown',
      createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' },
    text, downloadUrl: null, truncated: false,
  }
}

function editor(): HTMLTextAreaElement {
  const element = document.querySelector('textarea[aria-label="文件内容"]')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('editor not found')
  return element
}

async function inputEditor(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(editor(), value)
    editor().dispatchEvent(new Event('input', { bubbles: true }))
    editor().dispatchEvent(new Event('change', { bubbles: true }))
    await Promise.resolve()
  })
}

async function clickButton(text: string) {
  const button = Array.from(document.querySelectorAll('button')).find((item) => item.textContent?.trim() === text)
  if (!button) throw new Error(`button not found: ${text}`)
  await act(async () => { button.click(); await Promise.resolve() })
}

async function waitFor(assert: () => void) {
  let lastError: unknown
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { assert(); return } catch (error) { lastError = error }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  throw lastError
}
