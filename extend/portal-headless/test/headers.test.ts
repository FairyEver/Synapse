import { describe, expect, it } from 'vitest'

import { buildHeaders } from '../src/http/headers.js'

describe('buildHeaders —— 复刻 Portal 前端 generateHttpHeaders()', () => {
  it('按 tenant-id / token / module-type / Accept-Language 的顺序产出四个头', () => {
    const headers = buildHeaders({
      credential: { token: 'tk-1', tenantId: 42 },
      moduleType: 41,
    })

    expect(Object.keys(headers)).toEqual(['tenant-id', 'token', 'module-type', 'Accept-Language'])
    expect(headers['tenant-id']).toBe('42')
    expect(headers.token).toBe('tk-1')
    expect(headers['module-type']).toBe('41')
    expect(headers['Accept-Language']).toBe('zh-CN')
  })

  it('module-type 为 undefined 时不写这个头（设计 D34：与浏览器一致）', () => {
    const headers = buildHeaders({
      credential: { token: 'tk-1', tenantId: 1 },
      moduleType: undefined,
    })

    expect(headers).not.toHaveProperty('module-type')
  })

  it('tenantId 为空时不写 tenant-id', () => {
    const headers = buildHeaders({
      credential: { token: 'tk-1', tenantId: '' },
      moduleType: 12,
    })

    expect(headers).not.toHaveProperty('tenant-id')
  })

  it('language 可覆盖', () => {
    const headers = buildHeaders({
      credential: { token: 'tk-1', tenantId: 1 },
      moduleType: 12,
      language: 'en-US',
    })

    expect(headers['Accept-Language']).toBe('en-US')
  })
})
