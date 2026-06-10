import { describe, expect, it } from 'vitest'
import {
  buildContentStoreSearch,
  parseContentStoreSearch,
} from './content-store-search'

describe('content store search helpers', () => {
  it('parses valid route search state', () => {
    expect(
      parseContentStoreSearch({
        page: '2',
        pageSize: '30',
        sortBy: 'installCount',
        sortOrder: 'asc',
        type: 'rule',
        query: ' deploy ',
      })
    ).toMatchObject({
      page: 2,
      pageSize: 30,
      sortBy: 'installCount',
      sortOrder: 'asc',
      type: 'rule',
      query: ' deploy ',
    })
  })

  it('drops invalid route search values', () => {
    expect(
      parseContentStoreSearch({
        page: '0',
        pageSize: '-1',
        sortBy: 'title',
        sortOrder: 'left',
        type: 'plugin',
      })
    ).toMatchObject({
      page: 1,
      pageSize: 10,
      sortBy: undefined,
      sortOrder: undefined,
      type: undefined,
      query: '',
    })
  })

  it('builds API query search values', () => {
    expect(
      buildContentStoreSearch({
        page: 1,
        pageSize: 20,
        sortBy: 'updatedAt',
        sortOrder: 'desc',
        type: 'skill',
        query: '  sync  ',
      })
    ).toEqual({
      page: 1,
      pageSize: 20,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
      type: 'skill',
      query: 'sync',
    })
  })
})
