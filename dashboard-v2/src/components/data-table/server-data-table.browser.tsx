import '@/styles/globals.css'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { ServerDataTable } from './server-data-table'

describe('wide data tables', () => {
  it('keeps the page size and page controls on the same desktop row', async () => {
    await page.viewport(1280, 900)
    await render(
      <div className='w-5xl max-w-full' data-testid='table-footer-host'>
        <ServerDataTable
          columns={[{ accessorKey: 'name', header: '名称', enableHiding: false }]}
          data={[{ name: '示例' }]}
          page={1}
          pageSize={10}
          total={1}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
        />
      </div>
    )
    await expect.poll(() => document.querySelector('[data-testid="table-footer-host"] [aria-label="第 1 页"]')).not.toBeNull()
    const host = document.querySelector<HTMLElement>('[data-testid="table-footer-host"]')!
    const size = host.querySelector<HTMLElement>('[data-slot="select-trigger"]')!
    const pageButton = host.querySelector<HTMLElement>('[aria-label="第 1 页"]')!
    expect(Math.abs(size.getBoundingClientRect().top - pageButton.getBoundingClientRect().top)).toBeLessThan(12)
  })

  it('keeps labels on one line and confines horizontal scrolling to the table', async () => {
    await page.viewport(390, 844)
    const columns = Array.from({ length: 9 }, (_, index) => ({ accessorKey: `field${index}`, header: `统计字段${index}`, enableHiding: false }))
    await render(
      <div className='w-96' data-testid='table-host'>
        <ServerDataTable
          columns={columns}
          data={[Object.fromEntries(columns.map((column) => [column.accessorKey, '正常']))]}
          page={1}
          pageSize={10}
          total={1}
          onPageChange={() => undefined}
          onPageSizeChange={() => undefined}
          showPagination={false}
        />
      </div>
    )
    await expect.poll(() => document.querySelectorAll('tbody tr').length).toBe(1)
    const host = document.querySelector<HTMLElement>('[data-testid="table-host"]')!
    const scroller = host.querySelector<HTMLElement>('[data-slot="table-scroll-container"]')!
    const header = host.querySelector('th')!
    const range = document.createRange()
    range.selectNodeContents(header)
    expect(range.getClientRects().length).toBe(1)
    expect(scroller.scrollWidth).toBeGreaterThan(scroller.clientWidth)
    expect(scroller.getBoundingClientRect().width).toBeLessThanOrEqual(host.clientWidth)
  })
})


describe('narrow table states', () => {
  it.each([false, true])('keeps the empty/error state visible before horizontal scrolling (error=%s)', async (hasError) => {
    await page.viewport(390, 844)
    const columns = Array.from({ length: 9 }, (_, index) => ({ accessorKey: `field${index}`, header: `统计字段${index}`, enableHiding: false }))
    await render(<div className='w-80'><ServerDataTable columns={columns} data={[]} page={1} pageSize={10} total={0} onPageChange={() => undefined} onPageSizeChange={() => undefined} error={hasError ? new Error('加载失败') : undefined} onRetry={() => undefined} /></div>)
    const label = hasError ? page.getByRole('alert') : page.getByText('暂无数据')
    const rect = label.element().getBoundingClientRect()
    expect(rect.left).toBeGreaterThanOrEqual(0)
    expect(rect.right).toBeLessThanOrEqual(390)
  })

  it('keeps every pagination action within a narrow footer', async () => {
    await page.viewport(390, 844)
    await render(<div className='w-80'><ServerDataTable columns={[{ accessorKey: 'name', header: '名称' }]} data={[{ name: '示例' }]} page={6} pageSize={10} total={200} onPageChange={() => undefined} onPageSizeChange={() => undefined} /></div>)
    const buttons = document.querySelectorAll('nav[aria-label="pagination"] button')
    for (const button of buttons) expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(390)
  })
})
