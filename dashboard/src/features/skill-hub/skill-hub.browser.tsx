import '@/styles/globals.css'
import { toast } from '@heroui/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import type { SkillHubAdminRow, SkillHubDetail, SkillHubSummary } from '@synapse/shared/skill-hub-contracts'
import { ApiError } from '@/lib/api-client'
import { adminApi } from '@/lib/api'
import { routeTree } from '@/routeTree.gen'
import { useAuthStore } from '@/stores/auth-store'
import { useAdminAuthStore } from '@/stores/admin-auth-store'
import { TeamSkills } from '@/features/teams/team-skills'
import { skillHubApi } from './skill-hub-api'
import { normalizeSkillHubIcon } from './skill-icon-input'
import { openSkillInSynapse } from './skill-hub-navigation'

vi.mock('./skill-hub-navigation', { spy: true })

const long = '一个非常长的团队 Skill 名称'.repeat(5)
const person = { id: 'member_1', displayName: '原贡献者' }
const teams = [{ id: 'team_1', name: '产品设计组' }, { id: 'team_2', name: '跨团队联调组' + '长名称'.repeat(16) }]
const date = '2026-11-04T00:00:00.000Z'
const hash = 'a'.repeat(64)
const detail: SkillHubDetail = {
  id: 'skill_1', team: teams[0], displayName: long, displayDescription: '跨编辑器使用团队提供的操作指南。'.repeat(5) + '\n第二段：完整介绍。',
  iconUrl: '/api/skill-hub/skills/skill_1/icon',
  package: { name: 'real-package', description: 'Readonly package description' },
  currentVersion: { id: 'ver_2', number: 2, contentFingerprint: `sha256:${hash}`, archiveSha256: hash },
  createdBy: person, maintainer: { ...person, displayName: '当前维护者', isActiveMember: true }, publishedAt: date,
  revision: 7, permissions: { canEditMetadata: true, canPublishVersion: true, canDelete: true },
  files: [{ path: 'SKILL.md', size: 1234, sha256: hash }, { path: `references/${'long-file-name-'.repeat(20)}.md`, size: 200, sha256: hash }],
}
const summary = (id: string, name: string): SkillHubSummary => {
  const { files: _files, ...rest } = detail
  return { ...rest, id, displayName: name, iconUrl: id === detail.id ? detail.iconUrl : null, package: { name: rest.package.name } }
}
const assets: SkillHubAdminRow = {
  id: detail.id, team: teams[0], displayName: long, packageName: detail.package.name, createdBy: person,
  maintainer: detail.maintainer, currentVersionNumber: 2, revision: 7, deletedAt: date,
}

function queryClient() { return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }) }
function useFixtureAccount() {
  useAuthStore.getState().auth.setUser({ email: 'hub-fixture@example.test', handle: 'fixture', userId: 'hub-browser-account', sessionId: 'hub-browser-fixture' })
}
function screenshot(name: string, width: number) {
  return page.screenshot({ path: `/tmp/synapse-skill-hub-${name}-${width}.png`, animations: 'disabled' })
}
function assertFits(element: Element, width: number) {
  const rect = element.getBoundingClientRect()
  expect(rect.left).toBeGreaterThanOrEqual(-1)
  expect(rect.right).toBeLessThanOrEqual(width + 1)
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width + 1)
}
function assertDialog(element: Element, width: number) {
  assertFits(element, width)
  const rect = element.getBoundingClientRect()
  const header = element.querySelector('[data-slot="modal-header"],[data-slot="alert-dialog-header"]')!
  expect(header.getBoundingClientRect().left - rect.left).toBeGreaterThanOrEqual(20)
  expect(rect.right - header.getBoundingClientRect().right).toBeGreaterThanOrEqual(20)
  expect(element.contains(document.activeElement)).toBe(true)
}
function stubRead() {
  useFixtureAccount()
  vi.spyOn(skillHubApi, 'teams').mockImplementation(async (_session, cursor) => ({
    items: cursor ? [teams[1]] : [teams[0]], nextCursor: cursor ? null : 'more', selectionState: 'multiple', defaultTeamId: null,
  }))
  vi.spyOn(skillHubApi, 'list').mockResolvedValue({
    items: [summary(detail.id, long), summary('skill_2', '设计检查'), summary('skill_3', '发布检查')],
    nextCursor: null,
  })
  vi.spyOn(skillHubApi, 'get').mockResolvedValue(detail)
  vi.spyOn(skillHubApi, 'mainMarkdown').mockResolvedValue({
    versionId: 'ver_2', html: '<h1>包内说明</h1><p>Use this skill.</p>',
  })
  vi.spyOn(skillHubApi, 'icon').mockImplementation(async () => {
    const canvas = new OffscreenCanvas(256, 256)
    const context = canvas.getContext('2d')!
    context.fillRect(20, 20, 190, 190)
    return canvas.convertToBlob()
  })
}

async function mount(path = '/console/skill-hub/') {
  const client = queryClient()
  const router = createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [path] }), basepath: '/console',
    context: { queryClient: client } })
  return render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>)
}
async function maintenance(item: string) {
  await page.getByRole('button', { name: '更多操作' }).click()
  await page.getByRole('menuitem', { name: item, exact: true }).click()
}

afterEach(() => {
  toast.clear()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.reset()
  useAdminAuthStore.getState().auth.reset()
  for (const key of Object.keys(localStorage)) if (key.startsWith('synapse.hub.write:hub-browser-account:')) localStorage.removeItem(key)
})

for (const width of [320, 768, 1280]) describe(`Skill Hub browser fixture ${width}px`, () => {
  it('keeps the split install control filled through hover, press and menu focus', async () => {
    await page.viewport(width, 860)
    stubRead()
    const install = vi.mocked(openSkillInSynapse).mockClear().mockReturnValue('已尝试打开 Synapse')
    const view = await mount()
    try {
      const main = page.getByRole('button', { name: '安装 设计检查 到 Synapse', exact: true })
      const more = page.getByRole('button', { name: '更多 设计检查 操作', exact: true })
      const group = page.getByRole('group', { name: '设计检查 操作', exact: true })
      const background = (element: Element) => getComputedStyle(element).backgroundColor
      await userEvent.hover(main)
      await screenshot('catalog-install-hover', width)
      expect(background(more.element())).not.toBe('rgba(0, 0, 0, 0)')
      expect(background(main.element())).not.toBe('rgba(0, 0, 0, 0)')
      await userEvent.hover(more)
      await screenshot('catalog-more-hover', width)
      expect(background(main.element())).not.toBe('rgba(0, 0, 0, 0)')
      expect(background(more.element())).not.toBe('rgba(0, 0, 0, 0)')
      assertFits(group.element(), width)
      expect(install).not.toHaveBeenCalled()

      main.element().focus()
      await userEvent.keyboard('{Space>}')
      await expect.element(main).toHaveAttribute('data-pressed', 'true')
      expect(main.element().getBoundingClientRect().right).toBeCloseTo(more.element().getBoundingClientRect().left)
      expect(main.element().getBoundingClientRect().height).toBe(more.element().getBoundingClientRect().height)
      expect(background(more.element())).not.toBe('rgba(0, 0, 0, 0)')
      await screenshot('catalog-install-pressed', width)
      await userEvent.keyboard('{/Space}')
      expect(install).toHaveBeenCalledExactlyOnceWith('skill_2')
      await userEvent.tab()
      await expect.element(more).toHaveFocus()
      await screenshot('catalog-more-focus', width)
      await userEvent.keyboard('{Enter}')
      await expect.element(page.getByRole('menuitem', { name: '复制分享链接', exact: true })).toBeVisible()
      assertFits(page.getByRole('menu').element(), width)
      await screenshot('catalog-split-expanded', width)
      await userEvent.keyboard('{Escape}')
      await expect.element(more).toHaveFocus()
      expect(install).toHaveBeenCalledTimes(1)
    } finally { await userEvent.keyboard('{/Space}'); await view.unmount() }
  })

  it('shares the full store description from both menus without installing or navigating', async () => {
    await page.viewport(width, 860)
    stubRead()
    const get = vi.mocked(skillHubApi.get)
    const install = vi.mocked(openSkillInSynapse).mockClear().mockReturnValue('已尝试打开 Synapse')
    const clipboard = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue()
    const expected = `Skill：${detail.displayName}\n\n简介：${detail.displayDescription}\n\n链接：${window.location.origin}/console/skill-hub/${detail.id}`
    const view = await mount('/console/skill-hub/?q=guide#catalog')
    try {
      const restingInstall = page.getByRole('button', { name: '安装 设计检查 到 Synapse', exact: true })
      const restingMore = page.getByRole('button', { name: '更多 设计检查 操作', exact: true })
      await userEvent.hover(page.getByRole('heading', { name: 'Skill Hub', exact: true }))
      await expect.poll(() => getComputedStyle(restingMore.element()).backgroundColor === getComputedStyle(restingInstall.element()).backgroundColor).toBe(true)
      expect(getComputedStyle(restingMore.element()).color).toBe(getComputedStyle(restingInstall.element()).color)
      const trigger = page.getByRole('button', { name: `更多 ${long} 操作`, exact: true })
      await trigger.click()
      const menu = page.getByRole('menu')
      await expect.element(menu).toBeVisible()
      expect(menu.element().textContent).toBe('复制分享链接')
      assertFits(menu.element(), width)
      const item = page.getByRole('menuitem', { name: '复制分享链接', exact: true })
      const icon = item.element().querySelector('svg')!
      await expect.poll(() => icon.getBoundingClientRect().width).toBeCloseTo(16, 1)
      expect(getComputedStyle(item.element().querySelector('[data-slot="label"]')!).fontSize).toBe('14px')
      assertFits(menu.element(), width)
      await userEvent.hover(item)
      await screenshot('catalog-share-hover', width)
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(item).toHaveFocus()
      await screenshot('catalog-share-menu', width)
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => clipboard.mock.calls).toEqual([[expected]])
      await expect.element(menu).not.toBeInTheDocument()
      await expect.element(trigger).toHaveFocus()
      expect(install).not.toHaveBeenCalled()
      expect(get).not.toHaveBeenCalled()
      await expect.element(page.getByRole('searchbox')).toHaveValue('guide')

      const installButton = page.getByRole('button', { name: `安装 ${long} 到 Synapse`, exact: true })
      const left = installButton.element().getBoundingClientRect()
      const right = trigger.element().getBoundingClientRect()
      expect(left.right).toBeCloseTo(right.left)
      expect(left.height).toBe(page.getByRole('button', { name: '上传 Skill', exact: true }).element().getBoundingClientRect().height)
      expect(right.height).toBe(left.height)
      if (width < 768) expect(right.height).toBeGreaterThanOrEqual(40)
      expect(getComputedStyle(installButton.element()).borderTopRightRadius).toBe('0px')
      expect(getComputedStyle(trigger.element()).borderTopLeftRadius).toBe('0px')
      assertFits(trigger.element(), width)
      await installButton.click()
      expect(install).toHaveBeenCalledExactlyOnceWith(detail.id)

      get.mockResolvedValue({ ...detail, permissions: { canEditMetadata: false, canPublishVersion: false, canDelete: false } })
      await page.getByRole('link', { name: long, exact: true }).click()
      await page.getByRole('button', { name: '更多操作', exact: true }).click()
      await expect.element(menu).toBeVisible()
      expect(menu.element().textContent).toBe('复制分享链接')
      assertFits(menu.element(), width)
      await expect.poll(() => item.element().querySelector('svg')!.getBoundingClientRect().width).toBeCloseTo(16, 1)
      expect(getComputedStyle(item.element().querySelector('[data-slot="label"]')!).fontSize).toBe('14px')
      await userEvent.hover(item)
      await screenshot('detail-share-hover', width)
      await userEvent.keyboard('{ArrowDown}')
      await expect.element(item).toHaveFocus()
      await screenshot('detail-share-menu', width)
      await userEvent.keyboard('{Enter}')
      await expect.poll(() => clipboard.mock.calls).toEqual([[expected], [expected]])
      await expect.element(page.getByRole('button', { name: '更多操作', exact: true })).toHaveFocus()
      expect(install).toHaveBeenCalledTimes(1)

      clipboard.mockRejectedValueOnce(new Error('clipboard denied'))
      await page.getByRole('button', { name: '更多操作', exact: true }).click()
      await item.click()
      await expect.element(page.getByText('复制失败，请重试。', { exact: true })).toBeVisible()
      expect(install).toHaveBeenCalledTimes(1)
      await page.getByRole('button', { name: '更多操作', exact: true }).click()
      await userEvent.keyboard('{Escape}')
      await expect.element(menu).not.toBeInTheDocument()
      await expect.element(page.getByRole('button', { name: '更多操作', exact: true })).toHaveFocus()
    } finally { await view.unmount() }
  })

  it('shows the catalog, expands the complete team selector and opens latest-only detail', async () => {
    await page.viewport(width, 860)
    stubRead()
    const view = await mount('/console/skill-hub/?q=%22guide%22')
    try {
      await expect.element(page.getByRole('heading', { name: 'Skill Hub', exact: true })).toBeVisible()
      await expect.element(page.getByRole('link', { name: long, exact: true })).toBeVisible()
      assertFits(page.getByRole('list', { name: '团队 Skill' }).element(), width)
      await screenshot('catalog', width)
      await page.getByRole('button', { name: /团队.*全部团队|全部团队/u }).click()
      await expect.element(page.getByRole('option', { name: teams[1].name })).toBeVisible()
      assertFits(page.getByRole('listbox').element(), width)
      await screenshot('catalog-teams', width)
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByRole('listbox')).not.toBeInTheDocument()
      await page.getByRole('link', { name: long, exact: true }).click()
      await expect.element(page.getByRole('heading', { name: long, exact: true })).toBeVisible()
      await expect.poll(() => document.querySelectorAll('[role="tab"]').length).toBe(2)
      await expect.element(page.getByText('包内说明', { exact: true })).toBeVisible()
      expect(document.querySelector('img[src*="external.invalid"]')).toBeNull()
      await page.getByRole('tab', { name: '文件' }).click()
      await expect.element(page.getByText('SKILL.md', { exact: true })).toBeVisible()
      assertFits(page.getByRole('tabpanel').element(), width)
      await screenshot('detail-files', width)
      await page.getByRole('link', { name: 'Skill Hub', exact: true }).click()
      await expect.element(page.getByRole('searchbox')).toHaveValue('guide')
    } finally { await view.unmount() }
  })

  it('expands upload, store edit, version update, conflict and delete dialogs', async () => {
    await page.viewport(width, 860)
    stubRead()
    const update = vi.spyOn(skillHubApi, 'update').mockRejectedValue(new ApiError('Skill 资料已变化，请重新读取。', 409, 'HUB_REVISION_CONFLICT'))
    const stage = vi.spyOn(skillHubApi, 'upload').mockResolvedValue({ uploadId: 'fixture_upload', expiresAt: date })
    const publish = vi.spyOn(skillHubApi, 'publish').mockRejectedValue(new ApiError('包文件不合法。', 400, 'HUB_PACKAGE_INVALID'))
    const view = await mount()
    try {
      await page.getByRole('button', { name: '上传 Skill', exact: true }).click()
      const upload = page.getByRole('dialog', { name: '上传 Skill' })
      await expect.element(upload).toBeVisible()
      assertDialog(upload.element(), width)
      await expect.element(page.getByRole('button', { name: '选择 Markdown 或 ZIP' })).toBeDisabled()
      await page.getByRole('button', { name: /团队.*选择团队|选择团队/u }).click()
      await expect.element(page.getByRole('option', { name: teams[1].name })).toBeVisible()
      assertFits(page.getByRole('listbox').element(), width)
      await screenshot('upload-teams', width)
      await page.getByRole('option', { name: teams[1].name }).click()
      await expect.element(page.getByRole('button', { name: '选择 Markdown 或 ZIP' })).toBeEnabled()
      await screenshot('upload', width)
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await expect.element(upload).not.toBeInTheDocument()
      await page.getByRole('link', { name: long, exact: true }).click()

      await page.getByRole('button', { name: '更多操作' }).click()
      await expect.element(page.getByRole('menu')).toBeVisible()
      expect(page.getByRole('menu').element().textContent).toContain('复制分享链接')
      expect(page.getByRole('menu').element().textContent).not.toContain('复制 AI 更新指令')
      assertFits(page.getByRole('menu').element(), width)
      await screenshot('maintenance-menu', width)
      await page.getByRole('menuitem', { name: '编辑资料' }).click()
      await expect.element(page.getByRole('dialog', { name: '编辑资料' })).toBeVisible()
      assertDialog(page.getByRole('dialog', { name: '编辑资料' }).element(), width)
      await expect.element(page.getByRole('textbox', { name: '商店名称' })).toHaveValue(long)
      expect(page.getByRole('dialog', { name: '编辑资料' }).element().textContent).not.toContain('包内名称')
      await page.getByRole('textbox', { name: '商店名称' }).fill('新的商店名称')
      await page.getByRole('button', { name: '保存', exact: true }).click()
      await expect.element(page.getByRole('alert').filter({ hasText: 'Skill 资料已变化' })).toBeVisible()
      expect(update.mock.calls[0]?.[2]).toMatchObject({ expectedRevision: detail.revision, displayName: '新的商店名称' })
      await expect.element(page.getByRole('textbox', { name: '商店名称' })).toHaveValue('新的商店名称')
      await screenshot('edit-conflict', width)
      await page.getByRole('button', { name: '关闭', exact: true }).click()
      await expect.poll(() => document.activeElement?.getAttribute('aria-label')).toBe('更多操作')

      await maintenance('上传新版本')
      await expect.element(page.getByRole('dialog', { name: '上传新版本' })).toBeVisible()
      assertDialog(page.getByRole('dialog', { name: '上传新版本' }).element(), width)
      expect(page.getByRole('dialog', { name: '上传新版本' }).element().textContent).toContain(teams[0].name)
      const input = page.getByRole('dialog', { name: '上传新版本' }).element().querySelector('input[type=file][accept*=".md"]') as HTMLInputElement
      const data = new DataTransfer()
      data.items.add(new File(['invalid body'], 'fixture.zip', { type: 'application/zip' }))
      input.files = data.files
      input.dispatchEvent(new Event('change', { bubbles: true }))
      await page.getByRole('button', { name: '发布', exact: true }).click()
      await expect.element(page.getByRole('alert').filter({ hasText: '包文件不合法' })).toBeVisible()
      expect(stage.mock.calls[0]?.[1]).toMatchObject({ teamId: teams[0].id, format: 'zip' })
      expect(publish.mock.calls[0]?.[2]).toMatchObject({ expectedVersionId: detail.currentVersion.id })
      await screenshot('version-error', width)
      await page.getByRole('button', { name: '关闭', exact: true }).click()

      await maintenance('删除 Skill')
      const confirm = page.getByRole('alertdialog', { name: '删除 Skill？' })
      await expect.element(confirm).toBeVisible()
      assertDialog(confirm.element(), width)
      expect(confirm.element().textContent).toContain(long)
      await screenshot('delete-confirm', width)
      await page.getByRole('button', { name: '取消', exact: true }).click()
    } finally { await view.unmount() }
  })

  it('expands paged maintainer selection and keeps a failed restore marked deleted', async () => {
    await page.viewport(width, 860)
    useAdminAuthStore.getState().auth.setSession({ actorLabel: '平台管理员', sessionId: 'admin-hub-fixture', expiresAt: date })
    const members = vi.spyOn(adminApi, 'listTeamMembers').mockImplementation(async (_id, options) => ({
      total: 101, data: options?.page === 2
        ? [{ userId: 'eligible_later', email: 'later@example.test', handle: '后续页有效成员', status: 'active', joinedAt: date }]
        : [{ userId: 'disabled', email: 'disabled@example.test', handle: '已停用候选', status: 'disabled', joinedAt: date }],
    }))
    const list = vi.spyOn(adminApi, 'listTeamSkills').mockResolvedValue({ items: [assets], nextCursor: null })
    vi.spyOn(adminApi, 'assignSkillMaintainer').mockImplementation(async (_id, input) => {
      const row = { ...assets, revision: input.expectedRevision + 1, maintainer: { id: 'eligible_later', displayName: '新维护者', isActiveMember: true } }
      list.mockResolvedValue({ items: [row], nextCursor: null })
      return row
    })
    const restore = vi.spyOn(adminApi, 'restoreSkill').mockRejectedValue(new ApiError('无法确认 Skill 文件完整，条目仍保留为已删除。', 409, 'HUB_RESTORE_INCOMPLETE'))
    const view = await render(<QueryClientProvider client={queryClient()}><main className="@container/content min-w-0 p-4"><TeamSkills teamId={teams[0].id} /></main></QueryClientProvider>)
    try {
      await page.getByRole('button', { name: '指派维护者' }).click()
      const assign = page.getByRole('dialog', { name: '指派维护者' })
      await expect.element(assign).toBeVisible()
      assertDialog(assign.element(), width)
      await page.getByRole('button', { name: /新维护者.*选择有效成员|选择有效成员/u }).click()
      await expect.element(page.getByRole('option', { name: '后续页有效成员' })).toBeVisible()
      expect(page.getByRole('listbox').element().textContent).not.toContain('已停用候选')
      expect(members.mock.calls.some((call) => call[1]?.page === 2)).toBe(true)
      assertFits(page.getByRole('listbox').element(), width)
      await screenshot('assign-member', width)
      await page.getByRole('option', { name: '后续页有效成员' }).click()
      await page.getByRole('button', { name: '指派', exact: true }).click()
      await expect.element(page.getByText('新维护者', { exact: true })).toBeVisible()
      await page.getByRole('button', { name: '恢复', exact: true }).click()
      await expect.element(page.getByRole('alertdialog', { name: '恢复 Skill？' })).toBeVisible()
      assertDialog(page.getByRole('alertdialog').element(), width)
      await screenshot('restore-confirm', width)
      await page.getByRole('alertdialog').getByRole('button', { name: '恢复', exact: true }).click()
      await expect.element(page.getByRole('alert').filter({ hasText: '无法确认 Skill 文件完整' })).toBeVisible()
      expect(restore.mock.calls[0]?.[1]).toMatchObject({ expectedRevision: 8 })
      await screenshot('restore-error', width)
      await page.getByRole('button', { name: '取消', exact: true }).click()
      await expect.element(page.getByRole('grid', { name: '数据列表' }).getByText('已删除', { exact: true })).toBeVisible()
    } finally { await view.unmount() }
  })
})

it('keeps adjacent catalog entries aligned in one continuous list at a wide viewport', async () => {
  await page.viewport(1600, 860)
  stubRead()
  const view = await mount()
  try {
    const list = page.getByRole('list', { name: '团队 Skill' })
    await expect.element(list).toBeVisible()
    const [first, second] = [...list.element().children].map((row) => row.getBoundingClientRect())
    expect(second.left).toBeCloseTo(first.left)
    expect(second.width).toBeCloseTo(first.width)
    expect(second.top).toBeCloseTo(first.bottom)
    await screenshot('catalog', 1600)
  } finally { await view.unmount() }
})

it.each(['image/png', 'image/jpeg', 'image/webp'])('decodes %s bytes and emits a 256×256 PNG before upload', async (format) => {
  const source = new OffscreenCanvas(32, 16)
  source.getContext('2d')!.fillRect(0, 0, 32, 16)
  const raster = await source.convertToBlob({ type: format })
  expect(raster.type).toBe(format)
  const result = await normalizeSkillHubIcon(new File([raster], 'fixture', { type: format }))
  const bitmap = await createImageBitmap(result)
  try { expect([result.type, bitmap.width, bitmap.height]).toEqual(['image/png', 256, 256]) }
  finally { bitmap.close() }
  await expect(normalizeSkillHubIcon(new File(['<svg></svg>'], 'fake.png', { type: 'image/png' }))).rejects.toThrow()
})
