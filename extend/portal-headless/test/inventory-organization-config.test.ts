import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import {
  createInventoryOrganizationConfigCapability,
  INVENTORY_ORGANIZATION_CONFIG_METHODS,
  INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH,
  inventoryOrganizationConfigCapabilities,
} from '../src/capabilities/inventory-organization-config.js'
import { INVENTORY_ORGANIZATION_CONFIG_AI_CONTRACTS as contracts, INVENTORY_ORGANIZATION_CONFIG_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-inventory-organization-config.js'

type RequestConfig = Parameters<PortalRequest>[0]
function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryOrganizationConfigCapability(request), calls }
}

const row = { id: 7, orgId: 8, orgCode: 'A01', orgName: '总部', creator: 9, creatorName: '管理员', createTime: '2026-09-23 10:00:00' }

describe('资产编码页面能力', () => {
  it('静态锁定页面候选、批量表单、删除权限和Java字段', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = readFileSync(join(root, 'app/portal/menus/material.js'), 'utf8')
    const page = readFileSync(join(root, 'app/portal/views/dashboard/material/assets/code-setting/list.vue'), 'utf8')
    const modal = readFileSync(join(root, 'app/portal/views/dashboard/material/assets/code-setting/components/create-code.vue'), 'utf8')
    const corporation = readFileSync(join(root, 'app/portal/components/portal/material/select/corporation/index.vue'), 'utf8')
    const controller = readFileSync(join(javaRoot, 'erp-module-inventory/erp-module-inventory-biz/src/main/java/com/wdbc/erp/module/inventory/controller/admin/organizationconfig/OrganizationConfigController.java'), 'utf8')
    expect(menu).toContain(`path: '${INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH}'`)
    expect(page).toContain("getDataListURL: '/admin-api/inventory/organization-config/page'")
    expect(page).toContain("/admin-api/inventory/organization-config/delete")
    expect(modal).toContain("/admin-api/inventory/organization-config/create")
    expect(modal).toContain('orgCode')
    expect(corporation).toContain('isCorporation')
    expect(controller).toContain('@RequestMapping("/inventory/organization-config")')
    expect(controller).toContain('@PostMapping("/create")')
    expect(controller).toContain('@DeleteMapping("/delete")')
    expect(inventoryOrganizationConfigCapabilities.every(item => item.pagePath === INVENTORY_ORGANIZATION_CONFIG_PAGE_PATH && item.permission === '/dashboard/material/assets/code-setting' && item.moduleType === 31 && item.httpInstance === 'platform')).toBe(true)
  })

  it('列表和法人候选请求保留Portal参数', async () => {
    const f = fixture([{ list: [row], total: 1 }, [{ id: 8, name: '总部' }]])
    await expect(f.api.list({ orgId: 8, pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.corporations()).resolves.toEqual([{ id: 8, name: '总部' }])
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/organization-config/page', method: 'get', params: { order: '', orderField: '', orgId: 8, pageNo: 2, pageSize: 50 } },
      { url: '/admin-api/system/dept/list-all-simple', method: 'get', params: { pageNo: -1, pageSize: -1, isCorporation: 1 } },
    ])
  })

  it('创建按弹窗顺序提交数组，删除使用query id', async () => {
    const rows = [{ orgCode: 'A01', orgId: 8 }, { orgCode: 'B2', orgId: '9' }]
    const f = fixture([undefined, undefined])
    expect(f.api.prepareCreate({ rows })).toEqual({ rows })
    await f.api.create({ rows })
    await f.api.remove({ id: 7 })
    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/organization-config/create', method: 'post', data: rows },
      { url: '/admin-api/inventory/organization-config/delete', method: 'delete', params: { id: 7 } },
    ])
  })

  it('空批量、超长编码和坏响应会失败', async () => {
    expect(() => fixture().api.prepareCreate({ rows: [] })).toThrow('至少包含一行')
    expect(() => fixture().api.prepareCreate({ rows: [{ orgCode: '12345', orgId: 8 }] })).toThrow('最多4个字符')
    expect(() => fixture().api.prepareCreate({ rows: [{ orgCode: 'A01', orgId: 0 }] })).toThrow('安全正整数')
    await expect(fixture([{ list: null, total: 0 }]).api.list()).rejects.toThrow('list或total')
    await expect(fixture([null]).api.corporations()).rejects.toThrow('必须是数组')
  })

  it('AI契约逐能力登记并锁定批量创建取消语义', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_ORGANIZATION_CONFIG_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INVENTORY_ORGANIZATION_CONFIG_METHODS).map(method => `inventoryOrganizationConfig.${method}`))])
    expect(contracts['inventory-organization-config-create']?.steps[0]?.mapping).toEqual({})
    expect(contracts['inventory-organization-config-prepare-create']?.steps.some(step => step.role === 'cancel')).toBe(true)
  })
})
