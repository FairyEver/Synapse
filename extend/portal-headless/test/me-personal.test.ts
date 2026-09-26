import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ME_PERSONAL_FORM_PATH,
  ME_PERSONAL_METHODS,
  ME_PERSONAL_MODULE_TYPE,
  ME_PERSONAL_PAGE_PATH,
  ME_PERSONAL_PERMISSION,
  ME_PERSONAL_PROCESS_KEY,
  createMePersonalCapability,
  mePersonalCapabilities,
  type MePersonalDetail,
  type MePersonalStartUserSelectTask,
} from '../src/capabilities/me-personal.js'
import {
  ME_PERSONAL_AI_CONTRACTS as contracts,
  ME_PERSONAL_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-me-personal.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'

type RequestConfig = Parameters<PortalRequest>[0]

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createMePersonalCapability(request), calls }
}

function detail (overrides: Record<string, unknown> = {}): MePersonalDetail {
  return {
    id: 17,
    staffId: 17,
    name: '张三',
    staffCode: '10017',
    staffDuties: '1,2',
    otherPosts: '3',
    seniorityBeforeEntry: 2,
    entrySeniority: 5,
    totalSeniority: 99,
    workList: [{ id: 900, companyName: '原公司', department: '研发', duties: '工程师' }],
    educationalList: [{ id: 901, school: '原大学', speciality: '计算机', degree: 1, legacyOnly: 'drop' }],
    familyList: [{ id: 902, name: '家人', remark: '保留' }],
    professionalList: [{ id: 903, name: '证书', code: 'A1' }],
    positionalList: [{ id: 904, name: '职称', remark: 'Portal无rules' }],
    contractList: [{ id: 905, termType: 2, startTime: '2024-01-01', endTime: '2099-01-01' }],
    ...overrides,
  }
}

describe('Portal 人力 → 个人信息页面能力', () => {
  it('逐页核对菜单、读取接口、编辑入口和表单提交入口', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/hr.js')
    const page = read(portal, 'app/portal/views/dashboard/hr/me/personal/list.vue')
    const form = read(portal, 'app/portal/views/simple/hr/form/025/page/pc/edit/index.vue')
    const flow = read(portal, 'app/portal/utils/flow.js')

    expect(menu).toContain(`path: '${ME_PERSONAL_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${ME_PERSONAL_PERMISSION}'`)
    expect(page).toContain('userStore.state.staffId')
    expect(page).toContain("http(`/org/staff/${staffId}`)")
    expect(page).toContain(`path: '${ME_PERSONAL_FORM_PATH}'`)
    expect(page).toContain("bpmMode: 'edit'")
    expect(form).toContain("const apiCheck = '/hr/staff-info-change/getRequiredStartUserSelectTasks'")
    expect(form).toContain("'/hr/staff-info-change/create'")
    expect(form).toContain('startUserSelectAssignees: tasksData')
    expect(flow).toContain(`'${ME_PERSONAL_FORM_PATH}'`)
    expect(mePersonalCapabilities.map(item => item.id)).toEqual(Object.keys(ME_PERSONAL_METHODS))
    expect(mePersonalCapabilities.every(item => item.pagePath === ME_PERSONAL_PAGE_PATH && item.permission === ME_PERSONAL_PERMISSION && item.moduleType === ME_PERSONAL_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(mePersonalCapabilities.find(item => item.id === 'me-personal-submit')?.write).toBe(true)
    expect(mePersonalCapabilities.filter(item => item.id !== 'me-personal-submit').every(item => !item.write)).toBe(true)
  })

  it('逐页核对Java端点、DTO字段、状态规则，并锁定前置接口缺失证据', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const staffController = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrStaffController.java')
    const changeController = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/staffinfochange/StaffInfoChangeController.java')
    const saveVo = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/staffinfochange/vo/StaffInfoChangeSaveReqVO.java')
    const dto = read(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrStaffInfoDTO.java')
    const service = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/staffinfochange/impl/StaffInfoChangeServiceImpl.java')

    expect(staffController).toContain('@RequestMapping("/org/staff")')
    expect(staffController).toContain('@GetMapping("{id}")')
    expect(staffController).toContain('HrStaffInfoDTO')
    for (const fragment of ['@RequestMapping("/hr/staff-info-change")', '@PostMapping("/create")', '@GetMapping("/get")', 'CommonResult<Long>', '@PostMapping("/cancel/{id}")']) expect(changeController).toContain(fragment)
    expect(changeController).not.toContain('getRequiredStartUserSelectTasks')
    expect(saveVo).toContain('@NotNull')
    expect(saveVo).toContain('@Size(max = 500,')
    for (const fragment of ['private String staffDuties', 'private List<HrStaffContractDTO> contractList', 'private List<HrStaffEducationalExperienceDTO> educationalList', 'private List<HrStaffFamilyInfoDTO> familyList', 'private List<HrStaffProfessionalDTO> professionalList', 'private List<HrStaffPositionalDTO> positionalList', 'private List<HrStaffWorkExperienceDTO> workList']) expect(dto).toContain(fragment)
    for (const fragment of ['StaffInfoChangeStatusEnum.SUBMITTED', 'StaffInfoChangeStatusEnum.REJECTED', '不允许重复提交', 'cancelChange']) expect(service).toContain(fragment)
    expect(Object.keys(ME_PERSONAL_METHODS)).not.toContain('me-personal-update')
    expect(Object.keys(ME_PERSONAL_METHODS)).not.toContain('me-personal-cancel')
  })

  it('复刻读取、编辑入口、prepare→submit和变更单回查请求', async () => {
    const tasks: MePersonalStartUserSelectTask[] = [{ id: 'Activity_1', name: '发起人自选', minSelectCount: 1, maxSelectCount: 2 }]
    const f = fixture([detail(), tasks, 888, detail({ id: 888, staffId: 17, status: 1, processInstanceId: 'proc-1' })])
    await expect(f.api.get({ staffId: 17 })).resolves.toMatchObject({ id: 17, name: '张三' })
    expect(f.api.prepareEdit()).toEqual({ path: ME_PERSONAL_FORM_PATH, processKey: ME_PERSONAL_PROCESS_KEY, bpmMode: 'edit' })
    const prepared = await f.api.prepare({ current: detail(), changes: { name: '李四', staffDuties: ['5', '6'], otherPosts: [] } })
    expect(prepared.tasks).toEqual(tasks)
    expect(prepared.draft).toMatchObject({ staffId: 17, name: '李四', staffDuties: '5,6', otherPosts: '', totalSeniority: 7 })
    expect(prepared.draft.educationalList).toEqual([{ startTime: null, endTime: null, school: '原大学', speciality: '计算机', degree: 1, academicDegree: null, educationalSystem: null, learningStyle: null, isFullTime: null, isUnifiedRecruitment: null, isHighestDegree: null, isFirstDegree: null, degreeFile: null, academicDegreeFile: null, educationType: null, havingRentalSubsidies: null, rentalFile: null }])
    expect((prepared.draft.contractList as Array<Record<string, unknown>>)[0]).not.toHaveProperty('endTime')
    const id = await f.api.submit({ draft: prepared.draft, tasks: prepared.tasks, startUserSelectAssignees: { Activity_1: [9001] } })
    expect(id).toBe(888)
    await expect(f.api.getChange({ id })).resolves.toMatchObject({ id: 888, status: 1 })
    expect(f.calls).toEqual([
      { url: '/org/staff/17', method: 'get' },
      { url: '/hr/staff-info-change/getRequiredStartUserSelectTasks', method: 'post', data: expect.objectContaining({ name: '李四', staffDuties: '5,6', otherPosts: '' }) },
      { url: '/hr/staff-info-change/create', method: 'post', data: expect.objectContaining({ name: '李四', startUserSelectAssignees: { Activity_1: [9001] } }) },
      { url: '/hr/staff-info-change/get', method: 'get', params: { id: 888 } },
    ])
  })

  it('复刻普通编辑的司龄数字归一和兼职组织字段映射', async () => {
    const f = fixture([[]])
    const prepared = await f.api.prepare({
      current: detail({
        seniorityBeforeEntry: '3',
        entrySeniority: '4',
        totalSeniority: '999',
        otherOrganizationInfoList: [{ organizationId: 7, postIdList: [8] }],
      }),
    })
    expect(prepared.draft).toMatchObject({
      seniorityBeforeEntry: 3,
      entrySeniority: 4,
      totalSeniority: 7,
      otherOrganizationList: [{ organizationId: 7, postIdList: [8] }],
    })
  })

  it('不放松Portal表单规则，也不在校验失败时发请求', async () => {
    const f = fixture()
    await expect(f.api.prepare({ current: detail({ educationalList: [{ school: '', speciality: '计算机' }] }) })).rejects.toThrow('educationalList[0].school')
    await expect(f.api.prepare({ current: detail({ workList: [{ companyName: ' '.repeat(2) }] }) })).rejects.toThrow('workList[0].companyName')
    await expect(f.api.prepare({ current: detail({ professionalList: [{ code: '证书#1' }] }) })).rejects.toThrow('professionalList[0].code')
    await expect(f.api.prepare({ current: detail({ familyList: [{ age: 0 }] }) })).rejects.toThrow('familyList[0].age')
    expect(f.calls).toHaveLength(0)
    const allowed = fixture([[]])
    await expect(allowed.api.prepare({ current: detail({ positionalList: [{ remark: ' '.repeat(500) }] }) })).resolves.toMatchObject({ tasks: [] })
    expect(allowed.calls).toHaveLength(1)
  })

  it('严格校验审批人节点映射和响应反证', async () => {
    const tasks: MePersonalStartUserSelectTask[] = [{ id: 'Activity_1', name: '审批人', minSelectCount: 1, maxSelectCount: 1 }]
    const f = fixture([1])
    await expect(f.api.submit({ draft: detail(), tasks, startUserSelectAssignees: {} })).rejects.toThrow('至少需要选择1人')
    await expect(f.api.submit({ draft: detail(), tasks, startUserSelectAssignees: { Activity_1: [1, 1] } })).rejects.toThrow('不能重复')
    await expect(f.api.submit({ draft: detail(), tasks, startUserSelectAssignees: { Unknown: [1] } })).rejects.toThrow('未知节点')
    expect(f.calls).toHaveLength(0)
    const badResponse = fixture([{}])
    await expect(badResponse.api.get({ staffId: 17 })).rejects.toThrow('个人信息ID')
    const badTasks = fixture([{}])
    await expect(badTasks.api.prepare({ current: detail() })).rejects.toThrow('审批人节点响应必须是数组')
  })

  it('AI契约逐方法登记，并用反证锁定提交规则和权限边界', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: mePersonalCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(ME_PERSONAL_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(ME_PERSONAL_METHODS).map(method => `mePersonal.${method}`))
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['me-personal-prepare']?.output.fields.some(item => item.path === 'draft.educationalList')).toBe(true)
    expect(contracts['me-personal-submit']?.steps.some(step => step.capabilityId === 'me-personal-change-get')).toBe(true)
    const broken = structuredClone(contracts)
    broken['me-personal-submit']!.output.fields = broken['me-personal-submit']!.output.fields.filter(item => item.path !== '$')
    expect(validateAiContracts(broken, { definitions: mePersonalCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
