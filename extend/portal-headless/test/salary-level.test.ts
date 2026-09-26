import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSalaryLevelCapability,
  SALARY_LEVEL_METHODS,
  SALARY_LEVEL_MODULE_TYPE,
  SALARY_LEVEL_PAGE_PATH,
  SALARY_LEVEL_PERMISSION,
  salaryLevelCapabilities,
} from '../src/capabilities/salary-level.js'
import { SALARY_LEVEL_AI_CONTRACTS as contracts } from '../src/catalog/contracts-salary-level.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSalaryLevelCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = { id: '81', name: 'P1', sort: 3, salaryStandard: '1000.00', status: 0, isDel: 0 }

describe('Portal 人力 → 薪资等级', () => {
  it('逐页锁定菜单、列表、编辑表单、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/hr.js')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-level.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-level/list.vue')
    const edit = read(portalRoot, 'app/portal/views/dashboard/hr/salary/salary-level/[mode]/[id].vue')
    const sensitive = read(portalRoot, 'app/portal/utils/hr/sensitive/useSensitiveAction.js')
    const verify = read(portalRoot, 'app/portal/utils/hr/sensitive/components/verify.vue')
    const system = read(portalRoot, 'app/portal/utils/system.js')
    const all = `${wrapper}\n${list}\n${edit}\n${sensitive}\n${verify}\n${system}`

    expect(menu).toContain(`path: '${SALARY_LEVEL_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALARY_LEVEL_PERMISSION}'`)
    for (const fragment of [
      "getDataListURL: '/org/hrsalarylevel/page'",
      "deleteURL: '/org/hrsalarylevel'",
      'deleteIsBatch: true',
      "form: {\n    name: ''",
      "http.post('/org/hrsalarylevel/checkCanDelete', ids)",
      'actionVerify(record)',
      'rrList.actionDelete(record)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'customLoad: async id',
      "http.get(`/org/hrsalarylevel/${id}`)",
      "http.post('/org/hrsalarylevel/save', form)",
      'validateOnlySpace',
      '{ max: 50, message: \'最多输入50个字符\' }',
      'name:', 'sort:', 'salaryStandard:',
    ]) expect(edit).toContain(fragment)
    for (const fragment of [
      'useSensitiveAction',
      "'/org/sensitive/info'",
      "'/sys/sms/send'",
      "'/sys/sms/checkSms'",
      "templateId: '17709'",
      'sensitive.state.isDel === 1',
    ]) expect(all).toContain(fragment)
    for (const fragment of ['<a-input-number', ':precision="0"', ':precision="2"', ':min="0"']) expect(edit).toContain(fragment)

    expect(salaryLevelCapabilities.map(item => item.id)).toEqual(Object.keys(SALARY_LEVEL_METHODS))
    expect(salaryLevelCapabilities.every(item => item.pagePath === SALARY_LEVEL_PAGE_PATH && item.permission === SALARY_LEVEL_PERMISSION && item.moduleType === SALARY_LEVEL_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALARY_LEVEL_PAGE_PATH).moduleType).toBe(SALARY_LEVEL_MODULE_TYPE)
  })

  it('逐页锁定Java Controller、DTO、Service、Entity、DAO和删除引用规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/post')
    const controller = read(root, 'controller/HrSalaryLevelController.java')
    const service = read(root, 'service/impl/HrSalaryLevelServiceImpl.java')
    const dto = read(root, 'dto/HrSalaryLevelDTO.java')
    const entity = read(root, 'entity/HrSalaryLevelEntity.java')
    const dao = read(root, 'dao/HrSalaryLevelDao.java')
    for (const fragment of [
      '@RequestMapping("/org/hrsalarylevel")', '@GetMapping("page")', '@GetMapping("{id}")', '@PostMapping("save")',
      '@DeleteMapping', '@PostMapping("checkCanDelete")', 'Long[] ids',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['wrapper.like(StrUtil.isNotBlank(name), "name", name)', 'wrapper.orderByAsc("sort")', 'wrapper.eq("is_del", 0)', '失败,名称重复', 'setIsDel(0)', 'setStatus(0)', 'salary_level', '此薪资等级正在被使用', 'setIsDel(1)']) expect(service).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private Integer status', 'private Integer sort', 'private Integer isDel', 'private BigDecimal salaryStandard']) expect(dto).toContain(fragment)
    for (const fragment of ['@TableName("hr_salary_level")', 'private Long id', 'private BigDecimal salaryStandard']) expect(entity).toContain(fragment)
    for (const fragment of ['extends BaseMapperX<HrSalaryLevelEntity>', 'selectNotExist', 'selectAll']) expect(dao).toContain(fragment)
  })

  it('按Portal请求形状覆盖列表、详情、保存和删除验证码链', async () => {
    const f = fixture([
      { list: [row], total: 1 }, row, undefined, undefined,
      undefined, undefined,
      undefined, { isDel: 0, mobile: '13800000000' },
      undefined, { isDel: 0, mobile: '13800000000' }, { requestId: 'sms-17' },
      undefined, { isDel: 0, mobile: '13800000000' }, undefined, undefined,
    ])

    await expect(f.api.list({ name: 'P', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/org/hrsalarylevel/page', method: 'get', params: { order: '', orderField: '', name: 'P', pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: 81 })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/org/hrsalarylevel/81', method: 'get' })
    await expect(f.api.create({ name: 'P2', sort: 4, salaryStandard: '2000.00' })).resolves.toBeUndefined()
    expect(f.calls[2]).toEqual({ url: '/org/hrsalarylevel/save', method: 'post', data: { name: 'P2', sort: 4, salaryStandard: '2000.00' } })
    await expect(f.api.update({ id: '81', name: 'P1+', sort: 5, salaryStandard: 2000 })).resolves.toBeUndefined()
    expect(f.calls[3]).toEqual({ url: '/org/hrsalarylevel/save', method: 'post', data: { id: '81', name: 'P1+', sort: 5, salaryStandard: 2000 } })

    await expect(f.api.prepareRemove({ ids: [81, '81', 82] })).resolves.toEqual({ ids: ['81', '82'], verificationRequired: false, phone: null })
    expect(f.calls[4]).toEqual({ url: '/org/hrsalarylevel/checkCanDelete', method: 'post', data: ['81', '82'] })
    expect(f.calls[5]).toEqual({ url: '/org/sensitive/info', method: 'get' })
    expect(f.calls.slice(4).some(call => call.method === 'delete' || call.url === '/sys/sms/send')).toBe(false)

    await expect(f.api.prepareRemove({ ids: [81] })).resolves.toEqual({ ids: ['81'], verificationRequired: true, phone: '13800000000' })
    await expect(f.api.sendDeleteCode({ ids: [81] })).resolves.toEqual({ smsRequestId: 'sms-17' })
    expect(f.calls[10]).toEqual({ url: '/sys/sms/send', method: 'get', params: { phone: '13800000000', templateId: '17709' } })
    await expect(f.api.remove({ ids: [81], smsRequestId: 'sms-17', code: '7621' })).resolves.toBeUndefined()
    expect(f.calls[12]).toEqual({ url: '/org/sensitive/info', method: 'get' })
    expect(f.calls[13]).toEqual({ url: '/sys/sms/checkSms', method: 'get', params: { requestId: 'sms-17', code: '7621' } })
    expect(f.calls[14]).toEqual({ url: '/org/hrsalarylevel', method: 'delete', data: ['81'] })
  })

  it('坏参数在请求前失败，引用检查或验证码失败不会继续删除', async () => {
    const f = fixture([])
    await expect(f.api.create({ name: ' ', sort: 0, salaryStandard: 1 })).rejects.toThrow('name')
    await expect(f.api.create({ name: '有效', sort: -1, salaryStandard: 1 })).rejects.toThrow('sort')
    await expect(f.api.create({ name: '有效', sort: 0, salaryStandard: '1.001' })).rejects.toThrow('salaryStandard')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)

    const required = fixture([undefined, { isDel: 0, mobile: '13800000000' }])
    await expect(required.api.remove({ ids: [1], code: '1' })).rejects.toThrow('smsRequestId')
    expect(required.calls.map(call => call.url)).toEqual(['/org/hrsalarylevel/checkCanDelete', '/org/sensitive/info'])

    const blocked = fixture([new Error('此薪资等级正在被使用')])
    await expect(blocked.api.remove({ ids: [1] })).rejects.toThrow('正在被使用')
    expect(blocked.calls).toHaveLength(1)
    expect(blocked.calls[0]?.url).toBe('/org/hrsalarylevel/checkCanDelete')

    const badCode = fixture([undefined, { isDel: 0, mobile: '13800000000' }, new Error('验证码错误')])
    await expect(badCode.api.remove({ ids: [1], smsRequestId: 'sms-1', code: 'bad' })).rejects.toThrow('验证码错误')
    expect(badCode.calls.map(call => call.url)).toEqual(['/org/hrsalarylevel/checkCanDelete', '/org/sensitive/info', '/sys/sms/checkSms'])
  })

  it('AI说明覆盖全部能力、字段语义和动作映射，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALARY_LEVEL_METHODS).sort())
    expect(contracts['salary-level-list']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].name', 'list[].salaryStandard', 'total']))
    expect(contracts['salary-level-remove']?.steps[0]).toMatchObject({ capabilityId: 'salary-level-list', mapping: expect.objectContaining({ name: 'user.recordNames' }) })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
