import { describe, expect, it } from 'vitest'
import {
  createHrOrganizationTypeCapability,
  hrOrganizationTypeCapabilities,
  HR_ORGANIZATION_TYPE_METHODS,
} from '../src/capabilities/hr-organization-type.js'
import {
  HR_ORGANIZATION_TYPE_AI_CONTRACTS as contracts,
  HR_ORGANIZATION_TYPE_METHOD_CONTRACTS,
} from '../src/catalog/contracts-hr-organization-type.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

type Request = Parameters<PortalRequest>[0]

function fixture(pageReplies: unknown[] = [], formReplies: unknown[] = []) {
  const pageCalls: Request[] = []
  const formCalls: Request[] = []
  const pageRequest: PortalRequest = async <T>(config: Request): Promise<T> => {
    pageCalls.push(config)
    const result = pageReplies.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  const formRequest: PortalRequest = async <T>(config: Request): Promise<T> => {
    formCalls.push(config)
    const result = formReplies.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return {
    pageCalls,
    formCalls,
    sdk: createHrOrganizationTypeCapability(pageRequest, formRequest),
  }
}

const draft = { name: '测试组织类型', remark: '说明' }

describe('组织类型页面真实可达动作', () => {
  it('列表逐字段保留 renren 默认值，返回当前页和删除保护计数', async () => {
    const result = { list: [{ id: '84', ...draft, useNumber: 0 }], total: 17 }
    const { sdk, pageCalls, formCalls } = fixture([result])
    expect(await sdk.list()).toEqual(result)
    expect(pageCalls).toEqual([{
      url: '/org/organizationType/page',
      method: 'get',
      params: { order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 },
    }])
    expect(formCalls).toEqual([])
  })

  it('名称值仍逐字段发送，但契约明确当前后端不应用筛选', async () => {
    const { sdk, pageCalls } = fixture([{ list: [], total: 17 }])
    await sdk.list({ name: '投资公司', pageNo: 2, pageSize: 5, order: '', orderField: '' })
    expect(pageCalls[0]?.params).toEqual({ order: '', orderField: '', name: '投资公司', pageNo: 2, pageSize: 5 })
    expect(contracts['hr-organization-type-list']?.inputs.name?.constraints).toContain('不得依赖服务端名称筛选；必须分页读取并在本地按 name 匹配')
    expect(contracts['hr-organization-type-list']?.output.fields.find(item => item.path === 'total')?.meaning).toContain('不是名称命中总数')
  })

  it('创建只投影页面字段，并走独立的无 module-type 表单请求', async () => {
    const { sdk, pageCalls, formCalls } = fixture([], [undefined])
    expect(await sdk.create({ ...draft, id: '99', useNumber: 7 } as never)).toBeUndefined()
    expect(formCalls).toEqual([{
      url: '/org/organizationType/save',
      method: 'post',
      data: draft,
    }])
    expect(pageCalls).toEqual([])
    expect(hrOrganizationTypeCapabilities.find(item => item.id === 'hr-organization-type-create')?.moduleType).toBeNull()
  })

  it('创建表单约束及分页参数在请求前失败，省略备注发送空串', async () => {
    const { sdk, pageCalls, formCalls } = fixture([], [undefined])
    for (const changes of [
      { name: '' },
      { name: '  ' },
      { name: '中'.repeat(51) },
      { remark: ' ' },
      { remark: '中'.repeat(201) },
    ]) await expect(sdk.create({ ...draft, ...changes })).rejects.toThrow()
    await expect(sdk.list({ pageNo: 0 })).rejects.toThrow('pageNo')
    await expect(sdk.list({ pageSize: 1.5 })).rejects.toThrow('pageSize')
    expect(pageCalls).toEqual([])
    expect(formCalls).toEqual([])

    await sdk.create({ name: ' 类型 ' })
    expect(formCalls[0]?.data).toEqual({ name: ' 类型 ', remark: '' })
  })

  it.each([null, undefined, {}, { isDel: 1, mobile: '13800000000' }])(
    '配置 %j 允许免短信，删除仍使用列表页请求并发送去重 ID 数组',
    async sensitive => {
      const { sdk, pageCalls, formCalls } = fixture([sensitive, undefined])
      await sdk.remove({ ids: ['84', '84', 85] })
      expect(pageCalls).toEqual([
        { url: '/org/sensitive/info', method: 'get' },
        { url: '/org/organizationType', method: 'delete', data: ['84', '85'] },
      ])
      expect(formCalls).toEqual([])
    },
  )

  it('删除准备只读当前敏感配置，不谎称已检查 useNumber 或锁定引用', async () => {
    const { sdk, pageCalls } = fixture([{ isDel: 0, mobile: '13800000000' }])
    expect(await sdk.prepareRemove({ ids: [84] })).toEqual({
      ids: ['84'],
      verificationRequired: true,
      phone: '13800000000',
    })
    expect(pageCalls).toEqual([{ url: '/org/sensitive/info', method: 'get' }])
    expect(contracts['hr-organization-type-prepare-remove']?.consume.join('\n')).toContain('不会锁定引用关系')
  })

  it('短信发送只使用配置手机号和页面模板，返回的 requestId 不是幂等键', async () => {
    const { sdk, pageCalls } = fixture([
      { isDel: 0, mobile: '13800000000' },
      { requestId: 9917, result: 200 },
    ])
    expect(await sdk.sendDeleteCode({ ids: ['84'] })).toEqual({ smsRequestId: '9917' })
    expect(pageCalls[1]).toEqual({
      url: '/sys/sms/send',
      method: 'get',
      params: { phone: '13800000000', templateId: '17709' },
    })
    expect(pageCalls.some(call => call.method === 'delete')).toBe(false)
  })

  it('需要验证时 checkSms 成功后才批量 DELETE', async () => {
    const { sdk, pageCalls } = fixture([{ isDel: 0, mobile: '13800000000' }, undefined, undefined])
    await sdk.remove({ ids: ['84'], smsRequestId: '9917', code: '1234' })
    expect(pageCalls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/sys/sms/checkSms', method: 'get', params: { requestId: '9917', code: '1234' } },
      { url: '/org/organizationType', method: 'delete', data: ['84'] },
    ])
  })

  it('无可用 ID、缺验证码、验证失败及缺手机号均阻断后续副作用', async () => {
    const empty = fixture()
    await expect(empty.sdk.prepareRemove({ ids: [] })).rejects.toThrow('ids')
    expect(empty.pageCalls).toEqual([])

    const missing = fixture([{ isDel: 0, mobile: '13800000000' }])
    await expect(missing.sdk.remove({ ids: ['84'] })).rejects.toThrow('删除需要短信验证')
    expect(missing.pageCalls).toHaveLength(1)

    const incorrect = fixture([{ isDel: 0, mobile: '13800000000' }, new Error('验证码错误')])
    await expect(incorrect.sdk.remove({ ids: ['84'], smsRequestId: '9917', code: '9999' })).rejects.toThrow('验证码错误')
    expect(incorrect.pageCalls).toHaveLength(2)
    expect(incorrect.pageCalls.some(call => call.method === 'delete')).toBe(false)

    const phone = fixture([{ isDel: 0 }])
    await expect(phone.sdk.sendDeleteCode({ ids: ['84'] })).rejects.toThrow('未配置接收手机号')
    expect(phone.pageCalls).toHaveLength(1)
  })

  it('只发布正常可达动作，并为能力和公开方法提供完整 AI 说明', async () => {
    expect(Object.keys(HR_ORGANIZATION_TYPE_METHODS)).toEqual([
      'hr-organization-type-list',
      'hr-organization-type-create',
      'hr-organization-type-prepare-remove',
      'hr-organization-type-send-delete-code',
      'hr-organization-type-remove',
    ])
    expect(Object.keys(HR_ORGANIZATION_TYPE_METHODS).some(id => /get|update|edit|detail/.test(id))).toBe(false)

    for (const capability of hrOrganizationTypeCapabilities) {
      expect(contracts[capability.id]).toBeDefined()
      const method = HR_ORGANIZATION_TYPE_METHODS[capability.id as keyof typeof HR_ORGANIZATION_TYPE_METHODS]
      expect(HR_ORGANIZATION_TYPE_METHOD_CONTRACTS[`hrOrganizationType.${method}`]).toBeDefined()
      expect(contracts[capability.id]?.gaps).not.toEqual([])
    }

    expect(contracts['hr-organization-type-create']?.output.shape).toBe('undefined')
    expect(contracts['hr-organization-type-send-delete-code']?.steps[0]?.mapping).toEqual({
      ids: 'args.ids',
      smsRequestId: 'result.smsRequestId',
      code: 'user.code',
    })
    expect(contracts['hr-organization-type-remove']?.inputs.smsRequestId?.meaning).toContain('不是幂等键')
    expect(contracts['hr-organization-type-list']?.output.fields.find(item => item.path === 'list[].useNumber')?.meaning).toContain('0 才能')
    expect(contracts['hr-organization-type-create']?.consume.join('\n')).toContain('不带 module-type')

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl)
    for (const [id, contract] of Object.entries(contracts)) {
      expect(validateAiContract(id, contract), id).toEqual([])
    }
  })
})
