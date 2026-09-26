import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  CERTIFICATE_TYPE_METHODS,
  CERTIFICATE_TYPE_MODULE_TYPE,
  CERTIFICATE_TYPE_PAGE_PATH,
  CERTIFICATE_TYPE_PERMISSION,
  createCertificateTypeCapability,
  certificateTypeCapabilities,
  type CertificateTypeForm,
  type CertificateTypeRow,
} from '../src/capabilities/certificate-type.js'
import { CERTIFICATE_TYPE_AI_CONTRACTS as contracts, CERTIFICATE_TYPE_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-certificate-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createCertificateTypeCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const form: CertificateTypeForm = { name: '特种证照', remindTime: 6, tipTemplateId: 9 }
const detail: CertificateTypeRow = { id: 101, ...form, count: 2 }

describe('Portal 风险防控 → 证照类型页面能力', () => {
  it('逐页锁定菜单、列表、表单、提示词模板和页面上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/type/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/type/[mode]/[id].vue')
    expect(menu).toContain(`path: '${CERTIFICATE_TYPE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${CERTIFICATE_TYPE_PERMISSION}'`)
    for (const fragment of ["'/admin-api/system/license-category/page'", "'/admin-api/system/license-category/delete'", 'name: \'\'', 'actionCreate', 'actionEdit', 'actionDelete']) expect(list).toContain(fragment)
    for (const fragment of ["'/admin-api/sys/tip-template/list'", "useType: 'license'", 'customLoad: async id', "'/admin-api/system/license-category/create'", "'/admin-api/system/license-category/update'", 'nameTextTrim', ':min="0"']) expect(formPage).toContain(fragment)
    expect(certificateTypeCapabilities.map(item => item.id)).toEqual(Object.keys(CERTIFICATE_TYPE_METHODS))
    expect(certificateTypeCapabilities.every(item => item.pagePath === CERTIFICATE_TYPE_PAGE_PATH && item.permission === CERTIFICATE_TYPE_PERMISSION && item.moduleType === CERTIFICATE_TYPE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java CRUD、租户对象、名称重复和占用删除规则', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/HrLicenseCategoryController.java')
    const save = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/vo/HrLicenseCategorySaveReqVO.java')
    const page = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/vo/HrLicenseCategoryPageRepVO.java')
    const response = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/license/vo/HrLicenseCategoryRespVO.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/license/HrLicenseCategoryServiceImpl.java')
    const dataObject = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/dal/dataobject/license/HrLicenseCategoryDO.java')
    for (const fragment of ['@RequestMapping({"/system/license-category"})', '@GetMapping("/page")', '@GetMapping("/get")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")']) expect(controller).toContain(fragment)
    for (const fragment of ['@Size(max = 15', 'private String name', 'private Integer remindTime', 'private Long tipTemplateId']) expect(save).toContain(fragment)
    expect(page).toContain('private String name')
    for (const fragment of ['private Long id', 'private Integer remindTime', 'private Integer count', 'private Long tipTemplateId']) expect(response).toContain(fragment)
    for (const fragment of ['validNameDuplicate', 'validLicense', 'selectListByCategoryId', 'extends TenantBaseDO']) expect(service + dataObject).toContain(fragment)
    expect(dataObject).toContain('@TableName(value = "hr_license_category"')
  })

  it('按 Portal 实际请求形状覆盖列表、模板、详情、创建、更新和删除', async () => {
    const template = { id: 9, name: '证照识别模板', extra: 'preserve' }
    const f = fixture([[detail], [template], detail, true, true, true])
    await expect(f.api.list({ name: '证照' })).resolves.toEqual([detail])
    await expect(f.api.tipTemplates()).resolves.toEqual([template])
    await expect(f.api.get({ id: 101 })).resolves.toEqual(detail)
    const created = f.api.prepareCreate({ ...form, name: ' 特种证照 ' })
    expect(created.draft.name).toBe('特种证照')
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(true)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '更新类型', remindTime: 12, tipTemplateId: null } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/license-category/page', method: 'get', params: { name: '证照' } },
      { url: '/admin-api/sys/tip-template/list', method: 'get', params: { useType: 'license' } },
      { url: '/admin-api/system/license-category/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/system/license-category/create', method: 'post', data: { name: '特种证照', remindTime: 6, tipTemplateId: 9 } },
      { url: '/admin-api/system/license-category/update', method: 'put', data: { id: 101, name: '更新类型', remindTime: 12, tipTemplateId: null } },
      { url: '/admin-api/system/license-category/delete', method: 'delete', params: { id: 101 } },
    ])
  })

  it('表单规则、空响应和坏回执在请求前或响应处显式失败', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...form, name: 'x'.repeat(16) })).toThrow('最多15')
    expect(() => f.api.prepareCreate({ ...form, name: '   ' })).toThrow('不能为空')
    expect(() => f.api.prepareCreate({ ...form, remindTime: -1 })).toThrow('非负整数')
    expect(() => f.api.prepareCreate({ ...form, remindTime: 1.5 })).toThrow('非负整数')
    await expect(f.api.list()).rejects.toThrow()
    await expect(f.api.remove({ id: 0 })).rejects.toThrow('证照类型ID')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
    await expect(fixture([[{ id: 0, name: '坏数据', remindTime: 1, count: 0, tipTemplateId: null }]]).api.list()).rejects.toThrow('正整数ID')
  })
})

describe('证照类型 AI 契约', () => {
  it('八个动作和公开方法契约结构通过，后端与真实验证缺口保持显式', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(certificateTypeCapabilities).toHaveLength(8)
    expect(validateAiContracts(contracts, { definitions: certificateTypeCapabilities, contracts })).toEqual([])
    expect(Object.keys(methodContracts)).toEqual(Object.values(CERTIFICATE_TYPE_METHODS).map(method => `certificateType.${method}`))
    const complete = validateAiContracts(contracts, { profile: 'complete', definitions: certificateTypeCapabilities, contracts })
    expect(complete.map((issue: { code: string }) => issue.code)).toEqual(Array(8).fill('incomplete-evidence'))
    for (const contract of Object.values(contracts)) expect(contract.gaps?.join(' ')).toContain('尚未在真实测试环境')
  })
})
