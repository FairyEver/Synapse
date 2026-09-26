import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createManageCostCenterCapability,
  MANAGE_COST_CENTER_METHODS,
  MANAGE_COST_CENTER_PAGE_PATH,
  manageCostCenterCapabilities,
} from '../src/capabilities/manage-cost-center.js'
import { MANAGE_COST_CENTER_AI_CONTRACTS as contracts, MANAGE_COST_CENTER_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-manage-cost-center.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createManageCostCenterCapability(request), calls }
}

const row = { id: 1, name: '张三', staffCode: 1001, idCard: 'x', insuranceCost: '社保/中心', fundCost: '公积金/中心', salaryCost: '薪资/中心', fullPath: '总部/财务' }

describe('成本中心汇总页面能力', () => {
  it('静态锁定菜单、查询字段、导出、维护路由、权限和Java字段', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/hr.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/hr/manage/cost-center/list.vue'), 'utf8')
    const organizationSelect = readFileSync(join(root, 'app/portal/components/portal/hxr/tree-select/all-org/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryCostCenterController.java'), 'utf8')
    const dto = readFileSync(join(javaRoot, 'erp-module-hr/erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/CostCenterPageDTO.java'), 'utf8')
    expect(menu).toContain(`path: '${MANAGE_COST_CENTER_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/salary/costcenter/page'")
    expect(page).toContain('exportURL:')
    expect(page).toContain('/admin-api/salary/costcenter/export')
    expect(page).toContain("router.push('./maintenance/list')")
    expect(page).toContain('portal-hxr-tree-select-all-org')
    expect(organizationSelect).toContain('getRoleOrganizationTree')
    expect(controller).toContain('@RequestMapping("/salary/costcenter")')
    expect(controller).toContain('@GetMapping("export")')
    expect(dto).toContain('private String name')
    expect(dto).toContain('private String fullPath')
    expect(manageCostCenterCapabilities.every(item => item.pagePath === MANAGE_COST_CENTER_PAGE_PATH && item.permission === '/dashboard/manage/cost-center' && item.moduleType === 14 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表请求发送通用列表排序和分页字段，导出只发送表单字段', async () => {
    const response = { data: new Uint8Array([1, 2]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="cost.xlsx"' } }
    const f = fixture([{ list: [row], total: 1 }, response])
    await expect(f.api.list({ name: '张', insuranceCost: '社保', organization: 9, pageNo: 2, pageSize: 50 })).resolves.toMatchObject({ total: 1, list: [{ name: '张三', fullPath: '总部/财务' }] })
    expect(f.calls[0]).toEqual({
      url: '/salary/costcenter/page', method: 'get',
      params: { order: '', orderField: '', name: '张', insuranceCost: '社保', fundCost: '', salaryCost: '', organization: 9, pageNo: 2, pageSize: 50 },
    })
    await expect(f.api.export({ name: '张', organization: 9 })).resolves.toMatchObject({ fileName: 'cost.xlsx', byteLength: 2 })
    expect(f.calls[1]).toEqual({
      url: '/salary/costcenter/export', method: 'get',
      params: { name: '张', insuranceCost: '', fundCost: '', salaryCost: '', organization: 9 }, responseType: 'arraybuffer',
    })
  })

  it('组织树和维护按钮保持页面语义', async () => {
    const tree = [{ id: 1, name: '总部', children: [] }]
    const f = fixture([tree])
    await expect(f.api.organizationTree()).resolves.toEqual(tree)
    expect(f.api.maintenance()).toEqual({ path: './maintenance/list' })
    expect(f.calls[0]).toEqual({ url: '/org/organization/getRoleOrganizationTree', method: 'get' })
  })

  it('坏分页、坏组织树、坏ID和空文件不会静默成功', async () => {
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([{ list: [{ ...row, id: 0 }], total: 1 }]).api.list()).rejects.toThrow('id')
    await expect(fixture([[{ id: 0, name: '坏' }]]).api.organizationTree()).rejects.toThrow('id')
    await expect(fixture().api.list({ organization: 0 })).rejects.toThrow('organization')
    await expect(fixture([{ data: new ArrayBuffer(0), headers: {} }]).api.export()).rejects.toThrow('空文件')
  })

  it('AI契约完整登记并锁定本页不伪造维护CRUD', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(MANAGE_COST_CENTER_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(MANAGE_COST_CENTER_METHODS).map(method => `manageCostCenter.${method}`))])
    expect(contracts['manage-cost-center-list']?.output.fields.some(item => item.path === 'list[].fullPath')).toBe(true)
    expect(contracts['manage-cost-center-maintenance']?.boundaries.join('\n')).toContain('不在本能力中伪造维护CRUD')
  })
})
