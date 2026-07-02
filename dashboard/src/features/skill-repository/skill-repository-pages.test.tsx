// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { SkillRepositoryDetailDto, SkillRepositoryItemDto } from '@synapse/shared'
import { act, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillRepositoryDetailPage } from './skill-repository-detail-page'
import { SkillRepositoryExplorePage } from './skill-repository-explore-page'
import { SkillRepositoryListPage } from './skill-repository-list-page'
import { skillRepositoryApi } from './skill-repository-api'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const navigateMock = vi.fn()

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    Link: ({ children }: { readonly children: ReactNode }) => <a>{children}</a>,
    useNavigate: () => navigateMock,
  }
})

vi.mock('./skill-repository-api', () => ({
  skillRepositoryApi: {
    listMine: vi.fn(),
    listPublic: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    fork: vi.fn(),
    createInstallSession: vi.fn(),
    getFileContent: vi.fn(),
    saveTextFile: vi.fn(),
    uploadFile: vi.fn(),
    renameFile: vi.fn(),
    deleteFile: vi.fn(),
  },
}))

const mockedApi = vi.mocked(skillRepositoryApi)
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

describe('Skill Repository pages', () => {
  it('renders my skill repositories', async () => {
    mockedApi.listMine.mockResolvedValue([repositoryItem()])

    render(
      <QueryClientProvider client={queryClient()}>
        <SkillRepositoryListPage />
      </QueryClientProvider>
    )

    await waitForText('demo-skill')
    expect(document.body.textContent).toContain('Demo Skill')
    expect(document.body.textContent).toContain('私有')
  })

  it('opens repository details from the row', async () => {
    mockedApi.listMine.mockResolvedValue([repositoryItem()])

    render(
      <QueryClientProvider client={queryClient()}>
        <SkillRepositoryListPage />
      </QueryClientProvider>
    )

    await waitForText('demo-skill')
    await click(rowByText('demo-skill'))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/skill-repositories/$repositoryId',
      params: { repositoryId: 'repo-1' },
    })
  })

  it('renders a concise empty state', async () => {
    mockedApi.listMine.mockResolvedValue([])

    render(
      <QueryClientProvider client={queryClient()}>
        <SkillRepositoryListPage />
      </QueryClientProvider>
    )

    await waitForText('暂无 Skill 仓库')
    expect(document.body.textContent).toContain('通过本地 Synapse MCP 上传 Skill 后会显示在这里。')
  })

  it('opens public repositories from explore rows', async () => {
    mockedApi.listPublic.mockResolvedValue({
      items: [repositoryItem({ visibility: 'public' })],
      page: 1,
      pageSize: 20,
      total: 1,
    })

    render(
      <QueryClientProvider client={queryClient()}>
        <SkillRepositoryExplorePage />
      </QueryClientProvider>
    )

    await waitForText('demo-skill')
    await click(rowByText('demo-skill'))

    expect(navigateMock).toHaveBeenCalledWith({
      to: '/skills/$ownerHandle/$repositoryName',
      params: { ownerHandle: 'alice', repositoryName: 'demo-skill' },
    })
  })

  it('renders repository files', async () => {
    mockedApi.get.mockResolvedValue(repositoryDetail())

    render(
      <QueryClientProvider client={queryClient()}>
        <SkillRepositoryDetailPage repositoryId='repo-1' />
      </QueryClientProvider>
    )

    await waitForText('SKILL.md')
    expect(document.body.textContent).toContain('alice/demo-skill')
    expect(document.body.textContent).toContain('docs')
    expect(document.body.textContent).toContain('README.md')
  })
})

function render(element: ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => {
    root?.render(element)
  })
}

function queryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function waitForText(text: string): Promise<void> {
  let lastText = ''
  for (let index = 0; index < 20; index += 1) {
    lastText = document.body.textContent ?? ''
    if (lastText.includes(text)) return
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
  throw new Error(`Text not found: ${text}. Current text: ${lastText}`)
}

function rowByText(text: string): HTMLTableRowElement {
  const row = Array.from(document.querySelectorAll('tr'))
    .find((item) => item.textContent?.includes(text))
  if (!(row instanceof HTMLTableRowElement)) throw new Error(`Row not found: ${text}`)
  return row
}

function repositoryItem(overrides: Partial<SkillRepositoryItemDto> = {}): SkillRepositoryItemDto {
  return {
    id: 'repo-1',
    name: 'demo-skill',
    title: 'Demo Skill',
    description: null,
    visibility: 'private',
    status: 'active',
    owner: { id: 'user-1', handle: 'alice', displayName: 'Alice' },
    forkedFromRepositoryId: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
    lastSyncedAt: '2026-07-02T00:00:00.000Z',
    ...overrides,
  }
}

function repositoryDetail(): SkillRepositoryDetailDto {
  return {
    ...repositoryItem(),
    files: [
      file('skill', 'SKILL.md'),
      file('readme', 'README.md'),
      file('usage', 'docs/usage.md'),
    ],
  }
}

function file(id: string, path: string) {
  return {
    id,
    path,
    size: 10,
    sha256: id.padEnd(64, '0').slice(0, 64),
    kind: 'text' as const,
    mimeType: 'text/markdown',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  }
}
