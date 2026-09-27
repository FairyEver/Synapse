// @vitest-environment jsdom

import { type ColumnDef } from '@tanstack/react-table'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import * as dataTableExports from './index'
import { DataTableColumnHeader } from './column-header'
import {
  ServerDataTable,
  getServerDataTableBoundedPage,
  getServerDataTableErrorMessage,
  getServerDataTablePageCount,
  getServerDataTablePinnedColumnClass,
} from './server-data-table'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
})

describe('data table defaults', () => {
  it('exports the dashboard list default page size', () => {
    expect(
      (dataTableExports as Record<string, unknown>).DEFAULT_DASHBOARD_PAGE_SIZE
    ).toBe(10)
  })
})

describe('getServerDataTableErrorMessage', () => {
  it('uses useful error messages', () => {
    expect(getServerDataTableErrorMessage(new Error('服务端异常'))).toBe(
      '服务端异常'
    )
    expect(getServerDataTableErrorMessage('网络异常')).toBe('网络异常')
  })

  it('falls back when the error has no readable message', () => {
    expect(getServerDataTableErrorMessage(new Error(''))).toBe('列表加载失败')
    expect(getServerDataTableErrorMessage(null)).toBe('列表加载失败')
  })
})

describe('server table pagination bounds', () => {
  it('keeps empty datasets on page one', () => {
    expect(getServerDataTablePageCount(0, 10)).toBe(1)
    expect(getServerDataTableBoundedPage(3, 0, 10)).toBe(1)
  })

  it('clamps stale pages after total shrinks', () => {
    expect(getServerDataTablePageCount(21, 10)).toBe(3)
    expect(getServerDataTableBoundedPage(3, 20, 10)).toBe(2)
  })

  it('normalizes invalid page and page size values', () => {
    expect(getServerDataTablePageCount(5, 0)).toBe(5)
    expect(getServerDataTableBoundedPage(0, 25, 10)).toBe(1)
  })
})

describe('server table pinned columns', () => {
  it('pins the actions column to the right edge', () => {
    expect(getServerDataTablePinnedColumnClass('actions')).toContain('sticky')
    expect(getServerDataTablePinnedColumnClass('actions')).toContain('right-0')
    expect(getServerDataTablePinnedColumnClass('name')).toBe('')
  })
})

describe('ServerDataTable', () => {
  it('keeps the requested page until its data loads successfully', () => {
    const onPageChange = vi.fn()
    const columns: ColumnDef<{ email: string }>[] = [
      { accessorKey: 'email', header: '邮箱' },
    ]
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    const renderPage = (total: number, isLoading: boolean, error?: Error) => {
      act(() => {
        root?.render(createElement(ServerDataTable, {
          columns,
          data: [],
          page: 3,
          pageSize: 10,
          total,
          isLoading,
          error,
          onPageChange,
          onPageSizeChange: () => undefined,
        }))
      })
    }

    renderPage(0, true)
    expect(onPageChange).not.toHaveBeenCalled()

    renderPage(0, false, new Error('请求失败'))
    expect(onPageChange).not.toHaveBeenCalled()

    renderPage(43, false)
    expect(onPageChange).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('第 3 / 5 页')

    renderPage(20, false)
    expect(onPageChange).toHaveBeenCalledExactlyOnceWith(2)
  })

  it('shows column visibility controls for hideable server columns', async () => {
    type Row = {
      email: string
      repositoryName: string
    }

    const columns: ColumnDef<Row>[] = [
      {
        accessorKey: 'email',
        header: ({ column }) => (
          createElement(DataTableColumnHeader, { column, title: '邮箱' })
        ),
      },
      {
        id: 'repositoryName',
        header: ({ column }) => (
          createElement(DataTableColumnHeader, { column, title: '仓库' })
        ),
        cell: ({ row }) => row.original.repositoryName,
        enableSorting: false,
      },
    ]

    renderServerTable(columns, [
      { email: 'admin@example.com', repositoryName: '核心仓库' },
    ])

    const viewButton = buttonByText('View')
    expect(viewButton).not.toBeNull()

    await click(viewButton)

    expect(document.body.textContent).toContain('email')
    expect(document.body.textContent).toContain('repositoryName')
  })
})

function renderServerTable<TData>(columns: ColumnDef<TData>[], data: TData[]) {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)

  act(() => {
    root?.render(createElement(ServerDataTable<TData, unknown>, {
      columns,
      data,
      page: 1,
      pageSize: 10,
      total: data.length,
      onPageChange: () => undefined,
      onPageSizeChange: () => undefined,
      showPagination: false,
    }))
  })
}

async function click(element: HTMLElement | null) {
  if (!element) throw new Error('button not found')
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }))
    element.click()
    await Promise.resolve()
  })
}

function buttonByText(text: string): HTMLButtonElement | null {
  const button = Array.from(document.querySelectorAll('button'))
    .find((element) => element.textContent?.trim() === text)
  return button instanceof HTMLButtonElement ? button : null
}
