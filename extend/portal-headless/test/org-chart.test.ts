import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createHrOrganizationChartCapability,
  HR_ORGANIZATION_CHART_METHODS,
  HR_ORGANIZATION_CHART_MODULE_TYPE,
  HR_ORGANIZATION_CHART_PAGE_PATH,
  HR_ORGANIZATION_CHART_PERMISSION,
  hrOrganizationChartCapabilities,
} from '../src/capabilities/org-chart.js'
import {
  HR_ORGANIZATION_CHART_AI_CONTRACTS as contracts,
  HR_ORGANIZATION_CHART_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-org-chart.js'
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
  return { api: createHrOrganizationChartCapability(request), calls }
}

const tree = [
  {
    id: '100',
    pid: 0,
    name: '总部',
    code: 'HQ',
    director: '张三',
    status: 1,
    children: [
      { id: '102', pid: '100', name: '研发', code: 'RD', director: null, children: [] },
      { id: '101', pid: '100', name: '财务', code: 'FN', children: [] },
    ],
  },
]

describe('Portal 人力 → 组织管理 → 组织架构页面能力', () => {
  it('逐页核对菜单、页面动作、权限上下文和Java树接口', () => {
    const portal = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const java = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(portal, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(portal, 'app/portal/views/dashboard/hr/org/org-setting/chart.vue'), 'utf8')
    const chart = readFileSync(join(portal, 'app/portal/views/dashboard/hr/org/org-setting/components/chart-tree-mind/index.vue'), 'utf8')
    const controller = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/controller/HrOrganizationController.java'), 'utf8')
    const service = readFileSync(join(java, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/organization/org/service/impl/HrOrganizationServiceImpl.java'), 'utf8')
    const dto = readFileSync(join(java, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/organization/dto/HrOrganizationDTO.java'), 'utf8')

    expect(menu).toContain(`path: '${HR_ORGANIZATION_CHART_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${HR_ORGANIZATION_CHART_PERMISSION}'`)
    expect(page).toContain("http.get('/org/organization/getRoleEnableOrganizationTree')")
    expect(page).toContain('key="vertical"')
    expect(page).toContain('key="horizontal"')
    expect(page).toContain('key="text"')
    expect(page).toContain("router.push(`/dashboard/org/org-setting/edit/${id}`)")
    expect(chart).toContain("ondblclick=\"window.MIND_TREE_DBLCLICK('${item.id}')\"")
    expect(controller).toContain('@RequestMapping("/org/organization")')
    expect(controller).toContain('@GetMapping("getRoleEnableOrganizationTree")')
    expect(controller).toContain('TreeUtils.build')
    expect(service).toContain('getRoleEnableOrganizationTree()')
    expect(service).toContain('user.getSuperAdmin() == 1 || user.getTenantAdmin() == 1')
    expect(service).toContain('getOrgIdListByModuleType()')
    expect(service).toContain('getResponsibleOrgListByUserId(userId)')
    expect(service).toContain('.in("id", organizationIdList)')
    expect(service).toContain('.eq("is_del", 0)')
    expect(service).toContain('.eq("status", 1)')
    expect(service).toContain('.eq("is_virtual", 0)')
    expect(dto).toContain('private Long id')
    expect(dto).toContain('private Long pid')
    expect(dto).toContain('private String name')
    expect(dto).toContain('private String director')
    expect(dto).toContain('private String code')
    expect(hrOrganizationChartCapabilities.every(item => item.pagePath === HR_ORGANIZATION_CHART_PAGE_PATH && item.permission === HR_ORGANIZATION_CHART_PERMISSION && item.moduleType === HR_ORGANIZATION_CHART_MODULE_TYPE && item.httpInstance === 'platform' && !item.write)).toBe(true)
  })

  it('读取角色/负责人范围内的启用组织树，不伪造全量组织', async () => {
    const f = fixture([tree])
    await expect(f.api.tree()).resolves.toEqual(tree.map(root => ({ ...root, children: [...root.children] })))
    expect(f.calls).toEqual([{ url: '/org/organization/getRoleEnableOrganizationTree', method: 'get' }])
  })

  it('复现纯文字导出排序、字段和文件回执', () => {
    const f = fixture()
    const file = f.api.exportText({ root: tree[0]! })
    const content = Buffer.from(file.base64, 'base64').toString('utf8')
    expect(file).toMatchObject({ contentType: 'text/plain;charset=utf-8', byteLength: Buffer.byteLength(content) })
    expect(file.fileName).toMatch(/^组织架构树_总部_\d{8}_\d{4}\.txt$/)
    expect(content).toContain('组织架构树')
    expect(content.indexOf('研发')).toBeLessThan(content.indexOf('财务'))
    expect(content).toContain('负责人: 张三')
    expect(content).toContain('总节点数: 3')
    expect(content).toContain('最大层级: 2')
    expect(f.calls).toHaveLength(0)
  })

  it('复现Draw.io纵横向菜单和节点连线，双击只准备编辑路由', () => {
    const f = fixture()
    const vertical = f.api.exportDrawIo({ root: tree[0]!, direction: 'vertical' })
    const horizontal = f.api.exportDrawIo({ root: tree[0]!, direction: 'horizontal' })
    const verticalXml = Buffer.from(vertical.base64, 'base64').toString('utf8')
    const horizontalXml = Buffer.from(horizontal.base64, 'base64').toString('utf8')
    expect(vertical.fileName).toContain('纵向_标准(3节点)')
    expect(horizontal.fileName).toContain('横向_标准(3节点)')
    expect(vertical.contentType).toBe('application/xml;charset=utf-8')
    expect(verticalXml).toContain('<mxfile')
    expect(verticalXml).toContain('value="总部')
    expect(verticalXml).toContain('source="node_1" target="node_2"')
    expect(horizontalXml).toContain('entryX=0;entryY=0.5')
    expect(verticalXml).not.toBe(horizontalXml)
    expect(f.api.prepareEdit({ id: '101' })).toEqual({ path: '/dashboard/org/org-setting/edit/101' })
    expect(f.calls).toHaveLength(0)
  })

  it('非法树、根节点、ID和方向在请求或本地导出前失败', async () => {
    await expect(fixture([null]).api.tree()).rejects.toThrow('必须是数组')
    await expect(fixture([[{ id: 0, name: '坏' }]]).api.tree()).rejects.toThrow('id')
    const f = fixture()
    expect(() => f.api.exportText({ root: { id: 0 } as never })).toThrow('id')
    expect(() => f.api.exportDrawIo({ root: tree[0]!, direction: 'diagonal' as never })).toThrow('direction')
    expect(() => f.api.prepareEdit({ id: 0 })).toThrow('id')
    expect(f.calls).toHaveLength(0)
  })

  it('AI契约完整登记、公开方法映射，并用反证锁定权限与导出语义', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (value: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts, { definitions: hrOrganizationChartCapabilities, contracts })).toEqual([])
    expect(Object.keys(contracts)).toEqual(Object.keys(HR_ORGANIZATION_CHART_METHODS))
    expect(Object.keys(methodContracts)).toEqual(Object.values(HR_ORGANIZATION_CHART_METHODS).map(method => `hrOrganizationChart.${method}`))
    expect(Object.keys(AI_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(contracts)))
    expect(Object.keys(METHOD_CONTRACTS)).toEqual(expect.arrayContaining(Object.keys(methodContracts)))
    expect(contracts['hr-organization-chart-tree']?.output.fields.some(item => item.path === '[].children[].id')).toBe(true)
    expect(contracts['hr-organization-chart-export-drawio']?.inputs.direction?.options).toEqual([
      { value: 'vertical', label: 'Draw.io纵向' },
      { value: 'horizontal', label: 'Draw.io横向' },
    ])
    const broken = structuredClone(contracts)
    broken['hr-organization-chart-tree']!.output.fields[0]!.meaning = ''
    expect(validateAiContracts(broken, { definitions: hrOrganizationChartCapabilities, contracts: broken }).length).toBeGreaterThan(0)
  })
})
