import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSupplyPersonnelConfigCapability,
  SUPPLY_PERSONNEL_CONFIG_METHODS,
  SUPPLY_PERSONNEL_CONFIG_MODULE_TYPE,
  SUPPLY_PERSONNEL_CONFIG_PAGE_PATH,
  SUPPLY_PERSONNEL_CONFIG_PERMISSION,
  supplyPersonnelConfigCapabilities,
} from '../src/capabilities/supply-personnel-config.js'
import { SUPPLY_PERSONNEL_CONFIG_AI_CONTRACTS as contracts } from '../src/catalog/contracts-supply-personnel-config.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSupplyPersonnelConfigCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const draft = {
  legalId: '18',
  materielTypeIds: ['11', '12'],
  planUserIds: ['21'],
  purchaseUserIds: ['22'],
}

describe('Portal 供应链设置 → 人员配置页面能力', () => {
  it('逐页锁定菜单、列表、表单、组织树、人员候选和权限', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/supply.js')
    const list = read(root, 'app/portal/views/dashboard/supply/setting/planner/list.vue')
    const form = read(root, 'app/portal/views/dashboard/supply/setting/planner/[mode]/[id].vue')
    for (const fragment of [`path: '${SUPPLY_PERSONNEL_CONFIG_PAGE_PATH}'`, `permission: '${SUPPLY_PERSONNEL_CONFIG_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      "getDataListURL: '/admin-api/supply/legal-user-config/page'", 'getDataListIsPage: true', 'legalId: null', 'name: null',
      'customDelete: async record =>', "http.delete('/admin-api/supply/legal-user-config/delete'", 'record.id', 'legalName', 'materielTypeName', 'planUserName', 'purchaseUserName',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "'/org/organization/getRoleOrganizationTree'", 'item?.isStandardUnit === 1 || item?.isCorporation === 1', 'disabled: !(item?.isStandardUnit === 1 || item?.isCorporation === 1)',
      "'/org/staff/page'", 'pageSize: 500', 'portal-supply-dict-select', "type=\"materiel_type\"", 'name="legalId"', 'name="materielTypeIds"',
      "'/admin-api/supply/legal-user-config/get'", "'/admin-api/supply/legal-user-config/create'", "'/admin-api/supply/legal-user-config/update'", 'materielTypeIds', 'planUserIds', 'purchaseUserIds',
    ]) expect(form).toContain(fragment)
    expect(supplyPersonnelConfigCapabilities.map(item => item.id)).toEqual(Object.keys(SUPPLY_PERSONNEL_CONFIG_METHODS))
    expect(supplyPersonnelConfigCapabilities.every(item => item.pagePath === SUPPLY_PERSONNEL_CONFIG_PAGE_PATH && item.permission === SUPPLY_PERSONNEL_CONFIG_PERMISSION && item.moduleType === SUPPLY_PERSONNEL_CONFIG_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SUPPLY_PERSONNEL_CONFIG_PAGE_PATH).moduleType).toBe(SUPPLY_PERSONNEL_CONFIG_MODULE_TYPE)
  })

  it('逐页锁定 Java Controller、DTO 和服务端业务校验', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(root, 'erp-module-supply/erp-module-supply-biz/src/main/java/com/wdbc/erp/module/supply/controller/admin/legaluser/LegalUserConfigController.java')
    const create = read(root, 'erp-module-supply/erp-module-supply-biz/src/main/java/com/wdbc/erp/module/supply/controller/admin/legaluser/vo/LegalUserConfigCreateReqVO.java')
    const update = read(root, 'erp-module-supply/erp-module-supply-biz/src/main/java/com/wdbc/erp/module/supply/controller/admin/legaluser/vo/LegalUserConfigUpdateReqVO.java')
    const response = read(root, 'erp-module-supply/erp-module-supply-biz/src/main/java/com/wdbc/erp/module/supply/controller/admin/legaluser/vo/LegalUserConfigRespVO.java')
    const service = read(root, 'erp-module-supply/erp-module-supply-biz/src/main/java/com/wdbc/erp/module/supply/service/legaluser/LegalUserConfigServiceImpl.java')
    for (const fragment of ['@RequestMapping("/supply/legal-user-config")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping("/get")']) expect(controller).toContain(fragment)
    for (const fragment of ['private Integer legalId', 'private List<Integer> materielTypeIds', 'private List<Integer> planUserIds', 'private List<Integer> purchaseUserIds']) {
      expect(create).toContain(fragment)
      expect(update).toContain(fragment)
    }
    for (const fragment of ['private Long id', 'private String legalName', 'private String materielTypeName', 'private java.util.List<Integer> materielTypeIds', 'private java.util.List<Integer> planUserIds', 'private java.util.List<Integer> purchaseUserIds']) expect(response).toContain(fragment)
    for (const fragment of ['采购物资类型不能为空', '计划员不能为空', '采购员不能为空', 'validateSelectableOrganization', 'validateNoMaterielTypeOverlap']) expect(service).toContain(fragment)
  })

  it('按 Portal 实际默认参数、ID归一化、组织禁用和候选关键字锁定读取规则', async () => {
    const f = fixture([
      { list: [{ id: '31', legalId: '18', legalName: '法人', materielType: '11,12', planUserId: '21', purchaseUserId: '22', materielTypeName: '饲料,兽药', planUserName: '计划员', purchaseUserName: '采购员' }], total: 1 },
      { id: '31', legalId: 18, materielTypeIds: [11, 12], planUserIds: [21], purchaseUserIds: [22] },
      [{ id: '18', name: '法人组织', pid: null, isStandardUnit: 1, isCorporation: 0, children: [{ id: 19, name: '普通部门', pid: 18, isStandardUnit: 0, isCorporation: 0 }] }],
      { list: [{ id: '21', name: '计划员', staffCode: 1001, status: 1, organization: 18 }], total: 1 },
    ])
    await expect(f.api.list()).resolves.toMatchObject({ total: 1, list: [{ id: '31', materielTypeIds: ['11', '12'], planUserIds: ['21'], purchaseUserIds: ['22'] }] })
    await expect(f.api.get({ id: '31' })).resolves.toMatchObject({ id: '31', legalId: 18, materielTypeIds: [11, 12] })
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: '18', name: '法人组织', pid: null, isStandardUnit: 1, isCorporation: 0, disabled: false, children: [{ id: 19, name: '普通部门', pid: 18, isStandardUnit: 0, isCorporation: 0, disabled: true, children: [] }] }])
    await expect(f.api.staffSearch({ keyword: '  计划员  ', pageSize: 100 })).resolves.toMatchObject({ list: [{ id: '21', label: '计划员(1001)' }], total: 1 })
    expect(f.calls).toEqual([
      { url: '/admin-api/supply/legal-user-config/page', method: 'get', params: { order: '', orderField: '', legalId: null, name: null, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/supply/legal-user-config/get', method: 'get', params: { id: '31' } },
      { url: '/org/organization/getRoleOrganizationTree', method: 'get' },
      { url: '/org/staff/page', method: 'get', params: { pageNo: 1, pageSize: 100, staffName: '计划员' } },
    ])
    const invalid = fixture([])
    await expect(invalid.api.staffSearch({ keyword: '   ' })).rejects.toThrow('非空关键字')
    expect(invalid.calls).toEqual([])
    await expect(fixture([{ list: [], total: -1 }]).api.list()).rejects.toThrow('有效list或total')
  })

  it('按 Portal 表单校验和后端请求体覆盖新建、编辑、删除，不提交 batchId/userId', async () => {
    const f = fixture([31, true, true])
    expect(f.api.prepareCreate({ form: { ...draft, batchId: 'ignored', userId: 'ignored' } as never })).toEqual({ draft })
    await expect(f.api.create({ draft })).resolves.toBe(31)
    const prepared = f.api.prepareUpdate({ current: { id: '31', ...draft, userId: 'ignored' }, changes: { planUserIds: ['23'] } })
    expect(prepared.previous).toEqual({ id: '31', ...draft })
    expect(prepared.draft).toEqual({ id: '31', ...draft, planUserIds: ['23'] })
    await expect(f.api.update({ draft: prepared.draft })).resolves.toBe(true)
    await expect(f.api.remove({ id: '31' })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/supply/legal-user-config/create', method: 'post', data: draft },
      { url: '/admin-api/supply/legal-user-config/update', method: 'put', data: prepared.draft },
      { url: '/admin-api/supply/legal-user-config/delete', method: 'delete', params: { id: '31' } },
    ])
    const invalid = fixture([])
    expect(() => invalid.api.prepareCreate({ form: { ...draft, materielTypeIds: [] } })).toThrow('至少选择一项')
    expect(() => invalid.api.prepareCreate({ form: { ...draft, legalId: null } as never })).toThrow('正整数ID')
    expect(() => invalid.api.prepareUpdate({ current: { id: '31', ...draft }, changes: { userId: '1' } as never })).toThrow('不支持字段userId')
    await expect(fixture([undefined]).api.update({ draft: prepared.draft })).rejects.toThrow('响应不是true')
  })

  it('AI说明覆盖九个能力且结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SUPPLY_PERSONNEL_CONFIG_METHODS).sort())
    expect(contracts['supply-personnel-config-staff-search']?.boundaries.join(' ')).toContain('非空 keyword')
    expect(contracts['supply-personnel-config-prepare-create']?.consume.join(' ')).toContain('三类数组都非空')
    expect(contracts['supply-personnel-config-create']?.steps[0]?.capabilityId).toBe('supply-personnel-config-get')
    expect(contracts['supply-personnel-config-remove']?.idempotency).toContain('回查')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
