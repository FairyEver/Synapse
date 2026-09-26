import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosResponse } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createHrInternalStaffCapability,
  HR_INTERNAL_STAFF_METHODS,
  HR_INTERNAL_STAFF_MODULE_TYPE,
  HR_INTERNAL_STAFF_PAGE_PATH,
  HR_INTERNAL_STAFF_PERMISSION,
  hrInternalStaffCapabilities,
} from '../src/capabilities/hr-internal-staff.js'
import { HR_INTERNAL_STAFF_AI_CONTRACTS as contracts } from '../src/catalog/contracts-hr-internal-staff.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createHrInternalStaffCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const id = '9007199254740993'
const form = {
  name: '李内部', staffCode: '', idType: 1, idCard: '330102199001010011', sex: 1, birthday: '1990-01-01 00:00:00', nation: '汉族',
  organization: '18', otherOrganizationList: [{ organizationId: '19', postIdList: ['22'] }], post: '20', salaryLevel: '3', salaryStructure: '4', employmentType: 1, status: 1,
  staffStatus: 1, entryTime: '2020-01-01 00:00:00', entrySeniority: 12, cardIssuingBank: '银行', bankAccount: '6222000000000000', insureArea: '杭州',
  mobile: '13800138000', address: '现住址', residenceAddress: '户籍地址', emergencyContact: '联系人', emergencyMobile: '13900139000', education: 5,
  academicDegree: 1, isFullTime: 1, university: '大学', speciality: '专业', staffDuties: ['1', '2'], otherPosts: ['21'],
  workList: [{ _key: 'work-1', companyName: '公司', description: '经历' }],
  educationalList: [{ _key: 'edu-1', school: '学校', speciality: '专业' }],
  familyList: [{ _key: 'family-1', name: '家人', mobile: '13800138001' }],
  professionalList: [{ _key: 'pro-1', code: 'A001' }],
  positionalList: [{ _key: 'pos-1', code: 'P001' }],
  contractList: [{ _key: 'contract-1', termType: 2, endTime: '2030-01-01 00:00:00', type: 1 }],
  postTransferList: [], rewardPunishmentList: [{ _key: 'reward-1', occurDate: '2026-01-01', method: '奖励', content: '优秀', amount: 12.5 }],
}

const detail = {
  id, ...form, staffDuties: '1,2', otherPosts: '21', status: 1, fullPath: '总部/杭州', postName: '岗位',
  workList: [{ id: '31', companyName: '公司', description: '经历' }], educationalList: [{ id: '32', school: '学校', speciality: '专业' }],
  familyList: [], professionalList: [], positionalList: [], contractList: [{ id: '33', termType: 2, endTime: '2030-01-01 00:00:00' }],
  postTransferList: [{ id: '34', staffId: id, beforeOrganizationName: '旧组织', afterOrganizationName: '新组织', uiOnly: 'drop' }], rewardPunishmentList: [],
}

function response (data: ArrayBuffer, headers: Record<string, string> = {}): AxiosResponse<ArrayBuffer> {
  return { data, headers, status: 200, statusText: 'OK', config: {} as never } as AxiosResponse<ArrayBuffer>
}

describe('Portal 人力 → 内部员工页面能力', () => {
  it('逐页锁定菜单、路由、查询、导出、删除条件、表单、导入和历史入口', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const route = read(root, 'app/portal/views/dashboard/hr/staff/staff-list.vue')
    const list = read(root, 'app/portal/views/dashboard/hr/staff/staff-list/list.vue')
    const formPage = read(root, 'app/portal/views/dashboard/hr/staff/staff-list/[mode]/[id].vue')
    const importPage = read(root, 'app/portal/views/dashboard/hr/staff/staff-list/components/create-multiple.vue')
    for (const fragment of [`path: '${HR_INTERNAL_STAFF_PAGE_PATH}'`, `permission: '${HR_INTERNAL_STAFF_PERMISSION}'`]) expect(menu).toContain(fragment)
    expect(route).toContain('common-layout-dashboard-crud-container cache="list"')
    for (const fragment of [
      "getDataListURL: '/org/staff/page'", "deleteURL: '/org/staff'", 'deleteIsBatch: true', 'record.status !== 2', 'actionCustomExport',
      "getCustomInfo", "customExports", "history/page", "sqlParam: ''", "status: ''", "orgId: ''",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http(`/org/staff/${id}`)", "http.post('/org/staff'", "http.put(", "'/org/staff'", 'transformUndefinedToNull: true', 'downtimePay',
      'validateOnlySpace', 'validateOnlyNumberAndLetter', 'rewardPunishmentList', 'postTransferList', 'delete contract.endTime',
    ]) expect(formPage).toContain(fragment)
    for (const fragment of ["/org/staff/import/precheck", "'/org/staff/import'", "'/org/staff/importContract'", 'downloadContractTemplate', 'FormData']) expect(importPage).toContain(fragment)
    expect(hrInternalStaffCapabilities.map(item => item.id)).toEqual(Object.keys(HR_INTERNAL_STAFF_METHODS))
    expect(hrInternalStaffCapabilities.every(item => item.pagePath === HR_INTERNAL_STAFF_PAGE_PATH && item.permission === HR_INTERNAL_STAFF_PERMISSION && item.moduleType === HR_INTERNAL_STAFF_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(HR_INTERNAL_STAFF_PAGE_PATH).moduleType).toBe(HR_INTERNAL_STAFF_MODULE_TYPE)
  })

  it('逐页锁定Java主表、子表、删除状态、导入导出和变更历史', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrStaffController.java')
    const dto = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrStaffInfoDTO.java')
    const select = read(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrStaffSelectDTO.java')
    const service = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/service/impl/HrStaffServiceImpl.java')
    const history = read(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrStaffChangeLogController.java')
    for (const fragment of ['@RequestMapping("/org/staff")', '@GetMapping("page")', '@GetMapping("{id}")', '@PostMapping', '@PutMapping', '@DeleteMapping', 'post-transfer/import-template', 'customExports', 'getCustomInfo', 'downloadContractTemplate', 'importContract']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long organization', 'private String name', 'private Long mobile', 'private String staffDuties', 'private List<HrStaffWorkExperienceDTO> workList', 'private List<HrStaffContractDTO> contractList', 'private List<HrStaffPostTransferDTO> postTransferList', 'private List<HrStaffRewardPunishmentDTO> rewardPunishmentList']) expect(dto).toContain(fragment)
    for (const fragment of ['private String staffName', 'private Long staffCode', 'private Integer status', 'private Long orgId', 'private String sqlParam', 'private Integer pageNo', 'private Integer pageSize']) expect(select).toContain(fragment)
    for (const fragment of ['wrapper.ne("status", 2)', '未离职不能被删除', 'customExports']) expect(service).toContain(fragment)
    for (const fragment of ['@RequestMapping("/hr/staff/changeLog")', '@GetMapping("page")', '@GetMapping("{id}")', 'listByStaffId']) expect(history).toContain(fragment)
  })

  it('按Portal实际请求形状覆盖分页、详情、全量准备/提交和嵌套字段归一化', async () => {
    const f = fixture([{ list: [{ id, name: '李内部', status: 1, organization: '18', mobile: '13800138000' }], total: 1 }, detail, id, undefined, detail])
    await expect(f.api.list({ staffName: '李', staffCode: '1001', postName: '岗位', status: 1, orgId: '18', mobile: '138', sqlParam: 'status = 1', pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1 })
    await expect(f.api.get({ id })).resolves.toMatchObject({ id })
    const created = f.api.prepareCreate({ form })
    expect(created.draft).toMatchObject({ name: '李内部', organization: '18', staffDuties: '1,2', otherPosts: '21' })
    expect(created.draft.workList).toEqual([{ companyName: '公司', description: '经历' }])
    expect(created.draft.contractList).toEqual([{ termType: 2, type: 1 }])
    expect(created.draft.rewardPunishmentList).toEqual([{ occurDate: '2026-01-01', method: '奖励', content: '优秀', amount: '12.5' }])
    await expect(f.api.create({ draft: created.draft })).resolves.toEqual({ id })
    const prepared = f.api.prepareUpdate({ current: detail, changes: { name: '李内部二', rewardPunishmentList: [{ occurDate: '2026-01-02', method: '奖励', content: '优秀', amount: 0 }] } })
    expect(prepared.previous).toMatchObject({ id, staffDuties: '1,2', otherPosts: '21' })
    expect(prepared.draft).toMatchObject({ id, name: '李内部二', staffDuties: '1,2', otherPosts: '21' })
    expect(prepared.draft.postTransferList).toBeUndefined()
    await f.api.update({ draft: prepared.draft })
    expect(f.calls.slice(0, 4)).toEqual([
      { url: '/org/staff/page', method: 'get', params: { order: '', orderField: '', staffName: '李', staffCode: '1001', postName: '岗位', status: 1, orgId: '18', mobile: '138', sqlParam: 'status = 1', pageNo: 2, pageSize: 50 } },
      { url: `/org/staff/${id}`, method: 'get' },
      { url: '/org/staff', method: 'post', data: created.draft },
      { url: '/org/staff', method: 'put', data: prepared.draft },
    ])
  })

  it('postTransferList只有显式修改才提交，并只保留Portal允许的字段', () => {
    const f = fixture([detail])
    const prepared = f.api.prepareUpdate({ current: detail, changes: { postTransferList: [{ beforeOrganizationName: ' 旧 ', afterOrganizationName: ' 新 ', uiOnly: 'drop' }] } })
    expect(prepared.draft.postTransferList).toEqual([{ beforeOrganizationName: '旧', afterOrganizationName: '新', staffId: id }])
  })

  it('按页面动作覆盖自定义信息、导出、三类导入、模板和历史', async () => {
    const bytes = new Uint8Array([1, 2, 3]).buffer
    const f = fixture([
      { tableName: 'hr_staff', customColumnsInfo: [], customExportColumns: [], customQueryColumns: [] }, response(bytes, { 'content-type': XLSX_MIME, 'content-disposition': "attachment; filename*=UTF-8''人员.xlsx" }),
      ['存在同员工编号'], ['导入完成'], '合同导入完成', 'https://example.test/template.xlsx', response(bytes), response(bytes), response(bytes), '员工变动导入完成', { list: [{ id: '51', staffId: id, changeFieldCount: 1 }], total: 1 }, { id: '51', staffId: id, changeItems: [{ fieldName: 'name', oldValue: '旧', newValue: '新' }] },
    ])
    await expect(f.api.customInfo()).resolves.toMatchObject({ tableName: 'hr_staff' })
    await expect(f.api.customExport({ columnIds: ['name'], organizationIds: ['18'] })).resolves.toMatchObject({ fileName: '人员.xlsx', byteLength: 3 })
    const file = { fileName: '员工.xlsx', base64: 'AQID', contentType: XLSX_MIME }
    await expect(f.api.importPrecheck({ file })).resolves.toEqual(['存在同员工编号'])
    await expect(f.api.importStaff({ file })).resolves.toEqual(['导入完成'])
    await expect(f.api.importContract({ file, mode: 1 })).resolves.toBe('合同导入完成')
    await expect(f.api.downloadTemplate({ orgId: '18' })).resolves.toMatchObject({ byteLength: 3 })
    await expect(f.api.downloadContractTemplate()).resolves.toMatchObject({ byteLength: 3 })
    await expect(f.api.downloadPostTransferTemplate()).resolves.toMatchObject({ byteLength: 3 })
    await expect(f.api.importPostTransfer({ staffId: id, file: { ...file, fileName: '变动.xls', contentType: XLS_MIME } })).resolves.toBe('员工变动导入完成')
    await expect(f.api.historyList({ staffId: id })).resolves.toMatchObject({ total: 1 })
    await expect(f.api.historyDetail({ id: '51' })).resolves.toMatchObject({ changeItems: [{ fieldName: 'name' }] })
    expect(f.calls[1]).toMatchObject({ url: '/org/staff/customExports', method: 'post', data: { columnIds: ['name'], organizationIds: ['18'] }, responseType: 'arraybuffer' })
    expect(f.calls[2]?.data).toBeInstanceOf(FormData)
    expect((f.calls[2]?.data as FormData).get('file')).toBeInstanceOf(Blob)
    expect(f.calls[4]?.data).toBeInstanceOf(FormData)
    expect((f.calls[4]?.data as FormData).get('mode')).toBe('1')
    expect(f.calls.at(-2)).toEqual({ url: '/hr/staff/changeLog/page', method: 'get', params: { order: '', orderField: '', staffId: id, operatorName: '', startTime: '', endTime: '', pageNo: 1, pageSize: 20 } })
  })

  it('敏感删除、离职状态、表单规则和坏响应在请求前显式失败', async () => {
    const f = fixture([{ mobile: '13800138000', isDel: 0 }, { mobile: '13800138000', isDel: 0 }, undefined, undefined])
    await expect(f.api.prepareRemove({ ids: [id], records: [{ id, status: 2 }] })).resolves.toEqual({ ids: [id], verificationRequired: true, phone: '13800138000' })
    await f.api.remove({ ids: [id], records: [{ id, status: 2 }], smsRequestId: 'req', code: '123456' })
    expect(f.calls).toEqual([
      { url: '/org/sensitive/info', method: 'get' }, { url: '/org/sensitive/info', method: 'get' }, { url: '/sys/sms/checkSms', method: 'get', params: { requestId: 'req', code: '123456' } }, { url: '/org/staff', method: 'delete', data: [id] },
    ])
    const invalid = fixture([])
    expect(() => invalid.api.prepareCreate({ form: { ...form, name: '12345678901' } })).toThrow('name')
    expect(() => invalid.api.prepareCreate({ form: { ...form, idCard: '身份证' } })).toThrow('数字和字母')
    expect(() => invalid.api.prepareCreate({ form: { ...form, status: 2, downtimePay: null } })).toThrow('downtimePay')
    expect(() => invalid.api.prepareCreate({ form: { ...form, rewardPunishmentList: [{ occurDate: '2026-01-01', method: '奖', content: '罚', amount: '1.234' }] } })).toThrow('amount')
    expect(() => invalid.api.prepareCreate({ form: { ...form, educationalList: [{ school: '', speciality: '专业' }] } })).toThrow('school')
    await expect(invalid.api.prepareRemove({ ids: [id], records: [{ id, status: 1 }] })).rejects.toThrow('离职')
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ id: 0 }]).api.get({ id: 1 })).rejects.toThrow('内部员工详情')
  })

  it('AI说明闭合并锁定表单、权限、导出边界，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(HR_INTERNAL_STAFF_METHODS).sort())
    expect(contracts['hr-internal-staff-list']?.boundaries.join(' ')).toContain('普通exportURL')
    expect(contracts['hr-internal-staff-list']?.boundaries.join(' ')).toContain('module-type=11')
    expect(contracts['hr-internal-staff-prepare-create']?.consume.join(' ')).toContain('downtimePay')
    expect(contracts['hr-internal-staff-prepare-update']?.consume.join(' ')).toContain('postTransferList')
    expect(contracts['hr-internal-staff-remove']?.consume.join(' ')).toContain('短信')
    expect(contracts['hr-internal-staff-get']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['workList', 'contractList', 'rewardPunishmentList']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const XLS_MIME = 'application/vnd.ms-excel'
