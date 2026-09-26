import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  CHAT_AGENT_ORCHESTRATION_DICT_TYPE,
  CHAT_DEFAULT_CALL_TYPE,
  CHAT_DEFAULT_HISTORY_PAGE_SIZE,
  CHAT_MAX_ATTACHMENTS,
  CHAT_MAX_IMAGES,
  CHAT_MAX_CHECKED_SKILLS,
  CHAT_METHODS,
  chatCapabilities,
  createChatCapability,
} from '../src/capabilities/chat.js'

function harness (responses: unknown[] = [], dictionary = { entries: [{ label: 'is_open', value: '1' }] }) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return {
    calls,
    api: createChatCapability(request, async () => dictionary),
  }
}

async function* sseChunks () {
  yield 'data: {"data":{"type":"heartbeat"}}\n'
  yield 'event: message\n'
  yield 'data: {"ret":"SUCCESS","data":{"answer":"你好","contentItems":[{"type":"text","content":"你好"}]}}\n\n'
  yield 'data: {"ret":"SUCCESS","data":{"id":901,"answer":"完成","router":"/dashboard/chat","routerParameter":{}}}\n\n'
}

describe('智能助手页面能力', () => {
  it('锁定页面入口、权限、实例和方法映射', () => {
    expect(chatCapabilities).toHaveLength(9)
    expect(chatCapabilities.every(definition =>
      definition.pagePath === '/dashboard/chat' &&
      definition.permission === '/dashboard/chat' &&
      definition.moduleType === null &&
      definition.httpInstance === 'platform')).toBe(true)
    expect(CHAT_METHODS['chat-stream']).toBe('stream')
    expect(new Set(Object.keys(CHAT_METHODS)).size).toBe(chatCapabilities.length)
  })

  it('按页面固定参数读取模型技能和历史', async () => {
    const { api, calls } = harness([{ models: [], skills: [] }, { list: [], total: 0 }])
    await api.availableList()
    await api.history()
    expect(calls[0]).toEqual({
      url: '/ai/pc/chat/getAvailableList',
      method: 'get',
      params: { callType: CHAT_DEFAULT_CALL_TYPE },
    })
    expect(calls[1]).toEqual({
      url: '/ai/pc/chat/history',
      method: 'get',
      params: { pageNo: 1, pageSize: CHAT_DEFAULT_HISTORY_PAGE_SIZE },
    })
  })

  it('严格复刻聊天流FormData字段顺序、技能/模型互斥和字典开关', async () => {
    const { api, calls } = harness([{ data: sseChunks() }])
    const stream = api.stream({
      question: '  帮我总结  ',
      skillId: 12,
      modelConfigId: 88,
      intent: 'summary',
      categoryIds: '1,2',
      moduleIds: '3',
      imageIds: 'img-1',
      files: [{ name: 'note.txt', contentType: 'text/plain', data: 'aGVsbG8=' }],
    })
    const events = []
    for await (const event of stream) events.push(event)

    expect(events).toEqual([
      { ret: 'SUCCESS', data: { answer: '你好', contentItems: [{ type: 'text', content: '你好' }] } },
      { ret: 'SUCCESS', data: { id: 901, answer: '完成', router: '/dashboard/chat', routerParameter: {} } },
    ])
    expect(calls[0]).toMatchObject({
      url: '/ai/pc/chat/chatStream',
      method: 'post',
      responseType: 'stream',
      sourceResponse: true,
      headers: { version: '3' },
    })
    const form = calls[0]?.data as FormData
    expect(form).toBeInstanceOf(FormData)
    expect([...form.entries()].map(([key, value]) => [key, typeof value === 'string' ? value : value.name])).toEqual([
      ['question', '帮我总结'],
      ['type', '1'],
      ['skillId', '12'],
      ['requestId', expect.any(String)],
      ['platform', 'PC'],
      ['agentOrchestration', 'true'],
      ['intent', 'summary'],
      ['categoryIds', '1,2'],
      ['moduleIds', '3'],
      ['imageIds', 'img-1'],
      ['files', 'note.txt'],
    ])
    expect((form.get('requestId') as string)).toMatch(/^[0-9a-f]{32}$/)
    expect([...form.keys()]).not.toContain('modelConfigId')
  })

  it('在无技能时才传modelConfigId，并保留文件数量/图片数量限制', async () => {
    const { api, calls } = harness([{ data: sseChunks() }], { entries: [{ label: 'is_open', value: '0' }] })
    const stream = api.stream({
      question: '读取附件',
      modelConfigId: '88',
      files: [{ name: 'note.txt', data: 'hello', encoding: 'utf8' }],
    })
    await stream.next()
    const form = calls[0]?.data as FormData
    expect(form.get('modelConfigId')).toBe('88')
    expect(form.get('agentOrchestration')).toBe('false')

    const tooMany = Array.from({ length: CHAT_MAX_ATTACHMENTS + 1 }, (_, index) => ({ name: `f${index}.txt`, data: 'x' }))
    await expect(api.stream({ question: 'x', files: tooMany }).next()).rejects.toThrow('最多上传')
    const tooManyImages = Array.from({ length: CHAT_MAX_IMAGES + 1 }, (_, index) => ({ name: `f${index}.png`, data: 'x' }))
    await expect(api.stream({ question: 'x', files: tooManyImages }).next()).rejects.toThrow('最多')
    expect(calls).toHaveLength(1)
  })

  it('反馈AI契约明确GET/POST冲突、业务ret门禁和外部缺口', async () => {
    const { CHAT_CONTRACTS } = await import('../src/catalog/contracts-chat.js')
    const contract = CHAT_CONTRACTS['chat-feedback']!
    expect(contract.boundaries.join('\n')).toContain('只声明POST')
    expect(contract.boundaries.join('\n')).toContain('HTTP 200但ret不是SUCCESS')
    expect(contract.failures.join('\n')).toContain('不可交付')
    expect(contract.gaps?.join('\n')).toContain('先写FAIL后又覆盖为SUCCESS')
  })

  it('明确选择Portal兼容GET，保留c凭据参数并拒绝HTTP200业务失败', async () => {
    const { api, calls } = harness([{ data: { ret: 'SUCCESS' } }])
    await api.feedback({ id: '901', useful: 1 })
    expect(calls[0]).toEqual({
      url: 'ai/updateUseful.json',
      method: 'get',
      params: { id: '901', useful: 1 },
      tokenParamName: 'c',
      skipGetCacheParam: true,
      sourceResponse: true,
    })

    const failed = harness([{ data: { ret: 'FAIL', msg: '数据不存在' } }])
    await expect(failed.api.feedback({ id: '901', useful: 1 })).rejects.toThrow('数据不存在')
  })

  it('技能排序遵守页面至少1个、最多8个，并把恢复默认拆成独立reset', async () => {
    const { api, calls } = harness([{ skills: [], defaultSkills: [], displayCount: 8, customized: false }, true, true])
    await api.skillOrder()
    expect(api.prepareSaveSkillOrder({ skillIds: [1] })).toEqual({ skillIds: [1] })
    expect(() => api.prepareSaveSkillOrder({ skillIds: [] })).toThrow('不能为空')
    expect(() => api.prepareSaveSkillOrder({ skillIds: Array.from({ length: CHAT_MAX_CHECKED_SKILLS + 1 }, (_, index) => index + 1) })).toThrow('最多')
    await api.saveSkillOrder({ skillIds: [1, '2'] })
    await api.resetSkillOrder()
    expect(calls.slice(1)).toEqual([
      { url: '/ai/pc/chat/skill-order/save', method: 'put', data: { skillIds: [1, '2'] } },
      { url: '/ai/pc/chat/skill-order/reset', method: 'put', data: null },
    ])
  })

  it('政策预览按回答动作中的制度ID读取原始详情', async () => {
    const { api, calls } = harness([{}])
    await api.policyPreview(7)
    expect(calls[0]).toEqual({ url: '/system/policy/get', method: 'get', params: { id: 7 } })
  })

  it('空问题、非法反馈值和非法分页在请求前失败', async () => {
    const { api, calls } = harness()
    await expect(api.stream({ question: ' ' }).next()).rejects.toThrow('至少提供一项')
    await expect(api.feedback({ id: 1, useful: 2 as 0 | 1 })).rejects.toThrow('0或1')
    await expect(api.history({ pageNo: 0 })).rejects.toThrow('正整数')
    expect(calls).toHaveLength(0)
  })

  it('字典读取失败时按页面回退为关闭编排', async () => {
    const calls: Array<Record<string, unknown>> = []
    const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
      calls.push(config as unknown as Record<string, unknown>)
      return { data: sseChunks() } as T
    }
    const api = createChatCapability(request, async () => { throw new Error('dictionary unavailable') })
    const stream = api.stream({ question: 'x' })
    await stream.next()
    expect((calls[0]?.data as FormData).get('agentOrchestration')).toBe('false')
    expect(CHAT_AGENT_ORCHESTRATION_DICT_TYPE).toBe('ai_agent_orchestration_status')
  })

  it('收到Portal流式错误事件后停止继续消费', async () => {
    async function* errorStream () {
      yield 'data: {"msg":"模型暂不可用"}\n'
      yield 'data: {"data":{"id":902}}\n'
    }
    const { api } = harness([{ data: errorStream() }])
    const events = []
    for await (const event of api.stream({ question: 'x' })) events.push(event)
    expect(events).toEqual([{ msg: '模型暂不可用' }])
  })
})
