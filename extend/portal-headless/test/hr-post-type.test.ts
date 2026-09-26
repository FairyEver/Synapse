import { describe, expect, it } from 'vitest'
import { createHrPostTypeCapability, hrPostTypeCapabilities, HR_POST_TYPE_METHODS } from '../src/capabilities/hr-post-type.js'
import { HR_POST_TYPE_AI_CONTRACTS as contracts, HR_POST_TYPE_METHOD_CONTRACTS } from '../src/catalog/contracts-hr-post-type.js'
import type { PortalRequest } from '../src/capabilities/meeting-room.js'

type Request = Parameters<PortalRequest>[0]
function fixture(replies: unknown[] = []) {
  const calls: Request[] = []
  const request: PortalRequest = async <T>(config: Request): Promise<T> => {
    calls.push(config)
    const result = replies.shift()
    if (result instanceof Error) throw result
    return result as T
  }
  return { calls, sdk: createHrPostTypeCapability(request) }
}
const input = { name: '测试类别', sort: 3, remark: '说明' }
describe('岗位类别页面完整动作', () => {
  it('保留 renren 列表默认值及分页，不把类别和岗位 ID 混淆', async () => {
    const { sdk, calls } = fixture([{ list: [{ id: '81', ...input }], total: 1 }])
    expect(await sdk.list()).toEqual({ list: [{ id: '81', ...input }], total: 1 })
    expect(calls).toEqual([{ url: '/org/hrposttype/page', method: 'get', params: { order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 } }])
  })
  it('编辑读当前值，新建和修改都 POST save，忽略非页面字段且不伪造返回 ID', async () => {
    const { sdk, calls } = fixture([{ id: '81', ...input }, undefined, undefined])
    expect(await sdk.get({ id: '81' })).toEqual({ id: '81', ...input })
    expect(await sdk.create({ ...input, id: '7', creator: '9' } as never)).toBeUndefined()
    expect(await sdk.update({ id: '81', ...input })).toBeUndefined()
    expect(calls).toEqual([
      { url: '/org/hrposttype/81', method: 'get' },
      { url: '/org/hrposttype/save', method: 'post', data: input },
      { url: '/org/hrposttype/save', method: 'post', data: { ...input, id: '81' } },
    ])
  })
  it('表单约束发请求前拒绝：名称、排序、备注与错误 ID', async () => {
    const { sdk, calls } = fixture()
    for (const changes of [{ name: '' }, { name: '  ' }, { name: '中'.repeat(51) }, { sort: -1 }, { sort: 1.2 }, { remark: ' ' }, { remark: '中'.repeat(201) }]) await expect(sdk.create({ ...input, ...changes })).rejects.toThrow()
    await expect(sdk.update({ ...input, id: '' })).rejects.toThrow()
    await expect(sdk.get({ id: Number.MAX_SAFE_INTEGER + 1 })).rejects.toThrow()
    await expect(sdk.prepareRemove({ ids: [] })).rejects.toThrow()
    expect(calls).toEqual([])
  })
  it('未填备注写空串，保留名称首尾空格', async () => {
    const { sdk, calls } = fixture()
    await sdk.create({ name: ' 类别 ', sort: 0 })
    expect(calls[0]?.data).toEqual({ name: ' 类别 ', sort: 0, remark: '' })
  })
  it.each([null, undefined, {}, { isDel: 1, mobile: '13800000000' }])('按页面配置 %j 允许免短信而非跳过占用检查', async sensitive => {
    const { sdk, calls } = fixture(['', sensitive, undefined])
    await sdk.remove({ ids: ['81', '81', 82] })
    expect(calls).toEqual([
      { url: '/org/hrposttype/checkCanDelete', method: 'post', data: ['81', '82'] },
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/org/hrposttype', method: 'delete', data: ['81', '82'] },
    ])
  })
  it('删除准备无副作用，敏感设置未明确豁免时必须验证', async () => {
    const { sdk, calls } = fixture(['', { isDel: 0, mobile: '13800000000' }])
    expect(await sdk.prepareRemove({ ids: [81] })).toEqual({ ids: ['81'], verificationRequired: true, phone: '13800000000' })
    expect(calls.map(c => c.url)).toEqual(['/org/hrposttype/checkCanDelete', '/org/sensitive/info'])
  })
  it('发送验证码只使用后端配置手机号及页面模板，归一短信标识', async () => {
    const { sdk, calls } = fixture(['', { isDel: 0, mobile: '13800000000' }, { requestId: 'sms-17', result: 200 }])
    expect(await sdk.sendDeleteCode({ ids: ['81'] })).toEqual({ smsRequestId: 'sms-17' })
    expect(calls[2]).toEqual({ url: '/sys/sms/send', method: 'get', params: { phone: '13800000000', templateId: '17709' } })
    expect(calls.some(c => c.method === 'delete')).toBe(false)
  })
  it('验证成功才可删除且短信 ID 不作为幂等键', async () => {
    const { sdk, calls } = fixture(['', { isDel: 0, mobile: '13800000000' }, undefined, undefined])
    await sdk.remove({ ids: ['81'], smsRequestId: 'sms-17', code: '1234' })
    expect(calls[2]).toEqual({ url: '/sys/sms/checkSms', method: 'get', params: { requestId: 'sms-17', code: '1234' } })
    expect(calls[3]).toEqual({ url: '/org/hrposttype', method: 'delete', data: ['81'] })
  })
  it('占用、缺验证码、验证失败及未配手机号均阻断后续副作用', async () => {
    const occupied = fixture([new Error('正在被使用')])
    await expect(occupied.sdk.remove({ ids: ['81'] })).rejects.toThrow('正在被使用')
    expect(occupied.calls).toHaveLength(1)
    const missing = fixture(['', { isDel: 0, mobile: '13800000000' }])
    await expect(missing.sdk.remove({ ids: ['81'] })).rejects.toThrow('删除需要短信验证')
    expect(missing.calls).toHaveLength(2)
    const incorrect = fixture(['', { isDel: 0, mobile: '13800000000' }, new Error('验证码错误')])
    await expect(incorrect.sdk.remove({ ids: ['81'], smsRequestId: 'sms-17', code: '9999' })).rejects.toThrow('验证码错误')
    expect(incorrect.calls).toHaveLength(3)
    const phone = fixture(['', { isDel: 0 }])
    await expect(phone.sdk.sendDeleteCode({ ids: ['81'] })).rejects.toThrow('未配置接收手机号')
    expect(phone.calls).toHaveLength(2)
  })
  it('所有能力和公开方法提供 AI 说明，锁住动作映射与无返回 ID 语义', async () => {
    for (const c of hrPostTypeCapabilities) {
      expect(contracts[c.id]).toBeDefined()
      const method = HR_POST_TYPE_METHODS[c.id as keyof typeof HR_POST_TYPE_METHODS]
      expect(HR_POST_TYPE_METHOD_CONTRACTS[`hrPostType.${method}`]).toBeDefined()
      expect(contracts[c.id]?.gaps).not.toEqual([])
    }
    expect(contracts['hr-post-type-create']?.output.shape).toBe('undefined')
    expect(contracts['hr-post-type-send-delete-code']?.effect).toBe('write')
    expect(contracts['hr-post-type-send-delete-code']?.steps[0]?.mapping).toEqual({ ids: 'args.ids', smsRequestId: 'result.smsRequestId', code: 'user.code' })
    expect(contracts['hr-post-type-remove']?.inputs.smsRequestId?.meaning).toContain('不是幂等键')
    expect(contracts['hr-post-type-get']?.output.fields.find(f => f.path === 'id')?.meaning).toContain('不是岗位 ID')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl)
    for (const [id, contract] of Object.entries(contracts)) expect(validateAiContract(id, contract), id).toEqual([])
  })
})
