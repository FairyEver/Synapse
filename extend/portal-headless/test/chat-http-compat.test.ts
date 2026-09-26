import { describe, expect, it } from 'vitest'
import type { AxiosRequestConfig, AxiosResponse } from 'axios'

import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'

describe('智能助手兼容接口请求规则', () => {
  it('feedback的c参数使用会话token，且不追加platform GET的_t', async () => {
    let seen: AxiosRequestConfig | undefined
    const http = createPortalHttp({
      baseUrl: 'https://example.invalid',
      credential: { token: 'session-token', tenantId: 7 },
    })
    await http.request({
      url: 'ai/updateUseful.json',
      method: 'get',
      params: { c: 'other-user-token', id: 901, useful: 1 },
      tokenParamName: 'c',
      skipGetCacheParam: true,
      sourceResponse: true,
      adapter: async (config): Promise<AxiosResponse> => {
        seen = config
        return {
          data: { ret: 'SUCCESS', data: true },
          status: 200,
          statusText: 'OK',
          headers: {},
          config,
        }
      },
    } as PortalRequestConfig)
    expect(seen?.url).toBe('ai/updateUseful.json?c=session-token&id=901&useful=1')
    expect(seen?.params).toEqual({})
    expect(seen?.url).not.toContain('_t')
  })
})
