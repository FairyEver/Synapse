import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Card } from '@heroui/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { dashboardApi, adminApi } from '@/lib/api'
import { UserAuthForm } from '@/features/auth/sign-in/components/user-auth-form'
import { SkillRepositorySettingsDialog } from '@/features/skill-repository/skill-repository-settings-dialog'
import { ApiKeysSettings } from '@/features/settings/api-keys-settings'
import { WebhookFormDialog } from '@/features/webhooks'
import LogsPage from '@/features/logs'

vi.mock('@tanstack/react-router', async (original) => ({
  ...await original<typeof import('@tanstack/react-router')>(),
  useNavigate: () => vi.fn(),
}))
afterEach(() => vi.restoreAllMocks())

function distinguish(field: Element, surface: Element) {
  const background = getComputedStyle(field).backgroundColor
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(background).not.toBe(getComputedStyle(surface).backgroundColor)
}

function queryProvider(children: React.ReactNode) {
  return <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{children}</QueryClientProvider>
}

describe('field contrast on HeroUI surfaces', () => {
  for (const width of [390, 1280]) {
    it(`distinguishes webhook fields from the overlay at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<WebhookFormDialog form={{ mode: 'create', webhook: null, name: '' }} isSaving={false} onFormChange={() => undefined} onSubmit={(event) => event.preventDefault()} />)
      distinguish(page.getByRole('textbox', { name: '名称' }).element(), page.getByRole('dialog').element())
    })

    it(`distinguishes login inputs and password groups from cards at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<Card><Card.Content><UserAuthForm /></Card.Content></Card>)
      const card = document.querySelector('[data-slot="card"]')!
      distinguish(page.getByRole('textbox', { name: '邮箱' }).element(), card)
      const group = document.querySelector('[data-slot="input-group"]')!
      distinguish(group, card)
      const password = document.querySelector<HTMLInputElement>('#auth-password')!
      await page.getByRole('button', { name: '显示密码' }).click()
      expect(password.type).toBe('text')
      distinguish(group, card)
    })

    it(`distinguishes textareas and selectors inside settings dialogs at ${width}px`, async () => {
      await page.viewport(width, 800)
      await render(<SkillRepositorySettingsDialog open saving={false} deleting={false} error={null} onOpenChange={() => undefined} onSave={async () => undefined} onDelete={async () => undefined} repository={{
        id: 'fixture-repository', name: 'fixture', title: '布局回归', description: null, visibility: 'private', status: 'active', owner: { id: 'fixture-user', handle: 'fixture' },
        forkedFromRepositoryId: null, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', lastSyncedAt: null, files: [],
      }} />)
      const dialog = page.getByRole('dialog').element()
      distinguish(page.getByRole('textbox', { name: '描述' }).element(), dialog)
      distinguish(document.querySelector('[data-slot="select-trigger"]')!, dialog)
      distinguish(page.getByRole('textbox', { name: '仓库名' }).element(), dialog)
    })

    it(`distinguishes unchecked permission controls on overlays at ${width}px`, async () => {
      await page.viewport(width, 800)
      vi.spyOn(dashboardApi, 'listApiKeys').mockResolvedValue([])
      vi.spyOn(dashboardApi, 'listApiKeyCapabilities').mockResolvedValue([{ scope: 'fixture.permission', name: '测试权限', description: '回归夹具', documentationUrl: 'https://example.invalid/docs' }])
      await render(queryProvider(<ApiKeysSettings />))
      await page.getByRole('button', { name: '创建密钥' }).click()
      await expect.element(page.getByRole('checkbox', { name: '测试权限' })).toBeVisible()
      distinguish(document.querySelector('[data-slot="checkbox-control"]')!, page.getByRole('dialog').element())
    })
  }

  it('retains contrasting primary controls on the page background', async () => {
    vi.spyOn(adminApi, 'fetchRecentLogs').mockResolvedValue([])
    await render(queryProvider(<LogsPage />))
    distinguish(page.getByRole('spinbutton', { name: '日志条数' }).element(), document.body)
    distinguish(document.querySelector('[data-slot="select-trigger"]')!, document.body)
  })
})
