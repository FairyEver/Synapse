import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  MY_URGE_COMPLETION_OPTIONS,
  MY_URGE_CREATE_PATH,
  MY_URGE_DETAIL_PATH,
  MY_URGE_METHODS,
  MY_URGE_PAGE_PATH,
  MY_URGE_PERMISSION,
  createMyUrgeCapability,
  myUrgeCapabilities,
  type MyUrgeCreateDraft,
} from '../src/capabilities/my-urge.js'

function harness (responses: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return { calls, api: createMyUrgeCapability(request) }
}

function createDraft (overrides: Partial<MyUrgeCreateDraft> = {}): MyUrgeCreateDraft {
  return {
    degreeType: 1,
    taskName: '季度复盘',
    taskDescription: '请在计划日期前完成复盘并反馈。',
    superviseeList: [{ supervisee: 1001 }, { supervisee: '1002' }],
    endDate: '2099-09-30',
    ...overrides,
  }
}

describe('我的督办页面能力', () => {
  it('按Portal顺序投影列表筛选，并固定当前用户发起人范围', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.list()
    expect(calls[0]).toEqual({
      url: '/hr/oversee-task/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        taskName: null,
        superviseeName: null,
        endDate: null,
        isComplete: 0,
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(calls[0]?.params).not.toHaveProperty('supervisor')
    expect(myUrgeCapabilities.every(definition =>
      definition.pagePath === MY_URGE_PAGE_PATH &&
      definition.permission === MY_URGE_PERMISSION &&
      definition.moduleType === null &&
      definition.httpInstance === 'platform')).toBe(true)
  })

  it('支持负责人、督办内容、日期、状态和分页筛选', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.list({ taskName: '季度', superviseeName: '张三', endDate: '2099-09-30', isComplete: 1, pageNo: 3, pageSize: 50 })
    expect(calls[0]?.params).toEqual({
      order: '',
      orderField: '',
      taskName: '季度',
      superviseeName: '张三',
      endDate: '2099-09-30',
      isComplete: 1,
      pageNo: 3,
      pageSize: 50,
    })
    expect(MY_URGE_COMPLETION_OPTIONS).toEqual([
      { label: '督办事项', value: 0 },
      { label: '督办完成', value: 1 },
    ])
  })

  it('按负责人弹窗的真实接口搜索候选，并禁止无关键字全量加载', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.supervisorSearch({ keyword: '张三', pageNo: 2 })
    expect(calls[0]).toEqual({
      url: '/sys/user/pageInfo',
      method: 'get',
      params: { name: '张三', pageNo: 2, pageSize: 5 },
    })
    expect(() => api.supervisorSearch({ keyword: '   ' })).toThrow('keyword不能为空')
    expect(calls).toHaveLength(1)
  })

  it('读取详情使用任务id，且不把负责人ID混成任务ID', async () => {
    const { api, calls } = harness([{}])
    await api.get({ id: '18' })
    expect(calls[0]).toEqual({ url: '/hr/oversee-task/get', method: 'get', params: { id: '18' } })
  })

  it('复刻发起督办表单字段、负责人映射和日期/紧急程度规则', () => {
    const { api } = harness()
    expect(api.prepareCreate({
      taskName: '季度复盘',
      taskDescription: '请完成复盘',
      superviseeList: [{ supervisee: '1001' }, { supervisee: 1002 }],
      endDate: '2099-09-30',
      degreeType: 4,
    })).toEqual({
      draft: {
        degreeType: 4,
        taskName: '季度复盘',
        taskDescription: '请完成复盘',
        superviseeList: [{ supervisee: '1001' }, { supervisee: 1002 }],
        endDate: '2099-09-30',
      },
    })
    expect(() => api.prepareCreate({ ...createDraft(), taskName: 'a'.repeat(31) })).toThrow('30')
    expect(() => api.prepareCreate({ ...createDraft(), taskDescription: 'a'.repeat(201) })).toThrow('200')
    expect(() => api.prepareCreate({ ...createDraft(), superviseeList: [] })).toThrow('至少需要选择1名负责人')
    expect(() => api.prepareCreate({ ...createDraft(), superviseeList: [{ supervisee: 1001 }, { supervisee: 1001 }] })).toThrow('不能重复')
    expect(() => api.prepareCreate({ ...createDraft(), endDate: '2000-01-01' })).toThrow('不能早于今天')
    expect(() => api.prepareCreate({ ...createDraft(), degreeType: 5 as 1 })).toThrow('1到4')
  })

  it('按Portal字段顺序提交创建，并返回服务端任务ID', async () => {
    const { api, calls } = harness([901])
    const draft = createDraft()
    const prepared = api.prepareCreate(draft)
    await expect(api.create(prepared)).resolves.toBe(901)
    expect(calls[0]).toEqual({
      url: '/hr/oversee-task/create',
      method: 'post',
      data: draft,
    })
    expect(Object.keys(calls[0]?.data as Record<string, unknown>)).toEqual([
      'degreeType', 'taskName', 'taskDescription', 'superviseeList', 'endDate',
    ])
  })

  it('撤销只接受最新未完成行，提交DELETE后要求true回执', async () => {
    const { api, calls } = harness([true])
    const prepared = api.prepareDelete({ id: 901, currentIsComplete: 0 })
    await expect(api.remove(prepared)).resolves.toBe(true)
    expect(calls[0]).toEqual({ url: '/hr/oversee-task/delete', method: 'delete', params: { id: 901 } })
    expect(() => api.prepareDelete({ id: 901, currentIsComplete: 1 })).toThrow('isComplete=0')
    const invalid = harness([false])
    await expect(invalid.api.remove(prepared)).rejects.toThrow('不是true')
  })

  it('复刻列表群发提醒和详情逐人提醒的HTTP方法、参数及空body', async () => {
    const { api, calls } = harness(['发送成功', '发送成功'])
    const reminder = api.prepareSendMessage({ id: 901, currentIsComplete: 0 })
    await expect(api.sendMessage(reminder)).resolves.toBe('发送成功')
    const personal = api.prepareSendPersonalMessage({ overseeTaskId: 901, userId: '1001', currentIsComplete: 0 })
    await expect(api.sendPersonalMessage(personal)).resolves.toBe('发送成功')
    expect(calls[0]).toEqual({ url: '/hr/oversee-task/sendMessage', method: 'get', params: { taskId: 901 } })
    expect(calls[1]).toEqual({
      url: '/hr/oversee-task/sendPersonalMessage',
      method: 'post',
      data: null,
      params: { taskId: 901, userId: '1001' },
    })
    expect(() => api.prepareSendMessage({ id: 901, currentIsComplete: 1 })).toThrow('isComplete=0')
    expect(() => api.prepareSendPersonalMessage({ overseeTaskId: 901, userId: 1001, currentIsComplete: 1 })).toThrow('未完成')
  })

  it('只生成Portal实际可达的详情和发起督办路由', () => {
    const { api } = harness()
    expect(api.prepareDetail({ id: '901' })).toEqual({ path: MY_URGE_DETAIL_PATH, query: { id: '901' } })
    expect(api.prepareStart()).toEqual({ path: MY_URGE_CREATE_PATH })
  })

  it('非法日期、状态、ID和成功回执在请求前/请求后被拒绝', async () => {
    const { api, calls } = harness()
    expect(() => api.list({ endDate: '2099/09/30' })).toThrow('YYYY-MM-DD')
    expect(() => api.list({ isComplete: 2 as 0 | 1 })).toThrow('isComplete')
    expect(() => api.get({ id: 0 })).toThrow('正整数ID')
    expect(() => api.prepareSendPersonalMessage({ overseeTaskId: 901, userId: 0 })).toThrow('正整数ID')
    expect(calls).toHaveLength(0)
    const invalid = harness([''])
    await expect(invalid.api.sendMessage({ draft: { taskId: 901 } })).rejects.toThrow('非空成功文本')
  })

  it('每个能力定义都有唯一的方法映射', () => {
    expect(MY_URGE_METHODS['my-urge-list']).toBe('list')
    expect(new Set(Object.keys(MY_URGE_METHODS))).toHaveProperty('size', myUrgeCapabilities.length)
    for (const definition of myUrgeCapabilities) {
      expect(MY_URGE_METHODS[definition.id as keyof typeof MY_URGE_METHODS]).toBeTruthy()
    }
  })
})
