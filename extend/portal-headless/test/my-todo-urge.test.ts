import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  MY_TODO_URGE_COMPLETION_OPTIONS,
  MY_TODO_URGE_CREATE_PATH,
  MY_TODO_URGE_DETAIL_PATH,
  MY_TODO_URGE_METHODS,
  MY_TODO_URGE_PAGE_PATH,
  MY_TODO_URGE_PERMISSION,
  buildMyTodoUrgeCompletionPayload,
  createMyTodoUrgeCapability,
  myTodoUrgeCapabilities,
} from '../src/capabilities/my-todo-urge.js'

function harness (responses: unknown[] = []) {
  const calls: Array<Record<string, unknown>> = []
  const request: PortalRequest = async <T>(config: Parameters<PortalRequest>[0]) => {
    calls.push(config as unknown as Record<string, unknown>)
    return responses.shift() as T
  }
  return { calls, api: createMyTodoUrgeCapability(request) }
}

describe('我的待办页面能力', () => {
  it('按Portal页面顺序投影列表筛选，并绑定platform和页面权限', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.list()
    expect(calls[0]).toMatchObject({
      url: '/hr/supervisee/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        taskName: null,
        endDate: null,
        isComplete: 0,
        pageNo: 1,
        pageSize: 20,
      },
    })
    expect(myTodoUrgeCapabilities.every(definition =>
      definition.pagePath === MY_TODO_URGE_PAGE_PATH &&
      definition.permission === MY_TODO_URGE_PERMISSION &&
      definition.moduleType === null &&
      definition.httpInstance === 'platform')).toBe(true)
  })

  it('保留日期、状态和分页筛选，不提供查询其他负责人的参数', async () => {
    const { api, calls } = harness([{ list: [], total: 0 }])
    await api.list({ taskName: '季度复盘', endDate: '2026-09-30', isComplete: 1, pageNo: 2, pageSize: 50 })
    expect(calls[0]?.params).toEqual({
      order: '',
      orderField: '',
      taskName: '季度复盘',
      endDate: '2026-09-30',
      isComplete: 1,
      pageNo: 2,
      pageSize: 50,
    })
    expect(calls[0]?.params).not.toHaveProperty('supervisee')
    expect(MY_TODO_URGE_COMPLETION_OPTIONS).toEqual([
      { label: '待办事项', value: 0 },
      { label: '已办事项', value: 1 },
    ])
  })

  it('读取详情时使用overseeTaskId映射为Portal的taskId', async () => {
    const { api, calls } = harness([{}])
    await api.getTaskInfo({ overseeTaskId: 18 })
    expect(calls[0]).toEqual({
      url: '/hr/supervisee/getTaskInfo',
      method: 'get',
      params: { taskId: 18 },
    })
  })

  it('复刻完成弹窗的字段、顺序和附件限制，允许页面实际会发出的空说明', () => {
    expect(buildMyTodoUrgeCompletionPayload({
      overseeTaskId: '18',
      remark: '',
      fileList: ['https://oss.example/a.png', 'https://oss.example/b.png'],
    }, '2026-09-24')).toEqual({
      url: 'https://oss.example/a.png,https://oss.example/b.png',
      isComplete: 1,
      completeDetails: '',
      completeDate: '2026-09-24',
      overseeTaskId: '18',
    })
    expect(() => buildMyTodoUrgeCompletionPayload({ overseeTaskId: 18, remark: 'a'.repeat(501) }, '2026-09-24')).toThrow('500')
    expect(() => buildMyTodoUrgeCompletionPayload({ overseeTaskId: 18, fileList: ['a', 'b', 'c', 'd', 'e', 'f'] }, '2026-09-24')).toThrow('最多5项')
  })

  it('执行prepare→complete，并拒绝非true回执', async () => {
    const { api, calls } = harness([true])
    const prepared = api.prepareComplete({ overseeTaskId: 18, remark: '已处理', fileList: ['oss://done.png'] })
    expect(prepared.draft).toMatchObject({
      url: 'oss://done.png',
      isComplete: 1,
      completeDetails: '已处理',
      overseeTaskId: 18,
    })
    await expect(api.complete(prepared)).resolves.toBe(true)
    expect(calls[0]).toMatchObject({
      url: '/hr/supervisee/completedTask',
      method: 'post',
      data: {
        url: 'oss://done.png',
        isComplete: 1,
        completeDetails: '已处理',
        completeDate: prepared.draft.completeDate,
        overseeTaskId: 18,
      },
    })
    expect(calls[0]?.data).not.toHaveProperty('urlName')

    const invalid = harness([false])
    await expect(invalid.api.complete(prepared)).rejects.toThrow('不是true')
  })

  it('动作只生成Portal真实可达的详情和发起督办路由', () => {
    const { api } = harness()
    expect(api.prepareDetail({ overseeTaskId: '18' })).toEqual({ path: MY_TODO_URGE_DETAIL_PATH, query: { id: '18' } })
    expect(api.prepareStart()).toEqual({ path: MY_TODO_URGE_CREATE_PATH })
  })

  it('在请求前拒绝非法日期、状态、任务ID、草稿和附件输入', async () => {
    const { api, calls } = harness()
    expect(() => api.list({ endDate: '2026/09/30' })).toThrow('YYYY-MM-DD')
    expect(() => api.list({ isComplete: 2 as 0 | 1 })).toThrow('isComplete')
    expect(calls).toHaveLength(0)
    expect(() => api.prepareComplete({ overseeTaskId: 0 })).toThrow('正整数ID')
    expect(() => api.prepareComplete({ overseeTaskId: 18, fileList: [''] })).toThrow('非空URL')
    expect(() => api.prepareDetail({ overseeTaskId: 0 })).toThrow('正整数ID')
  })

  it('每个能力定义都有唯一的方法映射', () => {
    expect(MY_TODO_URGE_METHODS['my-todo-urge-list']).toBe('list')
    expect(new Set(Object.keys(MY_TODO_URGE_METHODS))).toHaveProperty('size', myTodoUrgeCapabilities.length)
    for (const definition of myTodoUrgeCapabilities) {
      expect(MY_TODO_URGE_METHODS[definition.id as keyof typeof MY_TODO_URGE_METHODS]).toBeTruthy()
    }
  })
})
