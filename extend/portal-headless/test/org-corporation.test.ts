import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PortalRequest } from '../src/capabilities/meeting-room.js'
import {
  createOrgCorporationCapability,
  HR_ORG_CORPORATION_METHODS,
  ORG_CORPORATION_AI_CONTRACTS as contracts,
  ORG_CORPORATION_METHOD_CONTRACTS as methodContracts,
  ORG_CORPORATION_PAGE_PATH,
  ORG_CORPORATION_PERMISSION,
  hrOrgCorporationCapabilities,
} from '../src/capabilities/org-corporation.js'

type Request = Parameters<PortalRequest>[0]

function fixture (replies: unknown[] = []) {
  const calls: Request[] = []
  const request: PortalRequest = async <T>(config: Request): Promise<T> => {
    calls.push(config)
    const next = replies.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { calls, sdk: createOrgCorporationCapability(request) }
}

const row = {
  id: 84,
  name: '法人A',
  mainInvestIds: [17],
  mainInvestNames: ['投资主体A'],
  mainInvestName: '投资主体A',
  remark: '说明',
  useNumber: 0,
}

describe('Portal 人力→法人管理页面节点', () => {
  it('逐页锁定菜单、权限、列表/编辑/选择器请求和 Java 约束', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portalRoot, 'app/portal/menus/hr.js'), 'utf8')
    const route = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/org/corporation.vue'), 'utf8')
    const list = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/org/corporation/list.vue'), 'utf8')
    const form = readFileSync(join(portalRoot, 'app/portal/views/dashboard/hr/org/corporation/[mode]/[id].vue'), 'utf8')
    const selector = readFileSync(join(portalRoot, 'app/portal/components/portal/finance/select/corporation/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/controller/HrLegalPersonController.java'), 'utf8')
    const service = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/service/impl/HrLegalPersonServiceImpl.java'), 'utf8')

    expect(menu).toContain(`path: '${ORG_CORPORATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${ORG_CORPORATION_PERMISSION}'`)
    expect(route).toContain(`permission: ${ORG_CORPORATION_PERMISSION}`)
    expect(list).toContain("getDataListURL: '/org/corporation/page'")
    expect(list).toContain("deleteURL: '/org/corporation'")
    expect(list).toContain('record.useNumber !== 0')
    expect(list).toContain("dataIndex: 'mainInvestNames'")
    expect(list).toContain('useSensitiveAction')
    expect(list).not.toContain('buttonPermissionFlag')
    expect(form).toContain("http.get(`/org/corporation/${id}`)")
    expect(form).toContain("http.post('/org/corporation/save'")
    expect(form).toContain('mainInvestIds: []')
    expect(form).toContain('delete payload.mainInvest')
    expect(form).toContain('delete payload.mainInvestName')
    expect(form).toContain('delete payload.mainInvestNames')
    expect(form).toContain('最多输入50个字符')
    expect(form).toContain('最多输入200个字符')
    expect(selector).toContain("/org/corporation/getAllLegalPerson")
    expect(selector).toContain('availableOnly')
    expect(selector).toContain('valueField')
    expect(controller).toContain('@RequestMapping("/org/corporation")')
    expect(controller).toContain('@GetMapping("page")')
    expect(controller).toContain('@GetMapping("{id}")')
    expect(controller).toContain('@PostMapping("save")')
    expect(controller).toContain('@DeleteMapping')
    expect(controller).toContain('@GetMapping("getAllLegalPerson")')
    expect(service).toContain('normalizeMainInvestIds')
    expect(service).toContain('validateMainInvestIds')
    expect(service).toContain('该法人已被组织或标准化单元使用，不能删除')

    expect(hrOrgCorporationCapabilities.map(item => item.id)).toEqual(Object.keys(HR_ORG_CORPORATION_METHODS))
    expect(hrOrgCorporationCapabilities.every(item => item.pagePath === ORG_CORPORATION_PAGE_PATH)).toBe(true)
    expect(hrOrgCorporationCapabilities.every(item => item.permission === ORG_CORPORATION_PERMISSION)).toBe(true)
    expect(hrOrgCorporationCapabilities.every(item => item.httpInstance === 'platform')).toBe(true)
    // 11 comes from the generated page-path rule; the node intentionally does not hard-code it.
    expect(hrOrgCorporationCapabilities.every(item => item.moduleType === undefined)).toBe(true)
  })

  it('列表逐字段复现 renren 默认查询，法人名称和投资主体筛选保留原值', async () => {
    const result = { list: [row], total: 1 }
    const f = fixture([result, { list: [], total: 0 }])

    await expect(f.sdk.list()).resolves.toEqual(result)
    expect(f.calls[0]).toEqual({
      url: '/org/corporation/page',
      method: 'get',
      params: { order: '', orderField: '', name: '', mainInvest: '', pageNo: 1, pageSize: 20 },
    })

    await f.sdk.list({ name: '法人', mainInvest: '投资', pageNo: 2, pageSize: 50, order: 'asc', orderField: 'name' })
    expect(f.calls[1]).toEqual({
      url: '/org/corporation/page',
      method: 'get',
      params: { order: 'asc', orderField: 'name', name: '法人', mainInvest: '投资', pageNo: 2, pageSize: 50 },
    })
  })

  it('列表查询的非法筛选和分页在发请求前失败，坏分页响应不伪造成空结果', async () => {
    const f = fixture([{ list: null, total: 0 }])
    await expect(f.sdk.list({ pageNo: 0 })).rejects.toThrow('pageNo')
    await expect(f.sdk.list({ pageSize: 1.5 })).rejects.toThrow('pageSize')
    await expect(f.sdk.list({ name: 7 as never })).rejects.toThrow('name')
    expect(f.calls).toEqual([])
    await expect(f.sdk.list()).rejects.toThrow('list或total')
  })

  it('编辑详情归一 mainInvestIds，候选只投影 id/name 且要求关键字', async () => {
    const f = fixture([
      { ...row, mainInvestIds: null, ignored: 'detail-only' },
      [{ id: '17', name: '投资主体A', status: 0, ignored: 'not an option field' }],
    ])

    await expect(f.sdk.get({ id: '84' })).resolves.toMatchObject({ id: 84, mainInvestIds: [] })
    await expect(f.sdk.mainInvestOptions({ keyword: '投资主体' })).resolves.toEqual([{ id: '17', name: '投资主体A' }])
    expect(f.calls).toEqual([
      { url: '/org/corporation/84', method: 'get' },
      { url: '/org/corporation/getAllLegalPerson', method: 'get', params: { name: '投资主体' } },
    ])

    await expect(f.sdk.get({ id: 0 })).rejects.toThrow('id')
    await expect(f.sdk.mainInvestOptions({ keyword: ' ' })).rejects.toThrow('keyword')
    await expect(f.sdk.mainInvestOptions({ keyword: '' })).rejects.toThrow('keyword')
    expect(f.calls).toHaveLength(2)
  })

  it('创建严格投影页面字段，按 Portal 规则发送 mainInvestIds 数组和备注空串', async () => {
    const f = fixture([undefined])
    await expect(f.sdk.create({
      name: ' 法人A ',
      mainInvestIds: [17, '18'],
      remark: '说明',
      extra: 'must not enter create body',
    } as never)).resolves.toBeUndefined()
    expect(f.calls).toEqual([{
      url: '/org/corporation/save',
      method: 'post',
      data: { name: ' 法人A ', mainInvestIds: [17, '18'], remark: '说明' },
    }])

    const noInvest = fixture([undefined])
    await noInvest.sdk.create({ name: '法人B' })
    expect(noInvest.calls[0]?.data).toEqual({ name: '法人B', mainInvestIds: [], remark: '' })
  })

  it('编辑保留详情 DTO 的非旧字段，但删除三个 legacy 投资主体字段', async () => {
    const f = fixture([undefined])
    await f.sdk.update({
      id: 84,
      name: '法人A-修改',
      mainInvestIds: [17],
      remark: '新说明',
      mainInvest: 17,
      mainInvestName: '投资主体A',
      mainInvestNames: ['投资主体A'],
      status: 0,
      isDel: 0,
      tenantId: 9,
    })
    expect(f.calls[0]).toEqual({
      url: '/org/corporation/save',
      method: 'post',
      data: { id: 84, name: '法人A-修改', mainInvestIds: [17], remark: '新说明', status: 0, isDel: 0, tenantId: 9 },
    })

    const missingArray = fixture([undefined])
    await missingArray.sdk.update({ id: '84', name: '法人A' })
    expect(missingArray.calls[0]?.data).toEqual({ id: '84', name: '法人A', mainInvestIds: [], remark: '' })
  })

  it('创建和编辑校验必填、全空格、长度、ID 与备注，错误时不发请求', async () => {
    const f = fixture()
    for (const changes of [
      { name: '' },
      { name: '   ' },
      { name: '法'.repeat(51) },
      { remark: ' ' },
      { remark: '字'.repeat(201) },
      { mainInvestIds: [0] },
    ]) {
      await expect(f.sdk.create({ name: '法人A', ...changes } as never)).rejects.toThrow()
    }
    await expect(f.sdk.update({ id: '', name: '法人A' })).rejects.toThrow('id')
    await expect(f.sdk.update({ id: 84, name: ' ' })).rejects.toThrow('法人名称')
    expect(f.calls).toEqual([])
  })

  it.each([null, undefined, {}, { isDel: 1, mobile: '13800000000' }])(
    '敏感配置 %j 允许免短信，但删除仍发送去重后的 ID 数组',
    async sensitive => {
      const f = fixture([sensitive, undefined])
      await f.sdk.remove({ ids: [84, '84', 85] })
      expect(f.calls).toEqual([
        { url: '/org/sensitive/info', method: 'get' },
        { url: '/org/corporation', method: 'delete', data: [84, 85] },
      ])
    },
  )

  it('删除准备只读取敏感配置，不冒充检查占用关系；需要验证时发送固定模板验证码', async () => {
    const prepared = fixture([{ isDel: 0, mobile: '13800000000' }])
    await expect(prepared.sdk.prepareRemove({ ids: [84] })).resolves.toEqual({
      ids: [84],
      verificationRequired: true,
      phone: '13800000000',
    })
    expect(prepared.calls).toEqual([{ url: '/org/sensitive/info', method: 'get' }])

    const sent = fixture([{ isDel: 0, mobile: '13800000000' }, { requestId: 9917 }])
    await expect(sent.sdk.sendDeleteCode({ ids: [84] })).resolves.toEqual({ smsRequestId: '9917' })
    expect(sent.calls[1]).toEqual({
      url: '/sys/sms/send',
      method: 'get',
      params: { phone: '13800000000', templateId: '17709' },
    })
    expect(sent.calls.some(call => call.method === 'delete')).toBe(false)
  })

  it('验证码校验成功后才 DELETE；缺验证码、错误验证码和缺手机号都会阻断', async () => {
    const f = fixture([{ isDel: 0, mobile: '13800000000' }, undefined, undefined])
    await f.sdk.remove({ ids: ['84'], smsRequestId: 'sms-17', code: '1234' })
    expect(f.calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/sys/sms/checkSms', method: 'get', params: { requestId: 'sms-17', code: '1234' } },
      { url: '/org/corporation', method: 'delete', data: ['84'] },
    ])

    const missing = fixture([{ isDel: 0, mobile: '13800000000' }])
    await expect(missing.sdk.remove({ ids: ['84'] })).rejects.toThrow('删除需要短信验证')
    expect(missing.calls).toHaveLength(1)

    const incorrect = fixture([{ isDel: 0, mobile: '13800000000' }, new Error('验证码错误')])
    await expect(incorrect.sdk.remove({ ids: ['84'], smsRequestId: 'sms-17', code: '9999' })).rejects.toThrow('验证码错误')
    expect(incorrect.calls).toHaveLength(2)
    expect(incorrect.calls.some(call => call.method === 'delete')).toBe(false)

    const phone = fixture([{ isDel: 0 }])
    await expect(phone.sdk.sendDeleteCode({ ids: ['84'] })).rejects.toThrow('未配置接收手机号')
    expect(phone.calls).toHaveLength(1)
  })

  it('所有发布能力都有同页 AI 说明，且结构校验会锁定步骤映射和反证语义', async () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(HR_ORG_CORPORATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(HR_ORG_CORPORATION_METHODS).map(method => `orgCorporation.${method}`))
    for (const capability of hrOrgCorporationCapabilities) {
      expect(contracts[capability.id]).toBeDefined()
      const method = HR_ORG_CORPORATION_METHODS[capability.id as keyof typeof HR_ORG_CORPORATION_METHODS]
      expect(methodContracts[`orgCorporation.${method}`]).toBeDefined()
      expect(contracts[capability.id]?.gaps).not.toEqual([])
    }
    expect(contracts['hr-org-corporation-create']?.output.shape).toBe('undefined')
    expect(contracts['hr-org-corporation-send-delete-code']?.steps[0]?.mapping).toEqual({
      ids: 'args.ids',
      smsRequestId: 'result.smsRequestId',
      code: 'user.code',
    })
    expect(contracts['hr-org-corporation-remove']?.inputs.smsRequestId?.meaning).toContain('不是幂等键')
    expect(contracts['hr-org-corporation-list']?.output.fields.find(field => field.path === 'list[].useNumber')?.meaning).toContain('0')

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as {
      validateAiContracts: (contracts: Record<string, unknown>, options: { definitions: unknown[] }) => unknown[]
    }
    expect(validateAiContracts(contracts, { definitions: hrOrgCorporationCapabilities })).toEqual([])
  })
})
