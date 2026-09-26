import { describe, expect, it } from 'vitest'

import type { CapabilityDefinition } from '../src/capabilities/types.js'
import { createCatalog } from '../src/catalog/index.js'

const PAGE_PATH = '/dashboard/org/org-type/list'

function describeEntry (definition: CapabilityDefinition) {
  const result = createCatalog({ capabilities: [definition] }).describe(definition.id)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('能力描述失败')
  return result.howToCall.entryPoints[0]!
}

describe('能力级 module-type 覆盖', () => {
  it('未覆盖时仍按页面推导', () => {
    const entry = describeEntry({
      id: 'test-module-type-derived',
      title: '测试页面推导',
      pagePath: PAGE_PATH,
      write: false,
      params: [],
    })

    expect(entry.moduleType).toMatchObject({ value: 11, sent: true })
  })

  it('null 表示该动作按浏览器基准明确不发 module-type', () => {
    const entry = describeEntry({
      id: 'test-module-type-omitted',
      title: '测试明确省略',
      pagePath: PAGE_PATH,
      moduleType: null,
      write: true,
      params: [],
    })

    expect(entry.moduleType).toEqual({ value: null, label: null, sent: false })
  })
})
