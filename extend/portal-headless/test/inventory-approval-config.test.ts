import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  INVENTORY_APPROVAL_CONFIG_METHODS,
  INVENTORY_APPROVAL_CONFIG_MODULE_TYPE,
  INVENTORY_APPROVAL_CONFIG_PAGE_PATH,
  INVENTORY_APPROVAL_CONFIG_PERMISSION,
  createInventoryApprovalConfigCapability,
  inventoryApprovalConfigCapabilities,
} from '../src/capabilities/inventory-approval-config.js'
import { INVENTORY_APPROVAL_CONFIG_AI_CONTRACTS as contracts, INVENTORY_APPROVAL_CONFIG_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-inventory-approval-config.js'
import { CAPABILITY_BINDINGS } from '../src/capabilities/invoke.js'
import { resolveModuleType } from '../src/context/module-type.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createInventoryApprovalConfigCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const tree = [{
  name: '物料入库',
  unitId: 101,
  unitName: '一单元',
  children: [{ id: 301, name: '采购入库', isRequiresApproval: true, createTime: '2026-09-24 09:00:00' }],
}]
const typeOptions = [{ label: '采购入库', value: 'inventory_inbound_type-1' }]

describe('Portal 物料 → 审批配置页面能力', () => {
  it('逐页锁定菜单、列表树、候选弹窗、行内开关和权限上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/material.js')
    const page = read(root, 'app/portal/views/dashboard/material/approval-configuration/list.vue')
    const create = read(root, 'app/portal/views/dashboard/material/approval-configuration/components/create-configuration.vue')

    expect(menu).toContain(`path: '${INVENTORY_APPROVAL_CONFIG_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${INVENTORY_APPROVAL_CONFIG_PERMISSION}'`)
    for (const fragment of [
      "http('/admin-api/inventory/approval-config/list', { params: form })",
      'mapTree(result',
      'id8()',
      'unitIdList.value',
      "http.put('/admin-api/inventory/approval-config/update'",
      'record.id',
      'isRequiresApproval',
      'actionCreate',
    ]) expect(page).toContain(fragment)
    for (const fragment of [
      "useAsyncState(http('/admin-api/inventory/stock/typeList'), [])",
      'typeIds',
      'subtypeName',
      'isRequiresApproval: item.isRequiresApproval === 1',
      "http.post('/admin-api/inventory/approval-config/batch-create', temp)",
      'formRef.value.validate()',
      'modalEmit(\'cancel\')',
    ]) expect(create).toContain(fragment)

    expect(resolveModuleType(INVENTORY_APPROVAL_CONFIG_PAGE_PATH).moduleType).toBe(INVENTORY_APPROVAL_CONFIG_MODULE_TYPE)
    expect(inventoryApprovalConfigCapabilities).toHaveLength(Object.keys(INVENTORY_APPROVAL_CONFIG_METHODS).length)
    expect(inventoryApprovalConfigCapabilities.every(item => item.pagePath === INVENTORY_APPROVAL_CONFIG_PAGE_PATH && item.permission === INVENTORY_APPROVAL_CONFIG_PERMISSION && item.moduleType === null && item.httpInstance === 'platform')).toBe(true)
    const bindingIds = new Set(CAPABILITY_BINDINGS.map(binding => binding.capabilityId))
    for (const id of Object.keys(INVENTORY_APPROVAL_CONFIG_METHODS)) expect(bindingIds).toContain(id)
  })

  it('逐页锁定 Java Controller、VO、Service、Mapper 和权限/组织范围规则', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const base = join(root, 'erp-module-inventory/erp-module-inventory-biz/src/main')
    const controller = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/approvalconfig/ApprovalConfigController.java')
    const pageReq = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/approvalconfig/vo/ApprovalConfigPageReqVO.java')
    const saveReq = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/approvalconfig/vo/ApprovalConfigSaveReqVO.java')
    const typeReq = read(base, 'java/com/wdbc/erp/module/inventory/controller/admin/approvalconfig/vo/ApprovalConfigTypeSaveReqVO.java')
    const service = read(base, 'java/com/wdbc/erp/module/inventory/service/approvalconfig/ApprovalConfigServiceImpl.java')
    const mapper = read(root, 'erp-module-inventory/erp-module-inventory-biz/src/main/resources/mapper/approvalconfig/ApprovalConfigMapper.xml')

    for (const fragment of [
      '@RequestMapping("/inventory/approval-config")',
      '@PostMapping("/batch-create")',
      '@PutMapping("/update")',
      '@GetMapping("/list")',
      '@GetMapping("/get")',
      '@PreAuthorize("@ss.hasPermission(\'/dashboard/material/approval-configuration\')")',
    ]) expect(controller).toContain(fragment)
    for (const fragment of ['private String type', 'private String subtype', 'private Boolean isRequiresApproval', 'private Long orgId']) expect(`${pageReq}\n${saveReq}\n${typeReq}`).toContain(fragment)
    for (const fragment of ['batchCreateApprovalConfig', 'validateApprovalConfigExists', '配置类型已存在,请检查重试', 'buildApprovalConfigTree', 'isRequiresApproval']) expect(service).toContain(fragment)
    for (const fragment of ['deleted = 0', 'reqVO.orgId != null', 'hr_organization_relation', 'ORDER BY iac.create_time DESC']) expect(mapper).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖树列表、候选、批量创建和审批开关', async () => {
    const f = fixture([tree, typeOptions, true, true])
    await expect(f.api.list({ orgId: 101 })).resolves.toMatchObject({
      0: { unitId: 101, unitName: '一单元', children: [{ id: 301, unitId: 101, unitName: '一单元' }] },
    })
    await expect(f.api.typeList()).resolves.toEqual(typeOptions)
    const created = f.api.prepareCreate({ rows: [{ unitId: 101, typeIds: ['inventory_inbound_type-1'], isRequiresApproval: 1 }], typeOptions })
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(true)
    const changed = f.api.prepareSetApproval({ id: 301, isRequiresApproval: false })
    await expect(f.api.setApproval({ draft: changed.draft })).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/admin-api/inventory/approval-config/list', method: 'get', params: { order: '', orderField: '', orgId: 101 } },
      { url: '/admin-api/inventory/stock/typeList', method: 'get' },
      { url: '/admin-api/inventory/approval-config/batch-create', method: 'post', data: [{ unitId: 101, typeList: [{ type: 'inventory_inbound_type', subtype: '1', subtypeName: '采购入库' }], isRequiresApproval: true }] },
      { url: '/admin-api/inventory/approval-config/update', method: 'put', data: { id: 301, isRequiresApproval: false } },
    ])
  })

  it('反证组织筛选、type-subtype、审批枚举和坏响应不能静默通过', async () => {
    const f = fixture([])
    await expect(f.api.list({ orgId: 0 })).rejects.toThrow()
    expect(() => f.api.prepareCreate({ rows: [{ unitId: 101, typeIds: ['bad'], isRequiresApproval: 1 }], typeOptions })).toThrow()
    expect(() => f.api.prepareCreate({ rows: [{ unitId: 101, typeIds: ['inventory_inbound_type-1'], isRequiresApproval: 2 as never }], typeOptions })).toThrow()
    expect(() => f.api.prepareSetApproval({ id: 0, isRequiresApproval: true })).toThrow()
    await expect(fixture([null]).api.list()).rejects.toThrow('必须是数组')
    await expect(fixture([null]).api.typeList()).rejects.toThrow('必须是数组')
    await expect(fixture([tree, typeOptions, false]).api.create({ draft: [{ unitId: 101, typeList: [{ type: 'inventory_inbound_type', subtype: '1', subtypeName: '采购入库' }], isRequiresApproval: true }] })).rejects.toThrow('不是true')
  })

  it('AI 契约逐能力登记，并明确 module-type 不可推导和写入回查', () => {
    expect(Object.keys(contracts)).toEqual(Object.keys(INVENTORY_APPROVAL_CONFIG_METHODS))
    expect(Object.keys(methodContracts)).toEqual([...new Set(Object.values(INVENTORY_APPROVAL_CONFIG_METHODS).map(method => `inventoryApprovalConfig.${method}`))])
    expect(contracts['inventory-approval-config-list']?.boundaries.join('\n')).toContain('不发送module-type')
    expect(contracts['inventory-approval-config-create']?.steps[0]?.capabilityId).toBe('inventory-approval-config-list')
    expect(contracts['inventory-approval-config-set-approval']?.steps[0]?.capabilityId).toBe('inventory-approval-config-list')
  })
})
