import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createHrTransferInPlanCapability,
  HR_TRANSFER_IN_PLAN_METHODS,
  HR_TRANSFER_IN_PLAN_MODULE_TYPE,
  HR_TRANSFER_IN_PLAN_PAGE_PATH,
  HR_TRANSFER_IN_PLAN_PERMISSION,
  hrTransferInPlanCapabilities,
} from '../src/capabilities/hr-transfer-in-plan.js'
import {
  HR_TRANSFER_IN_PLAN_AI_CONTRACTS as contracts,
  HR_TRANSFER_IN_PLAN_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-hr-transfer-in-plan.js'
import { AI_CONTRACTS, METHOD_CONTRACTS } from '../src/catalog/ai-contracts.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createHrTransferInPlanCapability(request), calls }
}

const page = { list: [{ id: '9007199254740993', organizationId: '21', postId: '31', planNumber: 3 }], total: 1 }
const tree = [{ id: '21', pid: 0, name: '总部', children: [{ id: '22', pid: '21', name: '研发', children: [] }] }]

describe('Portal 人力 → 组织管理 → 调入计划页面能力', () => {
  it('逐页核对菜单、列表/详情动作、权限上下文和Java接口', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portal, 'app/portal/menus/hr.js'), 'utf8')
    const list = readFileSync(join(portal, 'app/portal/views/dashboard/hr/org/transfer-in-plan/list.vue'), 'utf8')
    const detail = readFileSync(join(portal, 'app/portal/views/dashboard/hr/org/transfer-in-plan/detail/[id].vue'), 'utf8')
    const wrapper = readFileSync(join(portal, 'app/portal/views/dashboard/hr/org/transfer-in-plan.vue'), 'utf8')
    const orgController = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/controller/HrOrganizationController.java'), 'utf8')
    const planController = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/recruitmentplan/RecruitmentPlanController.java'), 'utf8')
    const planRequest = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/recruitmentplan/vo/RecruitmentPlanPageReqVO.java'), 'utf8')
    const planResponse = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/recruitmentplan/vo/RecruitmentPlanRespVO.java'), 'utf8')
    const planService = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/service/recruitmentplan/impl/RecruitmentPlanServiceImpl.java'), 'utf8')
    const status = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/recruitmentplan/enums/RecruitmentPlanStatusEnum.java'), 'utf8')
    const postController = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/post/controller/HrPostController.java'), 'utf8')
    const postDto = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/post/dto/HrPostDTO.java'), 'utf8')

    expect(menu).toContain(`path: '${HR_TRANSFER_IN_PLAN_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${HR_TRANSFER_IN_PLAN_PERMISSION}'`)
    expect(wrapper).toContain('title: 调入计划')
    expect(list).toContain("url=\"/org/organization/getRoleOrganizationTree\"")
    expect(list).toContain("http.get('/org/organization/getRoleOrganizationTree')")
    expect(list).toContain("http.get('/hr/recruitment-plan/page'")
    expect(list).toContain('pageNo: 1')
    expect(list).toContain('pageSize: 1000')
    expect(list).toContain('status: 2')
    expect(list).toContain("formatDay(new Date(), 'YYYY')")
    expect(list).toContain('collectIds')
    expect(list).toContain('sumPlansByOrganizationIds')
    expect(list).toContain("router.push(`/dashboard/org/transfer-in-plan/detail/${id || 0}`)")
    expect(detail).toContain("url=\"/org/organization/getRoleOrganizationTree\"")
    expect(detail).toContain("http.get('/hr/recruitment-plan/page'")
    expect(detail).toContain('organizationId: organizationId.value || null')
    expect(detail).toContain("formatDay(planYear.value, 'YYYY')")
    expect(detail).toContain('http.get(`/org/hrpost/${record.postId}`)')
    expect(detail).toContain("router.push(`/dashboard/staff/recruitment-plan/resume/${record.id}`)")
    expect(detail).toContain('genderRequirement')
    expect(detail).toContain('educationRequirement')
    expect(orgController).toContain('@GetMapping("getRoleOrganizationTree")')
    expect(orgController).toContain('loginUser.setModuleType(moduleType)')
    expect(planController).toContain('@RequestMapping("/hr/recruitment-plan")')
    expect(planController).toContain('@GetMapping("/page")')
    expect(planRequest).toContain('private Long organizationId')
    expect(planRequest).toContain('private Integer planYear')
    expect(planRequest).toContain('private Integer status')
    expect(planResponse).toContain('private String organizationFullPath')
    expect(planResponse).toContain('private Integer planNumber')
    expect(planResponse).toContain('private String salaryRangeName')
    expect(planService).toContain('.eqIfPresent(RecruitmentPlanDO::getOrganizationId, pageReqVO.getOrganizationId())')
    expect(planService).toContain('.eqIfPresent(RecruitmentPlanDO::getPlanYear, pageReqVO.getPlanYear())')
    expect(planService).toContain('.eqIfPresent(RecruitmentPlanDO::getStatus, pageReqVO.getStatus())')
    expect(status).toContain('APPROVED(2, "已审批")')
    expect(postController).toContain('@RequestMapping("/org/hrpost")')
    expect(postController).toContain('@GetMapping("{id}")')
    expect(postDto).toContain('private Integer gender')
    expect(postDto).toContain('private String educationalRequirement')
    expect(postDto).toContain('private String experienceRequirement')
    expect(postDto).toContain('private String abilityRequirement')
    expect(hrTransferInPlanCapabilities.every(item => item.pagePath === HR_TRANSFER_IN_PLAN_PAGE_PATH && item.permission === HR_TRANSFER_IN_PLAN_PERMISSION && item.moduleType === HR_TRANSFER_IN_PLAN_MODULE_TYPE && item.httpInstance === 'platform' && !item.write)).toBe(true)
  })

  it('复现列表页的组织树、当前年份和status=2请求，不误用招聘计划通用列表参数', async () => {
    const f = fixture([tree, page])
    await expect(f.api.organizationTree()).resolves.toEqual(tree)
    await expect(f.api.overview()).resolves.toEqual(page)
    expect(f.calls).toEqual([
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
      { url: '/hr/recruitment-plan/page', method: 'get', params: { pageNo: 1, pageSize: 1000, status: 2, planYear: String(new Date().getFullYear()) } },
    ])
  })

  it('复现详情页的组织/年份筛选、岗位任职要求和Portal字段原样', async () => {
    const post = { id: '31', gender: 2, educationalRequirement: '本科', experienceRequirement: '三年', abilityRequirement: '沟通', postTypeName: '研发' }
    const f = fixture([page, post, null])
    await expect(f.api.detail({ organizationId: '9007199254740993', planYear: '2027' })).resolves.toEqual(page)
    await expect(f.api.postRequirement({ postId: '31' })).resolves.toEqual(post)
    await expect(f.api.postRequirement()).resolves.toEqual({})
    expect(f.calls).toEqual([
      { url: '/hr/recruitment-plan/page', method: 'get', params: { pageNo: 1, pageSize: 1000, status: 2, organizationId: '9007199254740993', planYear: '2027' } },
      { url: '/org/hrpost/31', method: 'get' },
    ])
    expect(post).not.toHaveProperty('educationRequirement')
  })

  it('复现null年份、0详情路由和缺少简历ID时不跳转的边界', async () => {
    const f = fixture([{ list: [], total: 0 }])
    await expect(f.api.detail({ organizationId: null, planYear: null })).resolves.toEqual({ list: [], total: 0 })
    expect(f.calls).toEqual([{ url: '/hr/recruitment-plan/page', method: 'get', params: { pageNo: 1, pageSize: 1000, status: 2, organizationId: null, planYear: null } }])
    expect(f.api.prepareDetail()).toEqual({ path: '/dashboard/org/transfer-in-plan/detail/0' })
    expect(f.api.prepareDetail({ id: '22' })).toEqual({ path: '/dashboard/org/transfer-in-plan/detail/22' })
    expect(f.api.prepareResume()).toBeNull()
    expect(f.api.prepareResume({ id: '9007199254740993' })).toEqual({ path: '/dashboard/staff/recruitment-plan/resume/9007199254740993' })
    expect(() => f.api.prepareDetail({ id: 0 as never })).not.toThrow()
    await expect(f.api.detail({ planYear: '27' })).rejects.toThrow('planYear')
    expect(f.calls).toHaveLength(1)
  })

  it('AI契约、门面方法和反证完整闭合，并保留岗位DTO字段差异', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: hrTransferInPlanCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(HR_TRANSFER_IN_PLAN_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(HR_TRANSFER_IN_PLAN_METHODS).map(method => `hrTransferInPlan.${method}`))
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['hr-transfer-in-plan-detail']?.inputs.planYear?.meaning).toContain('YYYY')
    expect(contracts['hr-transfer-in-plan-post-requirement']?.output.fields.some(item => item.path === 'educationalRequirement')).toBe(true)
    expect(contracts['hr-transfer-in-plan-post-requirement']?.output.fields.some(item => item.path === 'educationRequirement')).toBe(false)
    const broken = structuredClone(contracts)
    broken['hr-transfer-in-plan-detail']!.output.fields[0]!.meaning = ''
    expect(validateAiContracts(broken, { definitions: hrTransferInPlanCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
