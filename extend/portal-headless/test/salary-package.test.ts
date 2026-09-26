import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import type { PortalRequest } from '../src/session/types.js'
import {
  SALARY_PACKAGE_METHODS,
  SALARY_PACKAGE_MODULE_TYPE,
  SALARY_PACKAGE_PAGE_PATH,
  SALARY_PACKAGE_PERMISSION,
  createSalaryPackageCapability,
  salaryPackageCapabilities,
} from '../src/capabilities/salary-package.js'
import type { SalaryPackageItemRow } from '../src/capabilities/salary-package.js'
import { SALARY_PACKAGE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-salary-package.js'
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
  return { api: createSalaryPackageCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const packageRow = {
  id: 11,
  name: '月薪账套',
  organizationId: 101,
  organizationName: '总部',
  type: '1',
  countRange: '1',
  roleIdList: [8],
  isDel: 0,
}

const packageForm = {
  name: '月薪账套',
  organizationId: 101,
  organizationName: '总部',
  type: '1',
  countRange: '1',
  roleIdList: [8],
}

const itemRow: SalaryPackageItemRow = {
  id: 201,
  ledgerId: 11,
  itemId: 301,
  name: '应发工资',
  isMust: 1,
  attribute: 2,
  fixedValue: null,
  formula: '【基本工资】',
  parameter: null,
  parameterName: null,
  type: 6,
  scale: 2,
  carryRule: 1,
  sort: 1,
  remark: '',
}

describe('Portal 人力 → 薪资账套页面能力', () => {
  it('逐页锁定菜单、账套列表、表单、复制、子页、候选组件和权限上下文', () => {
    const root = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(root, 'app/portal/menus/hr.js')
    const list = read(root, 'app/portal/views/dashboard/hr/manage/salary-package/list.vue')
    const form = read(root, 'app/portal/views/dashboard/hr/manage/salary-package/[mode]/[id].vue')
    const copy = read(root, 'app/portal/views/dashboard/hr/manage/salary-package/components/copy.vue')
    const itemList = read(root, 'app/portal/views/dashboard/hr/manage/salary-package/item/[id]/item-list.vue')
    const include = read(root, 'app/portal/views/dashboard/hr/manage/salary-package/item/[id]/components/include.vue')
    const itemForm = read(root, 'app/portal/views/dashboard/hr/manage/common/salary/[mode]/[id].vue')
    const org = read(root, 'app/portal/components/portal/hxr/select/org/index.vue')
    const role = read(root, 'app/portal/components/portal/hxr/tree-select/role-org/index.vue')
    const all = [list, form, copy, itemList, include, itemForm, org, role].join('\n')

    expect(menu).toContain(`path: '${SALARY_PACKAGE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALARY_PACKAGE_PERMISSION}'`)
    for (const fragment of [
      "http.get('/salary/ledger/selectListByRole')",
      'selectCrossPage: true',
      'deleteIsBatch: true',
      "deleteURL: '/salary/ledger'",
      'actionCopy',
      'actionViewItems',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "http.post('/salary/ledger', form)",
      'name="organizationId"',
      'organizationName',
      'name="type"',
      'name="countRange"',
      'name="roleIdList"',
      'url="/sys/role/hrRoleListNew"',
      'project="3"',
      'max: 50',
    ]) expect(form).toContain(fragment)
    for (const fragment of ["http.post('/salary/ledger/copyLedger'", 'ledgerId: props.ledgerId', 'max: 50']) expect(copy).toContain(fragment)
    for (const fragment of [
      'getDataListIsPage: true',
      "http.get('/salary/ledgerItem/page'",
      'ledgerId: route.params.id',
      "deleteURL: '/salary/ledgerItem'",
      "router.push(`/dashboard/manage/common/salary/edit/${record.id}`)",
      'actionInclude',
    ]) expect(itemList).toContain(fragment)
    for (const fragment of ["http.get('/salary/ledgerItem/getNotInsertSalaryItem'", "http.post('/salary/ledgerItem/importSalaryItem'", 'salaryItemId: selected.value']) expect(include).toContain(fragment)
    for (const fragment of [
      "const url = route.query.type === 'salary-item' ? '/salary/item' : '/salary/ledgerItem'",
      "http.get('/salary/item/getAllSalaryItem')",
      "http.get('/salary/item/checkFormula'",
      "await http.put(url, formState)",
      'validateOnlySpace',
      'name="attribute"',
      'name="fixedValue"',
      'name="formula"',
      'name="parameter"',
      'name="scale"',
      'name="carryRule"',
      'name="sort"',
    ]) expect(itemForm).toContain(fragment)
    for (const fragment of ["http.get('/org/organization/pageByOrgId'", "http.get(props.isRole ? '/org/organization/getRoleOrganizationTree' : '/org/organization/getTree')"]) expect(org).toContain(fragment)
    expect(role).toContain('http.get(props.url)')

    expect(resolveModuleType(SALARY_PACKAGE_PAGE_PATH).moduleType).toBe(SALARY_PACKAGE_MODULE_TYPE)
    expect(salaryPackageCapabilities).toHaveLength(Object.keys(SALARY_PACKAGE_METHODS).length)
    expect(salaryPackageCapabilities.every(item => item.pagePath === SALARY_PACKAGE_PAGE_PATH && item.permission === SALARY_PACKAGE_PERMISSION && item.moduleType === SALARY_PACKAGE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    const bindingIds = new Set(CAPABILITY_BINDINGS.map(binding => binding.capabilityId))
    for (const id of Object.keys(SALARY_PACKAGE_METHODS)) expect(bindingIds).toContain(id)
    expect(all).toContain('roleIdList')
  })

  it('逐页锁定 Java Controller、DTO、Service、DAO 和账套授权/项目规则', () => {
    const root = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const hr = join(root, 'erp-module-hr')
    const ledgerController = read(hr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryLedgerController.java')
    const itemController = read(hr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/controller/SalaryLedgerItemController.java')
    const ledgerDto = read(hr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryLedgerDTO.java')
    const itemDto = read(hr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/SalaryLedgerItemDTO.java')
    const copyDto = read(hr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/CopyLedgerDTO.java')
    const importDto = read(hr, 'erp-module-hr-api/src/main/java/com/wdbc/erp/module/system/api/salary/dto/ImportSalaryItemDTO.java')
    const ledgerService = read(hr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryLedgerServiceImpl.java')
    const itemService = read(hr, 'erp-module-hr-biz/src/main/java/com/wdbc/erp/module/hr/controller/admin/salary/service/impl/SalaryLedgerItemServiceImpl.java')
    const daoXml = read(hr, 'erp-module-hr-biz/src/main/resources/mapper/salary/SalaryLedgerItemDao.xml')

    for (const fragment of [
      '@RequestMapping("/salary/ledger")',
      '@GetMapping("selectListByRole")',
      '@GetMapping("{id}")',
      '@PostMapping',
      '@PostMapping("copyLedger")',
      '@PutMapping',
      '@DeleteMapping',
    ]) expect(ledgerController).toContain(fragment)
    for (const fragment of [
      '@RequestMapping("/salary/ledgerItem")',
      '@GetMapping("page")',
      '@GetMapping("{id}")',
      '@PutMapping',
      '@DeleteMapping',
      '@PostMapping("importSalaryItem")',
      '@GetMapping("getNotInsertSalaryItem")',
    ]) expect(itemController).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private String type', 'private String countRange', 'private Long organizationId', 'private List<Long> roleIdList']) expect(ledgerDto).toContain(fragment)
    for (const fragment of ['private Long id', 'private Integer sort', 'private Long ledgerId', 'private Long itemId', 'private Integer attribute', 'private BigDecimal fixedValue', 'private Integer type', 'private Integer scale', 'private Integer carryRule', 'private String formula', 'private Long parameter']) expect(itemDto).toContain(fragment)
    for (const fragment of ['private Long ledgerId', 'private String name']) expect(copyDto).toContain(fragment)
    for (const fragment of ['private Long[] salaryItemId', 'private Long ledgerId']) expect(importDto).toContain(fragment)
    for (const fragment of ['saveInfo', 'copyLedger', 'getResourceIdByRole', 'getRoleList', '薪资账套名称不能重复', 'set("is_del", 1)', 'getSuperAdmin', 'getTenantAdmin']) expect(ledgerService).toContain(fragment)
    for (const fragment of ['initLedgerItem', '请勿修改项目名称', 'checkFormula', '请勿重复导入相同的薪资项目', 'set("is_del", 1)', 'getNotInsertSalaryItem']) expect(itemService).toContain(fragment)
    for (const fragment of ['ledger_id = #{dto.ledgerId}', 'is_del = 0', 'order by sort ASC']) expect(daoXml).toContain(fragment)
  })

  it('按Portal实际请求形状覆盖账套、组件候选、项目分页、表单校验和所有写动作', async () => {
    const organizationTree = [{ id: 101, name: '总部', children: [] }]
    const organizationPage = { list: [{ id: 101, name: '总部' }], total: 1 }
    const roleOptions = [{ id: 8, name: '薪酬管理员', children: [] }]
    const itemPage = { list: [itemRow], total: 1 }
    const available = [{ id: 302, name: '奖金' }]
    const f = fixture([
      [packageRow], packageRow,
      undefined, undefined, undefined, undefined,
      organizationTree, organizationPage, roleOptions,
      itemPage, itemRow, [{ id: 301, name: '基本工资' }], undefined, undefined, undefined,
      available, undefined, undefined,
    ])

    await expect(f.api.list()).resolves.toEqual([packageRow])
    await expect(f.api.get({ id: 11 })).resolves.toEqual(packageRow)
    const created = f.api.prepareCreate(packageForm)
    await expect(f.api.create({ draft: created.draft })).resolves.toBe(true)
    const updated = f.api.prepareUpdate({ current: packageRow, changes: { name: '月薪账套-修订', roleIdList: [8, 9] } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBe(true)
    const copied = f.api.prepareCopy({ ledgerId: 11, name: '月薪账套-副本' })
    await expect(f.api.copy(copied)).resolves.toBe(true)
    const removed = f.api.prepareRemove({ ids: [11, 12] })
    await expect(f.api.remove(removed)).resolves.toBe(true)
    await expect(f.api.organizationTree()).resolves.toEqual(organizationTree)
    await expect(f.api.organizationPage({ name: '总部', pageNo: 2 })).resolves.toEqual(organizationPage)
    await expect(f.api.roleOptions()).resolves.toEqual(roleOptions)
    await expect(f.api.itemList({ ledgerId: 11 })).resolves.toEqual(itemPage)
    await expect(f.api.itemGet({ id: 201 })).resolves.toEqual(itemRow)
    await expect(f.api.itemFormulaOptions()).resolves.toEqual([{ id: 301, name: '基本工资' }])
    await expect(f.api.itemCheckFormula({ formula: '【基本工资】' })).resolves.toBeUndefined()
    const itemUpdate = f.api.prepareItemUpdate({ current: itemRow })
    await expect(f.api.itemUpdate({ draft: itemUpdate.draft })).resolves.toBe(true)
    await expect(f.api.itemAvailable({ ledgerId: 11 })).resolves.toEqual(available)
    const imported = f.api.prepareItemImport({ ledgerId: 11, salaryItemId: [302] })
    await expect(f.api.itemImport(imported)).resolves.toBe(true)
    const itemRemoved = f.api.prepareItemRemove({ ids: [201, 202] })
    await expect(f.api.itemRemove(itemRemoved)).resolves.toBe(true)

    expect(f.calls).toEqual([
      { url: '/salary/ledger/selectListByRole', method: 'get' },
      { url: '/salary/ledger/11', method: 'get' },
      { url: '/salary/ledger', method: 'post', data: packageForm },
      { url: '/salary/ledger', method: 'post', data: { id: 11, name: '月薪账套-修订', organizationId: 101, organizationName: '总部', type: '1', countRange: '1', roleIdList: [8, 9] } },
      { url: '/salary/ledger/copyLedger', method: 'post', data: { ledgerId: 11, name: '月薪账套-副本' } },
      { url: '/salary/ledger', method: 'delete', data: [11, 12] },
      { url: '/org/organization/getTree', method: 'get' },
      { url: '/org/organization/pageByOrgId', method: 'get', params: { name: '总部', type: '', orgId: '', pageNo: 2, pageSize: 10 } },
      { url: '/sys/role/hrRoleListNew', method: 'get' },
      { url: '/salary/ledgerItem/page', method: 'get', params: { ledgerId: 11, order: '', orderField: '', pageNo: 1, pageSize: 20 } },
      { url: '/salary/ledgerItem/201', method: 'get' },
      { url: '/salary/item/getAllSalaryItem', method: 'get' },
      { url: '/salary/item/checkFormula', method: 'get', params: { formula: '【基本工资】' } },
      { url: '/salary/item/checkFormula', method: 'get', params: { formula: '【基本工资】' } },
      { url: '/salary/ledgerItem', method: 'put', data: itemRow },
      { url: '/salary/ledgerItem/getNotInsertSalaryItem', method: 'get', params: { ledgerId: 11 } },
      { url: '/salary/ledgerItem/importSalaryItem', method: 'post', data: { ledgerId: 11, salaryItemId: [302] } },
      { url: '/salary/ledgerItem', method: 'delete', data: [201, 202] },
    ])
  })

  it('反证Portal表单边界、联动清空、跨页ID和坏响应不能静默通过', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ ...packageForm, name: 'x'.repeat(51) })).toThrow()
    expect(() => f.api.prepareCreate({ ...packageForm, organizationId: '' as never })).toThrow()
    expect(() => f.api.prepareCreate({ ...packageForm, roleIdList: [] })).toThrow()
    expect(() => f.api.prepareCreate({ ...packageForm, name: '  ' })).not.toThrow()
    expect(() => f.api.prepareCopy({ ledgerId: 0, name: '副本' })).toThrow()
    expect(() => f.api.prepareRemove({ ids: [1, 1] })).toThrow()
    expect(() => f.api.prepareItemImport({ ledgerId: 11, salaryItemId: [] })).toThrow()
    expect(() => f.api.prepareItemUpdate({ current: itemRow, changes: { attribute: 1, formula: '应被清空', parameter: 999, fixedValue: '12.50' } })).not.toThrow()
    const linked = f.api.prepareItemUpdate({ current: itemRow, changes: { attribute: 1, formula: '应被清空', parameter: 999, fixedValue: '12.50' } })
    expect(linked.draft).toMatchObject({ attribute: 1, formula: '', parameter: '', fixedValue: '12.50' })
    await expect(f.api.itemCheckFormula({ formula: '   ' })).rejects.toThrow()
    await expect(fixture([null]).api.list()).rejects.toThrow()
    await expect(fixture([{ list: [], total: -1 }]).api.itemList({ ledgerId: 11 })).rejects.toThrow()
    await expect(fixture([{ id: 0, name: '坏账套' }]).api.get({ id: 11 })).rejects.toThrow()
    await expect(fixture([[{ id: 0, name: '坏项目' }]]).api.itemFormulaOptions()).rejects.toThrow()
    expect(f.calls).toHaveLength(0)
  })
})

describe('薪资账套 AI 契约', () => {
  it('所有页面能力都有结构化说明、执行绑定和显式真实环境缺口', async () => {
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(Object.keys(SALARY_PACKAGE_METHODS)).toHaveLength(24)
    expect(validateAiContracts(contracts, { definitions: salaryPackageCapabilities, contracts })).toEqual([])
    for (const contract of Object.values(contracts)) expect(contract.gaps?.join(' ')).toContain('尚未在真实测试环境')
  })
})
