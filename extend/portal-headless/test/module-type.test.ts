import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  __setModuleTypeRulesForTest,
  normalizeMenuEntryPath,
  resolveModuleType,
} from '../src/context/module-type.js'

describe('normalizeMenuEntryPath —— 复刻前端 syncMenuContext()', () => {
  it('列表页原样返回', () => {
    expect(normalizeMenuEntryPath('/dashboard/hr/staff/staff-list/list')).toBe(
      '/dashboard/hr/staff/staff-list/list',
    )
  })

  it('详情/编辑/新建页归回所属列表页', () => {
    expect(normalizeMenuEntryPath('/dashboard/hr/staff/staff-list/detail/123')).toBe(
      '/dashboard/hr/staff/staff-list/list',
    )
    expect(normalizeMenuEntryPath('/dashboard/hr/staff/staff-list/edit/123')).toBe(
      '/dashboard/hr/staff/staff-list/list',
    )
    expect(normalizeMenuEntryPath('/dashboard/foo/create/new')).toBe('/dashboard/foo/list')
  })

  it('丢弃 query', () => {
    expect(normalizeMenuEntryPath('/dashboard/a/list?page=1')).toBe('/dashboard/a/list')
  })
})

describe('resolveModuleType', () => {
  beforeEach(() => {
    __setModuleTypeRulesForTest({
      generatedAt: 'test',
      source: 'test',
      rules: [
        { type: 13, label: '绩效管理', kind: 'prefix', prefixes: ['/dashboard/analysis/'] },
        { type: 60, label: '销售系统', kind: 'paths', paths: ['/dashboard/sale/marketing/charm/list'] },
      ],
    })
  })

  afterEach(() => {
    __setModuleTypeRulesForTest(null)
  })

  it('前缀规则命中', () => {
    const result = resolveModuleType('/dashboard/analysis/person/list')
    expect(result.moduleType).toBe(13)
    expect(result.matchedBy).toBe('rule')
  })

  it('精确路径规则命中', () => {
    const result = resolveModuleType('/dashboard/sale/marketing/charm/list')
    expect(result.moduleType).toBe(60)
  })

  it('详情页先归并成列表页再匹配', () => {
    const result = resolveModuleType('/dashboard/analysis/person/detail/9')
    expect(result.moduleType).toBe(13)
  })

  it('匹配不到时返回 null —— 与浏览器"不发这个头"的行为对齐（设计 D34）', () => {
    const result = resolveModuleType('/dashboard/platform/market/store/entry/list')
    expect(result.moduleType).toBeNull()
    expect(result.matchedBy).toBe('none')
  })
})
