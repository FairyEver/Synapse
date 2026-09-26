import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  INSTITUTION_TYPE_METHODS,
  INSTITUTION_TYPE_MODULE_TYPE,
  INSTITUTION_TYPE_PAGE_PATH,
  INSTITUTION_TYPE_PERMISSION,
  createInstitutionTypeCapability,
  institutionTypeCapabilities,
  type InstitutionTypeForm,
  type InstitutionTypeRow,
} from '../src/capabilities/institution-type.js'
import { INSTITUTION_TYPE_AI_CONTRACTS as contracts, INSTITUTION_TYPE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-institution-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInstitutionTypeCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: InstitutionTypeForm = { name: '人事制度', sort: 1 }
const detail: InstitutionTypeRow = { id: '9007199254740997', ...form, size: null }

describe('Portal 风险防控 → 制度类型页面能力', () => {
  it('逐页锁定菜单、路由、列表、表单和页面上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/institution/type.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/institution/type/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/institution/type/[mode]/[id].vue')

    expect(menu).toContain(`path: '${INSTITUTION_TYPE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${INSTITUTION_TYPE_PERMISSION}'`)
    expect(route).toContain('title: 制度类型')
    for (const fragment of [
      "'/admin-api/system/policy-category/page'", "'/admin-api/system/policy-category/delete'",
      'getDataListIsPage: true', 'name: \'\'', 'actionCreate', 'actionEdit', 'actionDelete',
      'total: result?.length || 0',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "`/admin-api/system/policy-category/get?id=${id}`", "'/admin-api/system/policy-category/create'",
      "'/admin-api/system/policy-category/update'", 'nameTextTrim', ':min="0"', ':precision="0"',
      'max: 15', 'sort:',
    ]) expect(formPage).toContain(fragment)
    expect(institutionTypeCapabilities.map(item => item.id)).toEqual(Object.keys(INSTITUTION_TYPE_METHODS))
    expect(institutionTypeCapabilities.map(item => item.id)).toContain('institution-type-list')
    expect(institutionTypeCapabilities.every(item => item.pagePath === INSTITUTION_TYPE_PAGE_PATH && item.permission === INSTITUTION_TYPE_PERMISSION && item.moduleType === INSTITUTION_TYPE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java CRUD、租户对象、名称长度和占用删除规则', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/HrPolicyCategoryController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrPolicyCategorySaveReqVO.java')
    const page = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrPolicyCategoryPageRepVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/policy/vo/HrPolicyCategoryRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/policy/HrPolicyCategoryServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/policy/HrPolicyCategoryDO.java')

    for (const fragment of ['@RequestMapping("/system/policy-category")', '@GetMapping("/page")', '@GetMapping("/get")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")']) expect(controller).toContain(fragment)
    for (const fragment of ['@NotNull', '@Size(max = 15', 'private String name', 'private Integer sort']) expect(save).toContain(fragment)
    expect(page).toContain('private String name')
    for (const fragment of ['private Long id', 'private String name', 'private Integer sort', 'private Integer size']) expect(response).toContain(fragment)
    for (const fragment of ['validNameDuplicate', 'validPolicy', 'selectListByCategoryId', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName(value = "hr_policy_category"')
  })

  it('按 Portal 实际请求形状覆盖数组列表、详情、创建、更新和删除', async () => {
    const listRow = { ...detail, sort: null, size: 3 }
    const f = fixture([[listRow], detail, true, true, true])

    await expect(f.api.list({ name: '制度', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [{ ...listRow, sort: 99999 }], total: 1 })
    await expect(f.api.get({ id: detail.id })).resolves.toEqual(detail)
    const created = f.api.prepareCreate({ ...form, name: ' 人事制度 ' })
    expect(created.draft).toEqual(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(true)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '制度修订', sort: 2 } })
    expect(updated.previous).toEqual({ id: detail.id, ...form })
    expect(updated.draft).toEqual({ id: detail.id, name: '制度修订', sort: 2 })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: detail.id })).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/admin-api/system/policy-category/page', method: 'get', params: { order: '', orderField: '', name: '制度', pageNo: 2, pageSize: 50 } },
      { url: '/admin-api/system/policy-category/get', method: 'get', params: { id: detail.id } },
      { url: '/admin-api/system/policy-category/create', method: 'post', data: { name: '人事制度', sort: 1 } },
      { url: '/admin-api/system/policy-category/update', method: 'put', data: { id: detail.id, name: '制度修订', sort: 2 } },
      { url: '/admin-api/system/policy-category/delete', method: 'delete', params: { id: detail.id } },
    ])
  })

  it('默认列表参数、表单规则和坏回执在请求前或响应处显式失败', async () => {
    const defaults = fixture([[]])
    await expect(defaults.api.list()).resolves.toEqual({ list: [], total: 0 })
    expect(defaults.calls[0]?.params).toEqual({ order: '', orderField: '', name: '', pageNo: 1, pageSize: 20 })

    const f = fixture([])
    for (const invalid of [
      { ...form, name: 'x'.repeat(16) },
      { ...form, name: '   ' },
      { ...form, sort: -1 },
      { ...form, sort: 1.5 },
      { ...form, sort: null },
    ]) expect(() => f.api.prepareCreate(invalid as never)).toThrow()
    for (const id of [0, -1, '', '01', 'abc', Number.MAX_SAFE_INTEGER + 1]) await expect(f.api.remove({ id: id as never })).rejects.toThrow('制度类型ID')
    await expect(f.api.list({ pageNo: 0 })).rejects.toThrow('页码')
    await expect(f.api.list({ pageSize: 0 })).rejects.toThrow('每页数量')
    await expect(fixture([false]).api.update({ draft: { ...form, id: detail.id } })).rejects.toThrow('不是true')
    await expect(fixture([[{ id: 0, name: '坏数据', sort: 0, size: null }]]).api.list()).rejects.toThrow('正整数ID')
    await expect(fixture([null]).api.get({ id: detail.id })).rejects.toThrow('必须是对象')
    expect(f.calls).toHaveLength(0)
  })
})

describe('制度类型 AI 契约', () => {
  it('七个动作和公开方法契约结构通过，真实验证缺口保持显式', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(institutionTypeCapabilities).toHaveLength(7)
    expect(validateAiContracts(contracts, { definitions: institutionTypeCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(INSTITUTION_TYPE_METHODS).map(method => `institutionType.${method}`))
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: institutionTypeCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(7).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) expect(contract.gaps?.join(' ')).toContain('尚未在真实测试环境')
  })
})
