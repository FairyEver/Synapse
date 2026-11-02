import '@/styles/globals.css'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { adminApi, type AdminMailMessageDetail } from '@/lib/api'
import MailPage from '@/features/mail'
import { WebhookDeliveryHistoryDetailSheet } from '@/features/webhook-deliveries/webhook-delivery-history-detail-sheet'

afterEach(() => vi.restoreAllMocks())

async function openMail(subject: string) {
  const message: AdminMailMessageDetail = {
    messageId: 'message-1', kind: 'user', subject, snippet: '正文', sentAt: '2026-11-01T00:00:00Z',
    sender: { userId: 'user-1', email: 'sender@example.invalid', handle: 'sender', nickname: '发送者' },
    toAddresses: [{ kind: 'user', userId: 'user-2', name: '收件人' }], ccAddresses: [],
    conversationId: 'conversation-1', relationKind: null, replyToId: null, forwardOfId: null,
    team: null, recipientCount: 1, attachmentCount: 0, senderDeletedAt: null,
    body: '正文', quote: null, attachments: [],
    delivery: { recipientCount: 1, readCount: 0, deletedCount: 0, pendingCount: 1 },
  }
  vi.spyOn(adminApi, 'listMailMessages').mockResolvedValue({ data: [message], total: 1, page: 1, pageSize: 20 })
  vi.spyOn(adminApi, 'getMailMessage').mockResolvedValue(message)
  vi.spyOn(adminApi, 'listMailContext').mockResolvedValue({ items: [], nextCursor: null })
  vi.spyOn(adminApi, 'listTeams').mockResolvedValue({ data: [], total: 0, page: 1, pageSize: 100 })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  await render(<QueryClientProvider client={client}><MailPage search={{}} /></QueryClientProvider>)
  await page.getByRole('button', { name: '查看', exact: true }).click()
}

async function openWebhook(title: string) {
  await render(<WebhookDeliveryHistoryDetailSheet open onOpenChange={() => undefined} delivery={{
    id: 'delivery', webhookId: 'webhook', method: 'POST', path: '/fixture', query: {}, headers: {}, bodyKind: 'json', bodySize: 2, bodyPreview: '{}',
    receivedAt: '2026-11-01T00:00:00Z', onlineClientCount: 0, sentClientCount: 0, failedClientCount: 0, acknowledgedClientCount: 0, clientReceipts: [], status: 'delivered',
    webhook: { id: 'webhook', publicId: 'fixture', name: title, currentName: title, deletedAt: null },
  }} />)
}

describe('drawer title and close control geometry', () => {
  for (const width of [390, 1280]) {
    for (const title of ['站内信与回调详情的完整标题用于检查关闭操作不会遮挡多行内容'.repeat(2), 'UnbrokenDeliveryOrMessageSubject'.repeat(4)]) {
      for (const [name, open] of [['mail', openMail], ['webhook', openWebhook]] as const) {
        it(`keeps ${name} ${title.startsWith('站') ? 'Chinese' : 'unbroken'} titles clear of close at ${width}px`, async () => {
          await page.viewport(width, 800)
          await open(title)
          const heading = page.getByRole('heading', { name: title, exact: true })
          await expect.element(heading).toBeVisible()
          // Tabs scroll shadows use scroll-driven animations that stay running while idle.
          // Wait for time-based entrance animations before measuring geometry.
          await expect.poll(() => document.getAnimations().some(animation => animation.playState === 'running' && animation.timeline instanceof DocumentTimeline)).toBe(false)
          const dialog = document.querySelector<HTMLElement>('[data-slot="drawer-dialog"]')!
          const close = document.querySelector<HTMLElement>('[data-slot="drawer-close-trigger"]')!.getBoundingClientRect()
          const titleRange = document.createRange()
          titleRange.selectNodeContents(heading.element())
          for (const line of titleRange.getClientRects()) {
            if (line.bottom > close.top && line.top < close.bottom) expect(line.right).toBeLessThanOrEqual(close.left - 8)
          }
          expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth)
          const bounds = dialog.getBoundingClientRect()
          expect(bounds.left).toBeGreaterThanOrEqual(0)
          expect(bounds.right).toBeLessThanOrEqual(width)
          await page.screenshot({ path: `/tmp/synapse-drawer-title-${name}-${width}-${title.startsWith('站') ? 'chinese' : 'unbroken'}.png` })
        })
      }
    }
  }
})
