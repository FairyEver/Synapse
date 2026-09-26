import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosResponse } from 'axios'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  BUSINESS_REGISTRATION_METHODS,
  BUSINESS_REGISTRATION_MODULE_TYPE,
  BUSINESS_REGISTRATION_PAGE_PATH,
  BUSINESS_REGISTRATION_PERMISSION,
  businessRegistrationCapabilities,
  createBusinessRegistrationCapability,
  type BusinessRegistrationDetail,
  type BusinessRegistrationForm,
} from '../src/capabilities/business-registration.js'
import { BUSINESS_REGISTRATION_AI_CONTRACTS as contracts } from '../src/catalog/contracts-business-registration.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createBusinessRegistrationCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const staff = (staffCode: string, staffName: string) => ({ staffCode, staffName })

const form: BusinessRegistrationForm = {
  status: 1,
  name: '示例企业',
  signNumber: '统一信用代码-001',
  organizationId: '8',
  type: '2',
  address: '示例住所',
  legalRepresentative: 9,
  legalRepresentativeOutside: '',
  isUnit: 1,
  registeredCapital: 100,
  loginTime: null,
  establishmentTime: '2026-01-02',
  isForever: 0,
  timeBusiness: '2036-01-02',
  remindTime: 30,
  remindPost: '11',
  remindPostTree: '11',
  scopeBusiness: '软件开发',
  registrationAuthority: '示例市场监督管理局',
  shareholdingStructure: '甲方100%',
  director: [staff('D-1', '董事一')],
  directorOutside: [],
  isDirectorOutside: [],
  supervisor: [staff('S-1', '监事一')],
  supervisorOutside: [],
  isSupervisorOutside: [],
  admin: [staff('A-1', '经理一')],
  adminOutside: [],
  isAdminOutside: [],
  pdfUrl: ['https://oss.example/one.pdf'],
  pdfName: ['one.pdf'],
}

const detail: BusinessRegistrationDetail = {
  id: 101,
  name: form.name,
  signNumber: form.signNumber,
  organizationId: form.organizationId,
  type: form.type,
  status: form.status,
  address: form.address,
  legalRepresentative: '9',
  legalRepresentativeOutside: '',
  legalRepresentativeName: '法人一',
  isUnit: true,
  registeredCapital: form.registeredCapital,
  loginTime: null,
  establishmentTime: form.establishmentTime,
  timeBusiness: form.timeBusiness,
  isForever: '0',
  remindTime: form.remindTime,
  remindPost: form.remindPost ?? null,
  remindPostTree: form.remindPostTree ?? null,
  scopeBusiness: form.scopeBusiness ?? null,
  registrationAuthority: form.registrationAuthority,
  shareholdingStructure: form.shareholdingStructure ?? null,
  pdfName: form.pdfName.join(','),
  pdfUrl: form.pdfUrl.join(','),
  director: form.director,
  directorOutside: [],
  isDirectorOutside: [],
  supervisor: form.supervisor,
  supervisorOutside: [],
  isSupervisorOutside: [],
  admin: form.admin,
  adminOutside: [],
  isAdminOutside: [],
  log: 0,
  organizationName: '示例组织',
  creator: 7,
  creatorName: '管理员',
}

describe('Portal 风险防控 → 登记信息页面能力', () => {
  it('逐页锁定菜单、列表、完整表单、变更、共享和 module-type', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration/[mode]/[id].vue')
    const change = read(root, 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration/change/[id]/registration-change.vue')
    const changeRecord = read(root, 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration/change/[id]/change-record.vue')
    const share = read(root, 'app/portal/components/portal/hxr/modal-share-user/index.vue')
    expect(menu).toContain(`path: '${BUSINESS_REGISTRATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${BUSINESS_REGISTRATION_PERMISSION}'`)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "'/admin-api/hr/business-registration/page'",
      "url: '/admin-api/hr/business-registration/delete'",
      'business-registration/export-excel',
      '企业登记', '变更', '变更记录', '共享设置', 'type: 5',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'business-registration/get?id=${id}',
      "'/admin-api/hr/business-registration/updateALL'",
      "'/admin-api/hr/business-registration/create'",
      "pdfUrl: form.pdfUrl?.join(',') || ''",
      "pdfName: form.pdfName?.join(',') || ''",
      "timeBusiness: form.isForever ? '' : formatDay(form.timeBusiness)",
      "isUnit: form.isUnit ? true : false",
      '最多20个字符', '最多30个字符', '最多200个字符',
      "file.type === 'application/pdf'", 'pdfUrl.length < 10',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of [
      "'/admin-api/hr/business-registration-log/createBatch'",
      "'/admin-api/hr/business-registration/update'",
      'beforeField', 'afterField', '法定代表人', '营业期限', '附件',
    ]) expect(change).toContain(fragment)
    for (const fragment of [
      'business-registration-log/get?id=${route.params.id}',
      "'/admin-api/hr/business-registration-log/delete'",
      'createTime', 'recordList',
    ]) expect(changeRecord).toContain(fragment)
    for (const fragment of ["'/admin-api/system/share-user/getShare'", "'/admin-api/system/share-user/createShare'", 'organizationIds', 'postIds', 'dutyIds', 'userIds', 'formState.value.type === 1']) expect(share).toContain(fragment)
    expect(businessRegistrationCapabilities.map(item => item.id)).toEqual(Object.keys(BUSINESS_REGISTRATION_METHODS))
    expect(businessRegistrationCapabilities.every(item => item.pagePath === BUSINESS_REGISTRATION_PAGE_PATH && item.permission === BUSINESS_REGISTRATION_PERMISSION && item.moduleType === BUSINESS_REGISTRATION_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
  })

  it('逐页锁定 Java 端点、租户/current-user 写入和共享类型', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/businessregistration/controller/BusinessRegistrationController.java')
    const logController = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/riskcontrol/businessregistration/controller/BusinessRegistrationLogController.java')
    const service = read(root, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/businessregistration/BusinessRegistrationServiceImpl.java')
    const shareEnum = read(root, 'erp-module-system/erp-module-system-api/src/main/java/com/wdbc/erp/module/system/enums/share/ShareTypeEnum.java')
    for (const fragment of ['@RequestMapping("/hr/business-registration")', '@PostMapping("/create")', '@PutMapping("/update")', '@PutMapping("/updateALL")', '@DeleteMapping("/delete")', '@GetMapping("/get")', '@GetMapping("/page")', '@GetMapping("/export-excel")']) expect(controller).toContain(fragment)
    for (const fragment of ['@RequestMapping("/hr/business-registration-log")', '@PostMapping("/createBatch")', '@GetMapping("/get")', '@DeleteMapping("/delete")']) expect(logController).toContain(fragment)
    for (const fragment of ['SecurityFrameworkUtils.getLoginUserId()', 'SecurityFrameworkUtils.getLoginUser().getTenantId()', 'ShareTypeEnum.BUSINESSREGISTRATION', 'getLoginUserShareTrademarkId']) expect(service).toContain(fragment)
    expect(shareEnum).toContain('BUSINESSREGISTRATION(5, "企业登记")')
  })

  it('按 Portal 实际请求形状覆盖列表、详情、导出、表单、变更和共享', async () => {
    const exportResponse = { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-disposition': "attachment; filename*=UTF-8''%E4%BC%81%E4%B8%9A%E7%99%BB%E8%AE%B0.xls", 'content-type': 'application/vnd.ms-excel' } } as unknown as AxiosResponse<ArrayBuffer>
    const changePage = { head: ['名称'], headValue: { id: 101, name: '示例企业二' }, body: [{ id: 201, businessRegistrationId: 101, detailsRegistration: '名称', beforeField: '示例企业', afterField: '示例企业二', createTime: '2026-09-23 10:00:00' }] }
    const f = fixture([{ list: [{ ...detail, director: '董事一', supervisor: '监事一', admin: '经理一' }], total: 1 }, detail, exportResponse, 101, true, true, true, null, changePage, null, { organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 9, managerType: 1 }] }, true])
    await expect(f.api.list({ name: '示例', type: '2' })).resolves.toEqual({ list: [expect.objectContaining({ id: 101 })], total: 1 })
    await expect(f.api.get({ id: 101 })).resolves.toEqual(expect.objectContaining({ id: 101, pdfUrl: 'https://oss.example/one.pdf' }))
    await expect(f.api.export({ name: '示例', type: '2' })).resolves.toMatchObject({ fileName: '企业登记.xlsx', byteLength: 3, contentType: 'application/vnd.ms-excel' })
    const created = f.api.prepareCreate(form)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(101)
    const updated = f.api.prepareUpdate({ current: detail, changes: { name: '示例企业二' } })
    const numericDetail = { ...detail, organizationId: 8, type: 2 }
    expect(f.api.prepareUpdate({ current: numericDetail }).draft).toMatchObject({ organizationId: '8', type: '2' })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: 101 })).resolves.toBe(true)
    const change = f.api.prepareChange({ businessRegistrationId: 101, dateRegistration: '2026-09-23', entries: [{ detailsRegistration: '名称', beforeField: '示例企业', afterField: '示例企业二' }], update: { name: '示例企业二' } })
    expect(f.api.prepareChange({ businessRegistrationId: 101, dateRegistration: '2026-09-23', entries: [{ detailsRegistration: '注册资本', beforeField: 100, afterField: 200 }], update: { registeredCapital: 200 } }).draft.createReqVO[0]).toMatchObject({ beforeField: 100, afterField: 200 })
    await expect(f.api.submitChange({ draft: change.draft })).resolves.toBe(true)
    await expect(f.api.getChangeRecord({ id: 101 })).resolves.toEqual(expect.objectContaining({ head: ['名称'], body: [expect.objectContaining({ id: 201 })] }))
    await expect(f.api.removeChangeRecord({ ids: [201, 202] })).resolves.toBe(true)
    await expect(f.api.getShare({ resourceId: 101 })).resolves.toEqual({ organization: [{ id: 8, managerType: 1 }], post: [], duty: [], user: [{ id: 9, managerType: 1 }] })
    await expect(f.api.saveShare({ resourceId: 101, organization: [{ id: 8, managerType: 2 }], user: [{ id: 9, managerType: 1 }] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/hr/business-registration/page', method: 'get', params: { order: '', orderField: '', name: '示例', type: '2', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/hr/business-registration/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/business-registration/export-excel', method: 'get', params: { name: '示例', type: '2' }, responseType: 'arraybuffer' },
      { url: '/admin-api/hr/business-registration/create', method: 'post', data: expect.objectContaining({ organizationId: '8', legalRepresentative: 9, isUnit: true, timeBusiness: '2036-01-02', pdfUrl: 'https://oss.example/one.pdf', pdfName: 'one.pdf', director: [staff('D-1', '董事一')] }) },
      { url: '/admin-api/hr/business-registration/updateALL', method: 'put', data: expect.objectContaining({ id: 101, name: '示例企业二', isUnit: true, pdfUrl: 'https://oss.example/one.pdf', loginTime: null }) },
      { url: '/admin-api/hr/business-registration/delete', method: 'delete', params: { id: 101 } },
      { url: '/admin-api/hr/business-registration-log/createBatch', method: 'post', data: { dateRegistration: '2026-09-23', createReqVO: [{ detailsRegistration: '名称', beforeField: '示例企业', afterField: '示例企业二', businessRegistrationId: 101 }] } },
      { url: '/admin-api/hr/business-registration/update', method: 'put', data: { id: 101, name: '示例企业二' } },
      { url: '/admin-api/hr/business-registration-log/get', method: 'get', params: { id: 101 } },
      { url: '/admin-api/hr/business-registration-log/delete', method: 'delete', data: [201, 202] },
      { url: '/admin-api/system/share-user/getShare', method: 'get', params: { type: 5, resourceId: 101 } },
      { url: '/admin-api/system/share-user/createShare', method: 'post', data: { type: 5, resourceId: 101, organizationIds: [{ id: 8 }], postIds: [], dutyIds: [], userIds: [{ id: 9 }] } },
    ])
  })

  it('表单、变更、共享和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ name: 1 as never })).rejects.toThrow('name')
    expect(() => f.api.prepareCreate({ ...form, name: 'a'.repeat(21) })).toThrow('最多20')
    expect(() => f.api.prepareCreate({ ...form, signNumber: '' })).toThrow('signNumber')
    expect(() => f.api.prepareCreate({ ...form, address: 'a'.repeat(201) })).toThrow('最多200')
    expect(() => f.api.prepareCreate({ ...form, registrationAuthority: '' })).toThrow('registrationAuthority')
    expect(() => f.api.prepareCreate({ ...form, isUnit: 0, legalRepresentative: null, legalRepresentativeOutside: '123456' })).toThrow('纯数字')
    expect(() => f.api.prepareCreate({ ...form, isUnit: 0, legalRepresentative: null, legalRepresentativeOutside: '外部法人' })).not.toThrow()
    expect(() => f.api.prepareCreate({ ...form, isForever: 0, timeBusiness: '' })).toThrow('timeBusiness')
    expect(() => f.api.prepareCreate({ ...form, pdfUrl: Array.from({ length: 11 }, (_, i) => `u${i}`) })).toThrow('最多10')
    expect(() => f.api.prepareChange({ businessRegistrationId: 101, dateRegistration: '2026-09-23', entries: [{ detailsRegistration: '名称', beforeField: '同值', afterField: '同值' }] })).toThrow('不能相同')
    expect(() => f.api.prepareChange({ businessRegistrationId: 101, dateRegistration: '2026-09-23' })).toThrow('至少')
    await expect(f.api.saveShare({ resourceId: 0 })).rejects.toThrow('resourceId')
    await expect(f.api.getChangeRecord({ id: 0 })).rejects.toThrow('企业登记ID')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list')
    await expect(fixture([false]).api.update({ draft: { ...form, id: 101 } })).rejects.toThrow('不是true')
  })

  it('AI 说明覆盖表单规则、权限、变更顺序和共享映射，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(BUSINESS_REGISTRATION_METHODS).sort())
    expect(contracts['business-registration-update']?.boundaries.join(' ')).toContain('updateALL')
    expect(contracts['business-registration-submit-change']?.consume.join(' ')).toContain('先 POST')
    expect(contracts['business-registration-save-share']?.consume.join(' ')).toContain('type=5')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
