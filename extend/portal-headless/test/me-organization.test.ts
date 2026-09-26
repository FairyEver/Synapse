import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  ME_ORGANIZATION_METHODS,
  ME_ORGANIZATION_MODULE_TYPE,
  ME_ORGANIZATION_PAGE_PATH,
  ME_ORGANIZATION_PERMISSION,
  createMeOrganizationCapability,
  meOrganizationCapabilities,
} from '../src/capabilities/me-organization.js'
import {
  ME_ORGANIZATION_AI_CONTRACTS as contracts,
  ME_ORGANIZATION_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-me-organization.js'
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
  return { api: createMeOrganizationCapability(request), calls }
}

const chart = [{ title: '员工人数', unit: '人数', lineData: [{ mark: '总人数', points: [{ x: '9月', y: 1 }] }] }]

describe('Portal 人力 → 组织信息页面能力', () => {
  it('逐页核对入口、负责人分支、统计控件和权限上下文', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portal, 'app/portal/menus/hr.js')
    const entry = read(portal, 'app/portal/views/dashboard/hr/me/organization/list.vue')
    const director = read(portal, 'app/portal/views/dashboard/hr/me/organization/director.vue')
    const directorNot = read(portal, 'app/portal/views/dashboard/hr/me/organization/directorNot.vue')
    const tree = read(portal, 'app/portal/components/portal/hxr/tree-select/role-organization-tree/index.vue')
    const duty = read(portal, 'app/portal/components/portal/hxr/select/duty/index.vue')

    expect(menu).toContain(`path: '${ME_ORGANIZATION_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${ME_ORGANIZATION_PERMISSION}'`)
    expect(entry).toContain("http('/admin-api/org/organization/getAllDirectOrgList')")
    expect(entry).toContain('<Director v-if="isDirector" />')
    expect(entry).toContain('<directorNot v-else />')
    expect(director + directorNot).toContain("http('/admin-api/org/staff/getStaffBaseInfo')")
    for (const fragment of [
      'portal-hxr-tree-select-role-organization-tree',
      'getDirectOrgPostNumber?orgId=${e}',
      'getDirectOrgStaff?date=${e}&orgId=${orgOptions.value}',
      'getDirectOrgInfoV2?orgId=${orgId}&dutyId=${dutyId}&standardUnit=${standardUnit}',
      'type="standard_cell"',
      'portal-hxr-select-duty',
      'picker="month"',
      'value-format="YYYY-MM-DD"',
    ]) expect(director).toContain(fragment)
    expect(tree).toContain("url: { type: String, default: '/org/organization/getRoleOrganizationTree' }")
    expect(duty).toContain("http('/org/hrduty/all')")
    expect(duty).toContain('item.dutyName')
    expect(meOrganizationCapabilities.map(item => item.id)).toEqual(Object.keys(ME_ORGANIZATION_METHODS))
    expect(meOrganizationCapabilities.every(item => item.pagePath === ME_ORGANIZATION_PAGE_PATH && item.permission === ME_ORGANIZATION_PERMISSION && item.moduleType === ME_ORGANIZATION_MODULE_TYPE && item.httpInstance === 'platform' && !item.write)).toBe(true)
  })

  it('逐页核对Java接口、DTO和数据范围，排除未被页面调用的写接口', () => {
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const orgController = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/controller/HrOrganizationController.java')
    const staffController = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrStaffController.java')
    const orgService = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/service/impl/HrOrganizationServiceImpl.java')
    const dutyController = read(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/staff/controller/HrDutyController.java')
    const dutyDto = read(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrDutyDTO.java')
    const staffDto = read(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/staff/dto/HrStaffBaseDTO.java')
    const orgDto = read(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java')
    const chartData = read(java, 'erp-framework/erp-common/src/main/java/com/wdbc/erp/framework/common/chart/ChartData.java')
    const lineData = read(java, 'erp-framework/erp-common/src/main/java/com/wdbc/erp/framework/common/chart/LineData.java')
    const point = read(java, 'erp-framework/erp-common/src/main/java/com/wdbc/erp/framework/common/chart/Point.java')

    for (const fragment of [
      '@RequestMapping("/org/organization")',
      '@GetMapping("getAllDirectOrgList")',
      '@GetMapping("getDirectOrgStaff")',
      '@GetMapping("getDirectOrgPostNumber")',
      '@GetMapping("getDirectOrgInfoV2")',
      'Long orgId',
      'LocalDate date',
      'String standardUnit',
      'Integer dutyId',
    ]) expect(orgController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/org/staff")', '@GetMapping("getStaffBaseInfo")', 'HrStaffBaseDTO']) expect(staffController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/org/hrduty")', '@GetMapping("all")', 'params.put(Constant.LIMIT, "-1")']) expect(dutyController).toContain(fragment)
    for (const fragment of ['getAllDirectOrgList(HttpServletRequest request)', 'getCurrentUserDirectorOrganizationIds', 'getRoleOrganizationTreeByWeb', 'getDirectOrgInfoV2(Long orgId']) expect(orgService).toContain(fragment)
    for (const fragment of ['private String name', 'private Long staffCode', 'private Long organization', 'private String organizationName', 'private List<KeyValue<String, String>> baseInfo']) expect(staffDto).toContain(fragment)
    for (const fragment of ['private Long id', 'private String dutyName', 'private String dutyLevelId', 'private Integer isDel']) expect(dutyDto).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long pid', 'private String name', 'private String code', 'private List<HrOrganizationPostDTO> jobList']) expect(orgDto).toContain(fragment)
    for (const fragment of ['private String title', 'private String unit', 'private List<LineData> lineData']) expect(chartData).toContain(fragment)
    for (const fragment of ['private String mark', 'private List<Point> points']) expect(lineData).toContain(fragment)
    for (const fragment of ['private String x', 'private Double y', 'private String z']) expect(point).toContain(fragment)
    expect(Object.keys(ME_ORGANIZATION_METHODS)).not.toContain('me-organization-create')
    expect(Object.keys(ME_ORGANIZATION_METHODS)).not.toContain('me-organization-update')
  })

  it('保留Portal实际请求路径、module-type下的默认参数和返回结构', async () => {
    const staffInfo = { name: '张三', staffCode: '1001', organization: 34, organizationName: '总部', baseInfo: [] }
    const f = fixture([[], staffInfo, [], [{ id: '7', dutyName: '研发负责人' }], chart, chart, chart])
    await expect(f.api.listDirectOrganizations()).resolves.toEqual([])
    await expect(f.api.getStaffBaseInfo()).resolves.toEqual(staffInfo)
    await expect(f.api.organizationTree()).resolves.toEqual([])
    await expect(f.api.dutyOptions()).resolves.toEqual([{ id: '7', dutyName: '研发负责人' }])
    await expect(f.api.getEstablishmentChart({ orgId: '34' })).resolves.toEqual(chart)
    await expect(f.api.getEmployeeStatistics({ orgId: 34, date: '2026-09-01' })).resolves.toEqual(chart)
    await expect(f.api.getOrganizationStatistics({ orgId: 34 })).resolves.toEqual(chart)
    expect(f.calls).toEqual([
      { url: '/org/organization/getAllDirectOrgList', method: 'get' },
      { url: '/org/staff/getStaffBaseInfo', method: 'get' },
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
      { url: '/org/hrduty/all', method: 'get' },
      { url: '/org/organization/getDirectOrgPostNumber', method: 'get', params: { orgId: '34' } },
      { url: '/org/organization/getDirectOrgStaff', method: 'get', params: { date: '2026-09-01', orgId: 34 } },
      { url: '/org/organization/getDirectOrgInfoV2', method: 'get', params: { orgId: 34, dutyId: '', standardUnit: '' } },
    ])
  })

  it('保留标准单元、职务和日期的实际筛选值，不把空值改成错误默认值', async () => {
    const f = fixture([chart, chart])
    await f.api.getEmployeeStatistics({ orgId: '34', date: '2026-02-28' })
    await f.api.getOrganizationStatistics({ orgId: '34', standardUnit: '研发单元', dutyId: '7' })
    expect(f.calls[0]?.params).toEqual({ date: '2026-02-28', orgId: '34' })
    expect(f.calls[1]?.params).toEqual({ orgId: '34', dutyId: '7', standardUnit: '研发单元' })
  })

  it('非法组织ID、日期、职务和统计返回在请求前失败', async () => {
    const f = fixture()
    await expect(f.api.getEstablishmentChart({ orgId: 0 })).rejects.toThrow('正整数ID')
    await expect(f.api.getEmployeeStatistics({ orgId: 34, date: '2026-02-30' })).rejects.toThrow('有效日期')
    await expect(f.api.getOrganizationStatistics({ orgId: 34, dutyId: 0 })).rejects.toThrow('正整数ID')
    await expect(f.api.getOrganizationStatistics({ orgId: 34, standardUnit: 1 as never })).rejects.toThrow('字符串')
    expect(f.calls).toHaveLength(0)
    const badStaff = fixture([null])
    await expect(badStaff.api.getStaffBaseInfo()).rejects.toThrow('响应必须是对象')
    const badChart = fixture([{}])
    await expect(badChart.api.getEstablishmentChart({ orgId: 34 })).rejects.toThrow('响应必须是数组')
  })

  it('AI契约逐方法登记，并用反证锁定组织ID和图表字段', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: meOrganizationCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(ME_ORGANIZATION_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(ME_ORGANIZATION_METHODS).map(method => `meOrganization.${method}`))
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['me-organization-staff-base-info']?.output.fields.some(item => item.path === 'organization')).toBe(true)
    expect(contracts['me-organization-organization-statistics']?.output.fields.some(item => item.path === '[].lineData[].points[].y')).toBe(true)
    const broken = structuredClone(contracts)
    broken['me-organization-staff-base-info']!.output.fields = broken['me-organization-staff-base-info']!.output.fields.filter(item => item.path !== 'organization')
    expect(validateAiContracts(broken, { definitions: meOrganizationCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
