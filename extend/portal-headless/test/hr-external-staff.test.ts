import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createHrExternalStaffCapability,
  HR_EXTERNAL_STAFF_METHODS,
  HR_EXTERNAL_STAFF_MODULE_TYPE,
  HR_EXTERNAL_STAFF_PAGE_PATH,
  HR_EXTERNAL_STAFF_PERMISSION,
  hrExternalStaffCapabilities,
} from '../src/capabilities/hr-external-staff.js'
import { HR_EXTERNAL_STAFF_AI_CONTRACTS as contracts } from '../src/catalog/contracts-hr-external-staff.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createHrExternalStaffCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const record = {
  id: '9007199254740993', organization: '18', name: '李外部', idType: 1, idCard: '330102199001010011', birthday: '1990-01-01 00:00:00', sex: 1,
  mobile: '13800138000', nation: '汉族', staffCode: '13800138000', nativePlace: '杭州', isDel: 0, householdType: 2, residenceAddress: '户籍地址', address: '现住址',
  politicalOutlook: 4, communistTime: null, education: 5, academicDegree: 1, isFullTime: 1, enrollmentDate: null, graduationTime: null,
  university: '大学', speciality: '专业', creator: '11', createTime: '2026-09-23 10:00:00', updater: '12', updateTime: '2026-09-23 10:20:00',
  educationUniversity: '在职大学', educationSpeciality: '管理', outstandingAchievement: '业绩', expertise: '特长', awards: '奖项', appointmentFirm: '任职公司', appointmentPost: '董事', appointmentTime: '2026-01-01 00:00:00',
  appointmentFirmExecutives: '', appointmentPostExecutives: '', appointmentTimeExecutives: null, tenantId: '9', studyPost: '顾问', fullPath: '总部/杭州',
}

const form = {
  organization: '18', appointmentFirm: '任职公司', appointmentPost: '董事', appointmentTime: '2026-01-01 00:00:00', appointmentFirmExecutives: '', appointmentPostExecutives: '', appointmentTimeExecutives: null,
  name: '李外部', idType: 1, idCard: '330102199001010011', birthday: '1990-01-01 00:00:00', sex: 1, mobile: '13800138000', nation: '汉族', nativePlace: '杭州', householdType: 2,
  residenceAddress: '户籍地址', address: '现住址', politicalOutlook: 4, communistTime: null, university: '大学', speciality: '专业', educationUniversity: '在职大学', educationSpeciality: '管理', education: 5, academicDegree: 1, isFullTime: 1,
  studyPost: '顾问', expertise: '特长', awards: '奖项', outstandingAchievement: '业绩',
}

describe('Portal 人力 → 外部员工页面能力', () => {
  it('逐页锁定菜单、路由、列表动作、module-type和表单提交规则', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/staff/external-staff-list.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/staff/external-staff-list/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/staff/external-staff-list/[mode]/[id].vue')
    for (const fragment of [`path: '${HR_EXTERNAL_STAFF_PAGE_PATH}'`, `permission: '${HR_EXTERNAL_STAFF_PERMISSION}'`]) expect(menu).toContain(fragment)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "getDataListURL: '/org/outsideStaff/page'", "deleteURL: '/org/outsideStaff'", 'deleteIsBatch: true', 'exportURL:',
      "name: ''", "mobile: ''", "orgId: ''", 'record.status !== 2', 'actionEdit(record, record)', 'actionVerify(record)', 'useSensitiveAction',
    ]) expect(list).toContain(fragment)
    expect(list).not.toContain('common-action-export')
    for (const fragment of [
      "http(`/org/outsideStaff/${id}`)", "http.post('/org/outsideStaff'", "http.put('/org/outsideStaff'", 'transformUndefinedToNull: true',
      "max: 30", "max: 10", "max: 20", 'validateOnlySpace', 'validateOnlyNumberAndLetter', "name: [", "idType: [", "idCard: [", "birthday: [", "sex: [", "mobile: [",
    ]) expect(formPage).toContain(fragment)
    expect(hrExternalStaffCapabilities.map(item => item.id)).toEqual(Object.keys(HR_EXTERNAL_STAFF_METHODS))
    expect(hrExternalStaffCapabilities.every(item => item.pagePath === HR_EXTERNAL_STAFF_PAGE_PATH && item.permission === HR_EXTERNAL_STAFF_PERMISSION && item.moduleType === HR_EXTERNAL_STAFF_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(HR_EXTERNAL_STAFF_PAGE_PATH).moduleType).toBe(HR_EXTERNAL_STAFF_MODULE_TYPE)
  })

  it('逐页锁定Java Controller、DTO、手机号写入staffCode、逻辑删除和组织筛选', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrOutsideStaffController.java')
    const dto = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrOutsideStaffDTO.java')
    const select = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrOutsideStaffSelectDTO.java')
    const service = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/service/impl/HrOutsideStaffServiceImpl.java')
    const mapper = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/resources/mapper/organization/staff/HrOutsideStaffDao.xml')
    for (const fragment of ['@RequestMapping("/org/outsideStaff")', '@GetMapping("page")', '@GetMapping("{id}")', '@PostMapping', '@PutMapping', '@DeleteMapping']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long organization', 'private String name', 'private Integer idType', 'private Long mobile', 'private LocalDateTime appointmentTime', 'private String fullPath']) expect(dto).toContain(fragment)
    for (const fragment of ['private String name', 'private Long orgId', 'private Long mobile', 'private Integer pageNo', 'private Integer pageSize']) expect(select).toContain(fragment)
    for (const fragment of ['public PageData<HrOutsideStaffDTO> pageInfo', 'dto.setStaffCode(dto.getMobile())', 'hrOutsideStaffDao.selectOne', 'setIsDel(1)', 'updateOutSideStaff']) expect(service).toContain(fragment)
    for (const fragment of ['a.is_del = 0', 'dto.name', 'dto.mobile', 'dto.orgId', 'b.full_path as fullPath']) expect(mapper).toContain(fragment)
  })

  it('按Portal实际请求形状覆盖列表、详情、准备新建、POST、准备编辑和PUT', async () => {
    const f = fixture([{ list: [record], total: 1 }, record, undefined, undefined])
    await expect(f.api.list({ name: '李', mobile: '138', orgId: '18', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [record], total: 1 })
    await expect(f.api.get({ id: record.id })).resolves.toEqual(record)
    const created = f.api.prepareCreate({ form })
    expect(created.draft).toEqual(form)
    await f.api.create({ draft: created.draft })
    const prepared = f.api.prepareUpdate({ current: record, changes: { name: '李外部二', mobile: '13900139000', appointmentPost: '监事' } })
    expect(prepared.previous).toMatchObject({ id: record.id, name: record.name, mobile: record.mobile })
    expect(prepared.draft).toMatchObject({ id: record.id, name: '李外部二', mobile: '13900139000', appointmentPost: '监事', fullPath: record.fullPath })
    await f.api.update({ draft: prepared.draft })
    expect(f.calls).toEqual([
      { url: '/org/outsideStaff/page', method: 'get', params: { order: '', orderField: '', name: '李', mobile: '138', orgId: '18', pageNo: 2, pageSize: 50 } },
      { url: '/org/outsideStaff/9007199254740993', method: 'get' },
      { url: '/org/outsideStaff', method: 'post', data: form },
      { url: '/org/outsideStaff', method: 'put', data: { ...record, name: '李外部二', mobile: '13900139000', appointmentPost: '监事' } },
    ])
  })

  it('按Portal敏感操作规则覆盖准备删除、短信、校验、删除和取消边界', async () => {
    const f = fixture([{ mobile: '13800138000', isDel: 0 }, { mobile: '13800138000', isDel: 0 }, { requestId: 123 }, { mobile: '', isDel: 1 }, undefined])
    await expect(f.api.prepareRemove({ ids: [record.id, record.id] })).resolves.toEqual({ ids: [record.id], verificationRequired: true, phone: '13800138000' })
    await expect(f.api.sendDeleteCode({ ids: [record.id] })).resolves.toEqual({ smsRequestId: '123' })
    await f.api.remove({ ids: [record.id] })
    expect(f.calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/sys/sms/send', method: 'get', params: { phone: '13800138000', templateId: '17709' } },
      { url: '/org/sensitive/info', method: 'get' },
      { url: '/org/outsideStaff', method: 'delete', data: [record.id] },
    ])
    const blocked = fixture([{ mobile: '13800138000', isDel: 0 }])
    await expect(blocked.api.remove({ ids: [record.id] })).rejects.toThrow('短信验证')
    expect(blocked.calls).toHaveLength(1)
    expect(blocked.calls[0]).toEqual({ url: '/org/sensitive/info', method: 'get' })
  })

  it('表单、分页、ID、短信和坏响应在请求前显式失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.list({ orgId: '0' })).rejects.toThrow('orgId')
    expect(() => f.api.prepareCreate({ form: { ...form, name: '12345678901' } })).toThrow('name')
    expect(() => f.api.prepareCreate({ form: { ...form, idCard: '身份证' } })).toThrow('数字和字母')
    expect(() => f.api.prepareCreate({ form: { ...form, appointmentFirm: '   ' } })).toThrow('全为空格')
    expect(() => f.api.prepareCreate({ form: { ...form, appointmentTime: null } })).toThrow('appointmentTime')
    expect(() => f.api.prepareUpdate({ current: record, changes: { status: 1 } as never })).toThrow('不支持字段')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ ...record, id: 0 }]).api.get({ id: 1 })).rejects.toThrow('外部员工详情')
    await expect(fixture([new Error('权限不足')]).api.list()).rejects.toThrow('权限不足')
    expect(f.calls).toEqual([])
  })

  it('AI说明锁定页面动作边界、表单规则、敏感删除链，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(HR_EXTERNAL_STAFF_METHODS).sort())
    expect(contracts['hr-external-staff-list']?.boundaries.join(' ')).toContain('不发布导出')
    expect(contracts['hr-external-staff-list']?.boundaries.join(' ')).toContain('status')
    expect(contracts['hr-external-staff-prepare-create']?.consume.join(' ')).toContain('idCard')
    expect(contracts['hr-external-staff-prepare-remove']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['hr-external-staff-remove']?.consume.join(' ')).toContain('验证码')
    expect(contracts['hr-external-staff-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].fullPath', 'list[].appointmentTime']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
