// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act } from 'react'
import type { ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { adminApi } from '@/lib/api'
import TeamsPage from './index'
import { AddMembersDialog } from './add-members-dialog'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@/lib/api', () => ({
  adminApi: {
    listTeams: vi.fn(),
    createTeam: vi.fn(),
    renameTeam: vi.fn(),
    deleteTeam: vi.fn(),
    listTeamMembers: vi.fn(),
    listTeamMemberCandidates: vi.fn(),
    addTeamMembers: vi.fn(),
    removeTeamMember: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
  },
}))

vi.mock('@/components/layout/header', () => ({
  Header: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}))

vi.mock('@/components/layout/main', () => ({
  Main: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}))

const mockedAdminApi = vi.mocked(adminApi)

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

describe('TeamsPage', () => {
  it('shows every team with its member count', async () => {
    mockedAdminApi.listTeams.mockResolvedValue({
      data: [teamRow({ id: 'team-1', name: '产品组', memberCount: 3 })],
      total: 1,
    })

    render(<TeamsPage />)

    await waitFor(() => {
      expect(document.body.textContent).toContain('产品组')
    })
    expect(document.body.textContent).toContain('3 人')
    expect(document.body.textContent).toContain('共 1 个')
  })

  it('deletes a team only after the confirmation is accepted', async () => {
    mockedAdminApi.listTeams.mockResolvedValue({
      data: [teamRow({ id: 'team-1', name: '产品组', memberCount: 2 })],
      total: 1,
    })
    mockedAdminApi.deleteTeam.mockResolvedValue({ ok: true })

    render(<TeamsPage />)
    await waitFor(() => teamActionsButton('产品组'))
    await openMenu(teamActionsButton('产品组'))
    await click(menuItemByText('删除团队'))

    expect(document.body.textContent).toContain('2 名成员不会因此被删除，只是不再属于这个团队。')
    await click(dialogButtonByText('取消'))
    expect(mockedAdminApi.deleteTeam).not.toHaveBeenCalled()

    await openMenu(teamActionsButton('产品组'))
    await click(menuItemByText('删除团队'))
    await click(dialogButtonByText('删除'))

    expect(mockedAdminApi.deleteTeam).toHaveBeenCalledWith('team-1')
  })

  it('rejects a duplicate team name with the server message', async () => {
    mockedAdminApi.listTeams.mockResolvedValue({ data: [], total: 0 })
    mockedAdminApi.createTeam.mockRejectedValue(new Error('已存在同名团队。'))

    render(<TeamsPage />)
    await waitFor(() => document.querySelector('#team-name'))
    await click(buttonByText('新建团队'))
    await typeInto(textInput('#team-name'), '产品组')
    await click(dialogButtonByText('创建'))

    await waitFor(() => {
      expect(document.body.textContent).toContain('已存在同名团队。')
    })
  })
})

describe('AddMembersDialog', () => {
  it('asks the server for candidates instead of filtering a user list', async () => {
    mockedAdminApi.listTeamMemberCandidates.mockResolvedValue({
      data: [
        candidate({ id: 'user-2', email: 'zhang@example.com', handle: 'zhang' }),
        candidate({ id: 'user-3', email: 'wang@example.com', handle: 'wang', status: 'disabled' }),
      ],
      total: 2,
    })

    render(<AddMembersDialog open teamId='team-1' onOpenChange={vi.fn()} />)

    await waitFor(() => {
      expect(document.body.textContent).toContain('zhang@example.com')
    })
    expect(document.body.textContent).toContain('wang@example.com')
    expect(document.body.textContent).toContain('已禁用')
    expect(mockedAdminApi.listTeamMemberCandidates).toHaveBeenCalledWith('team-1', {
      page: 1,
      pageSize: 50,
      query: undefined,
    })
  })

  it('searches on the server and keeps members picked on earlier pages', async () => {
    mockedAdminApi.listTeamMemberCandidates.mockImplementation(async (_id, options = {}) => {
      if (options.page === 2) {
        return { data: [candidate({ id: 'user-4', email: 'sun@example.com', handle: 'sun' })], total: 4 }
      }
      if (options.query) {
        return { data: [candidate({ id: 'user-5', email: 'li@example.com', handle: 'li' })], total: 1 }
      }
      return {
        data: [
          candidate({ id: 'user-2', email: 'zhang@example.com', handle: 'zhang' }),
          candidate({ id: 'user-3', email: 'wang@example.com', handle: 'wang' }),
          candidate({ id: 'user-6', email: 'zhao@example.com', handle: 'zhao' }),
        ],
        total: 4,
      }
    })
    mockedAdminApi.addTeamMembers.mockResolvedValue({ added: 1 })

    render(<AddMembersDialog open teamId='team-1' onOpenChange={vi.fn()} />)
    const firstPageBoxes = await waitFor(() => {
      const boxes = checkboxes()
      if (boxes.length === 0) throw new Error('candidates not rendered yet')
      return boxes
    })

    await click(firstPageBoxes[0]!)
    expect(document.body.textContent).toContain('已选 1 人')

    await click(buttonByText('加载更多'))
    await waitFor(() => {
      expect(document.body.textContent).toContain('sun@example.com')
    })
    expect(mockedAdminApi.listTeamMemberCandidates).toHaveBeenCalledWith('team-1', {
      page: 2,
      pageSize: 50,
      query: undefined,
    })
    // 换页之后已勾选的人不能丢
    expect(checkboxes().some((box) => box.getAttribute('aria-checked') === 'true')).toBe(true)
    expect(document.body.textContent).toContain('已选 1 人')

    await typeInto(textInput('input[aria-label="搜索邮箱或用户名"]'), 'li')
    await waitFor(() => {
      expect(mockedAdminApi.listTeamMemberCandidates).toHaveBeenCalledWith('team-1', {
        page: 1,
        pageSize: 50,
        query: 'li',
      })
    })
    // 搜索后勾选依然保留
    expect(document.body.textContent).toContain('已选 1 人')

    await click(buttonByText('添加'))

    expect(mockedAdminApi.addTeamMembers).toHaveBeenCalledWith('team-1', ['user-2'])
  })
})

function teamRow(overrides: { id: string; name: string; memberCount: number }) {
  return {
    id: overrides.id,
    name: overrides.name,
    memberCount: overrides.memberCount,
    createdAt: '2026-09-10T06:22:00.000Z',
    updatedAt: '2026-09-10T06:22:00.000Z',
  }
}

function candidate(overrides: {
  id: string
  email: string
  handle: string
  status?: 'active' | 'disabled'
}) {
  return {
    id: overrides.id,
    email: overrides.email,
    handle: overrides.handle,
    status: overrides.status ?? ('active' as const),
  }
}

function render(node: ReactNode) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })

  act(() => {
    root?.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>)
  })
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click()
    await Promise.resolve()
  })
}

async function typeInto(input: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    )?.set
    valueSetter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await Promise.resolve()
  })
}

async function waitFor<T>(read: () => T, attempts = 40): Promise<T> {
  let lastError: unknown
  for (let index = 0; index < attempts; index += 1) {
    try {
      return read()
    } catch (error) {
      lastError = error
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
      })
    }
  }
  throw lastError
}

function textInput(selector: string): HTMLInputElement {
  const input = document.querySelector(selector)
  if (!(input instanceof HTMLInputElement)) throw new Error(`${selector} input not found`)
  return input
}

function checkboxes(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll('button[role="checkbox"]')).filter(
    (element): element is HTMLButtonElement => element instanceof HTMLButtonElement
  )
}

function teamActionsButton(name: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label="${name} 的团队操作"]`)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${name} actions button not found`)
  return button
}

function menuItemByText(text: string): HTMLElement {
  const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find((element) => element.textContent === text)
  if (!(item instanceof HTMLElement)) throw new Error(`${text} menu item not found`)
  return item
}

async function openMenu(button: HTMLButtonElement) {
  await act(async () => {
    button.dispatchEvent(new MouseEvent('pointerdown', {
      bubbles: true,
      button: 0,
      ctrlKey: false,
    }))
    await Promise.resolve()
  })
}

function dialogButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text && !item.closest('table'))
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} dialog button not found`)
  return button
}

function buttonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll('button'))
    .find((item) => item.textContent === text)
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${text} button not found`)
  return button
}
