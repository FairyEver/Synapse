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

/**
 * 第二批：人员弹窗的两个候选（内部人员 / 外部人员）。
 *
 * 同 URL、不同页面语境 —— 与班级管理页那两条能力并存，见
 * `src/capabilities/business-registration.ts` 文件头。
 */
describe('登记信息人员弹窗候选', () => {
  const PORTAL_REPO = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
  const JAVA_REPO = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
  const PERSON_MODAL = 'app/portal/views/dashboard/hr/certificate/enterpriseRegistration/components/add-personnel.vue'

  function personFixture () {
    const calls: RequestConfig[] = []
    const responses: unknown[] = []
    const request: PortalRequest = async <T>(config: RequestConfig) => {
      calls.push(config)
      return (responses.shift() ?? { list: [], total: 0 }) as T
    }
    return { api: createBusinessRegistrationCapability(request), calls, responses }
  }

  it('两个候选按页面参数发出：name → pageNo → pageSize，都没有 gradeId', async () => {
    const { api, calls, responses } = personFixture()
    responses.push({ list: [], total: 0 })
    await api.searchPersonCandidates({ keyword: ' 张三 ' })
    responses.push({ list: [], total: 0 })
    await api.listExternalPersons({ keyword: '13800000000', pageNo: 2, pageSize: 10 })

    expect(calls).toEqual([
      { url: '/sys/user/userNotInGrade', method: 'get', params: { name: '张三', pageNo: 1, pageSize: 5 } },
      { url: '/study/grade/student/getExternalStudentList', method: 'get', params: { name: '13800000000', pageNo: 2, pageSize: 10 } },
    ])
    // 页面那两处 params 里没有 gradeId（班级管理页的同名调用才有）
    for (const call of calls) expect(call.params).not.toHaveProperty('gradeId')
  })

  it('内部人员响应里的 password / password2 / salt 被裁掉，其余原样保留', async () => {
    const { api, responses } = personFixture()
    responses.push({ list: [{ id: 5, username: '1005', realName: '钱七', organizationName: '总部/一部', password: 'x', password2: '$2a$10$hash', salt: 'zz' }], total: 1 })
    const page = await api.searchPersonCandidates({ keyword: '钱' })
    expect(Object.keys(page.list[0]!).sort()).toEqual(['id', 'organizationName', 'realName', 'username'])
    expect(JSON.stringify(page)).not.toMatch(/password|salt|\$2a\$/)
  })

  it('空关键字、全量拉取的 pageSize 与坏响应都在本地拒绝', async () => {
    const { api, calls, responses } = personFixture()
    await expect(api.searchPersonCandidates({ keyword: '   ' })).rejects.toThrow(/长选项参数/)
    await expect(api.listExternalPersons({ keyword: '' })).rejects.toThrow(/长选项参数/)
    await expect(api.searchPersonCandidates({ keyword: '张', pageSize: -1 })).rejects.toThrow(/全量拉取/)
    await expect(api.listExternalPersons({ keyword: '张', pageSize: 501 })).rejects.toThrow(/最多 500/)
    await expect(api.listExternalPersons({ keyword: '张', pageNo: 0 })).rejects.toThrow(/pageNo/)
    // 上面这些都在发请求前就拒绝了
    expect(calls).toHaveLength(0)
    // 坏响应是发出去之后才判的：这两条确实打了请求，但必须抛错而不是返回空页
    responses.push({ list: [], total: 'x' })
    await expect(api.searchPersonCandidates({ keyword: '张' })).rejects.toThrow(/list 或 total/)
    responses.push({ total: 0 })
    await expect(api.listExternalPersons({ keyword: '张' })).rejects.toThrow(/list 或 total/)
    expect(calls).toHaveLength(2)
  })

  it('Portal 与 Java 源码锁定两个候选的页面语境（本页不传 gradeId）', () => {
    const modal = read(PORTAL_REPO, PERSON_MODAL)
    const sysUserDao = read(JAVA_REPO, 'erp-module-system/erp-module-system-biz/src/main/resources/mapper/hrSysUser/SysUserDao.xml')
    const studentService = read(JAVA_REPO, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/study/base/service/impl/StudyStudentServiceImpl.java')

    // 内部人员：{ name, pageNo, pageSize }，没有 gradeId
    expect(modal).toContain("() => http.get('/sys/user/userNotInGrade', {\n    params: {\n      name: filterName.value,\n      pageNo: pageNo.value,\n      pageSize: 5")
    // 外部人员：同一形状
    expect(modal).toContain("() => http.get('/study/grade/student/getExternalStudentList', {\n    params: {\n      name: filterName2.value,\n      pageNo: pageNo2.value,\n      pageSize: 5")
    // 回传给表单的是 { staffName, staffCode }
    expect(modal).toContain('staffName: item.staffName')
    expect(modal).toContain('staffCode: item.staffCode')
    // 「未注册智慧蛋鸡人员」是纯本地输入，不发请求
    expect(modal).toContain('addNameList.value.push({ staffCode: addName.value })')
    expect(modal).not.toContain("http.get('/study/grade/student/addGradeStudent'")

    // 后端：userNotInGrade 不过滤已在班级的人 + name 仅前缀匹配
    const notInGrade = sysUserDao.slice(sysUserDao.indexOf('<select id="getUserNotInGrade"'), sysUserDao.indexOf('</select>', sysUserDao.indexOf('<select id="getUserNotInGrade"')))
    expect(notInGrade).toContain('LEFT JOIN (SELECT distinct staff_code')
    expect(notInGrade).not.toContain('s.staff_code is null')
    expect(notInGrade.slice(notInGrade.indexOf('<where>'))).not.toContain('s.')
    // 外部人员：服务端固定 isStaff=0
    expect(studentService).toContain('dto.setIsStaff(0)')
  })

  it('两条能力的 AI 说明完整、与班级管理页那条分开，并点明同 URL 不同语境', async () => {
    const internal = contracts['business-registration-person-candidate']!
    const external = contracts["business-registration-external-person-list"]!

    expect(internal.effect).toBe('read')
    expect(external.effect).toBe('read')
    expect(internal.inputs.keyword!.required).toBe(true)
    expect(internal.inputs.pageSize!.default).toBe('5')
    expect(internal.boundaries.join(' ')).toContain('不是同一条')
    expect(internal.boundaries.join(' ')).toContain('未注册智慧蛋鸡人员')
    expect(internal.consume.join(' ')).toContain('并不过滤已在班级的人')
    expect(internal.consume.join(' ')).toContain('staffCode')
    expect(external.inputs.keyword!.meaning).toContain('同时按 name 与 mobile')
    expect(external.consume.join(' ')).toContain('拿不到内部人员')
    expect(external.consume.join(' ')).toContain('恒为空')

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContract } = await import(validatorUrl) as {
      validateAiContract: (id: string, value: unknown, options: Record<string, unknown>) => Array<{ code: string; message: string }>
    }
    for (const id of ['business-registration-person-candidate', 'business-registration-external-person-list']) {
      const issues = validateAiContract(id, contracts[id], { profile: 'complete', definitions: businessRegistrationCapabilities, contracts })
      const unexpected = issues.filter(issue => issue.code !== 'incomplete-evidence')
      expect(unexpected, `${id}: ${JSON.stringify(unexpected)}`).toEqual([])
      expect(contracts[id]!.gaps?.length ?? 0).toBeGreaterThan(0)
    }
  })
})
