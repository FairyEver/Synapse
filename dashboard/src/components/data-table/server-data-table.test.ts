import { describe, expect, it } from 'vitest'

import * as dataTableExports from './index'
import { getServerDataTableErrorMessage } from './server-data-table'

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
