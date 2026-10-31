import '@/styles/globals.css'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { LongText } from './long-text'

const content = '需要完整显示的很长文件名称-synapse-backup-20261101.sql.gz'
describe('truncated text', () => {
  it('opens the full text on narrow-screen press', async () => {
    await page.viewport(390, 844)
    await render(<div className='w-32'><LongText>{content}</LongText></div>)
    const trigger = page.getByRole('button', { name: content })
    await expect.element(trigger).toBeVisible()
    await trigger.click()
    await expect.element(page.getByRole('dialog')).toHaveTextContent(content)
  })
  it('exposes the full text to keyboard focus on desktop', async () => {
    await page.viewport(1280, 900)
    await render(<div className='w-32'><LongText>{content}</LongText></div>)
    const trigger = page.getByRole('button', { name: content })
    await expect.element(trigger).toBeVisible()
    ;(trigger.element() as HTMLElement).focus()
    await expect.element(page.getByRole('tooltip')).toHaveTextContent(content)
  })
})
