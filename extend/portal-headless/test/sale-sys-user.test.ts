import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createCatalog } from '../src/catalog/index.js'
import { resolveModuleType } from '../src/context/module-type.js'
import type { PortalRequest } from '../src/session/types.js'
import {
  SALE_SYS_USER_EDIT_BUSINESS_PERMISSION,
  SALE_SYS_USER_EDIT_OFFICE_PERMISSION,
  SALE_SYS_USER_METHODS,
  SALE_SYS_USER_MODULE_TYPE,
  SALE_SYS_USER_OPEN_BATCH_PERMISSION,
  SALE_SYS_USER_OPEN_PERMISSION,
  SALE_SYS_USER_PAGE_PATH,
  SALE_SYS_USER_PERMISSION,
  SALE_SYS_USER_STOP_BATCH_PERMISSION,
  SALE_SYS_USER_STOP_PERMISSION,
  SALE_SYS_USER_TRANSFER_PERMISSION,
  createSaleSysUserCapability,
  saleSysUserCapabilities,
} from '../src/capabilities/sale-sys-user.js'
import { SALE_SYS_USER_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-sys-user.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleSysUserCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = {
  id: 10,
  salesId: 'S-10',
  username: 'u001',
  realName: '用户一',
  mobile: '13800000000',
  orgPath: '总部/销售',
  salesOrgPath: '销售/总部',
  roleNames: '销售员',
  salesStatus: 1,
  businessAttributeMap: { '21': ['A'] },
  shopIds: [21],
  officeIds: ['S-20'],
  organizationId: 100,
  salesOrganizationId: 'S-20',
  roles: [{ id: 3, name: '销售员' }],
  tenantName: '总部',
}

describe('Portal 系统设置 → 销售设置 → 用户扩展页面能力', () => {
  it('逐页锁定菜单、列表、弹窗、内销页和全部权限规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/sys/user/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/sale/sys/user/ModalFormContent.vue')
    const select = read(portalRoot, 'app/portal/views/dashboard/sale/sys/user/ModalFormSelectContent.vue')
    const shop = read(portalRoot, 'app/portal/views/dashboard/sale/sys/user/ModalFormShopContent.vue')
    const business = read(portalRoot, 'app/portal/views/dashboard/sale/sys/user/ModalFormBusinessContent.vue')
    const transfer = read(portalRoot, 'app/portal/views/dashboard/sale/setting/transfer/form.vue')
    for (const fragment of [`path: '${SALE_SYS_USER_PAGE_PATH}'`, `permission: '${SALE_SYS_USER_PERMISSION}'`]) expect(menu).toContain(fragment)
    for (const fragment of [
      'customLoad (form)', "http('/admin-api/sales/user/page'", 'useSystem: 6', 'salesStatus: 1', 'getDataListIsPage: true', 'selectable: true',
      "'/admin-api/system/dict-data/page'", "'/admin-api/system/hr-role/page'", "'/admin-api/sales/organization/tree'", "`/admin-api/sales/user/detail/${record.id}`",
      "'/admin-api/sales/shop/user-tenant-shops'", "'/admin-api/sales/organization/user-sales-child-organizations'", "'/admin-api/sales/domestic-business-setting/save'", "'/admin-api/sales/user/update'", 'data.materials?.map(item => item.materielCode)?.join(\',\')',
      "'/admin-api/sales/user/batch-disable'", "'/admin-api/sales/user/batch-enable'", 'newPageWithPlatformAuth',
      "permissionCheck('sys:user:export')", "permissionCheck('sys:user:edit')", "permissionCheck('sys:user:edit:office')",
      "permissionCheck('sys:user:edit:business')", "permissionCheck('sys:user:transfer')", "permissionCheck('sys:user:stop')", "permissionCheck('sys:user:open')",
      "permissionCheck('sys:user:stopBatch')", "permissionCheck('sys:user:openBatch')", 'searchedValid.value = form.salesStatus == 1',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'salesOrganizationId: \'\'', 'salesStatus: 1', '...props.raw', 'required: true', 'value == props.raw.salesId',
      "http('/admin-api/sales/organization/tree', {\n      params: {}", "modalEmit('submit', form)", "permissionCheck('sys:user:edit')",
    ]) expect(form).toContain(fragment)
    expect(select).toContain('mode="multiple"')
    expect(shop).toContain('modalEmit(\'submit\', { shopIds: selectIds.value })')
    for (const fragment of [
      "httpCrm.get('/vue/sys/dict/listData'", "type: 'item_kind'", "http(`/admin-api/sales/domestic-business-setting/materiel-list`",
      "http(`/admin-api/sales/domestic-business-setting/get-materiels`",
    ]) expect(business).toContain(fragment)
    for (const fragment of [
      "api=\"admin-api/sales/organization/undertakeTree\"", "user-sales-child-customer-organizations", "undertakeUpdate", 'organizationList: selectedKeys.value',
    ]) expect(transfer).toContain(fragment)
    expect(saleSysUserCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_SYS_USER_METHODS))
    expect(saleSysUserCapabilities.every(item => item.pagePath === SALE_SYS_USER_PAGE_PATH && item.permission === SALE_SYS_USER_PERMISSION && item.moduleType === SALE_SYS_USER_MODULE_TYPE)).toBe(true)
    expect(saleSysUserCapabilities.find(item => item.id === 'sale-sys-user-role-options')?.params).toEqual([
      { name: 'keyword', kind: 'search', required: true, description: '角色名称关键字；必须为非空白字符串' },
      { name: 'pageNo', kind: 'number', required: false, description: '从1开始的页码' },
      { name: 'pageSize', kind: 'number', required: false, description: '每页条数，支持10、20、50、100' },
    ])
    expect(saleSysUserCapabilities.find(item => item.id === 'sale-sys-user-item-kind-options')?.httpInstance).toBe('crm')
    expect(saleSysUserCapabilities.filter(item => item.id !== 'sale-sys-user-item-kind-options').every(item => item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SALE_SYS_USER_PAGE_PATH).moduleType).toBe(SALE_SYS_USER_MODULE_TYPE)
  })

  it('逐页锁定固定Java路由、DTO字段和依赖接口', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/user/SalesUserController.java')
    const pageReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/user/vo/SalesUserPageReqVO.java')
    const saveReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/user/vo/SalesUserSaveReqVO.java')
    const resp = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/user/vo/SalesUserRespVO.java')
    const domesticController = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/domesticbusiness/DomesticBusinessSettingController.java')
    const domesticReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/domesticbusiness/vo/MaterielListReqVO.java')
    const domesticSave = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/domesticbusiness/vo/DomesticBusinessSettingSaveReqVO.java')
    const shopController = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/shop/ShopController.java')
    const organizationController = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/SalesOrganizationController.java')
    const transferReq = read(javaRoot, 'erp-module-sales/erp-module-sales-biz/src/main/java/com/wdbc/erp/module/sales/controller/admin/system/organization/vo/SalesOrganizationUnderTakeReqVO.java')
    for (const fragment of ['@RequestMapping("/sales/user")', '@GetMapping("/page")', '@GetMapping("/export")', '@GetMapping("/detail/{id}")', '@PutMapping("/update")', '@PostMapping("/batch-enable")', '@PostMapping("/batch-disable")', 'return success(true)']) expect(controller).toContain(fragment)
    for (const fragment of ['private Long orgId', 'private String username', 'private String mobile', 'private String realName', 'private Integer salesStatus', 'private Integer roleId']) expect(pageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String salesId', 'private String salesOrganizationId', 'private List<Long> roleIds', 'private Integer salesStatus', 'private Map<Integer, List<String>> businessAttributeMap', 'private List<Integer> shopIds', 'private List<String> officeIds']) expect(saveReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String salesId', 'private String username', 'private String realName', 'private Integer salesStatus', 'private Map<Integer, List<String>> businessAttributeMap', 'private List<Integer> shopIds', 'private List<String> officeIds', 'private Long organizationId', 'private String salesOrganizationId']) expect(resp).toContain(fragment)
    for (const fragment of ['@RequestMapping("/sales/domestic-business-setting")', '@GetMapping("/materiel-list")', '@PostMapping("/save")', '@GetMapping("/get-materiels")']) expect(domesticController).toContain(fragment)
    for (const fragment of ['private String materielName', 'private String materielCode', 'private String factoryName', 'private Long materielCategory', 'private String supplierName', 'private String shopName', 'private Long organizationId', 'private Long userId']) expect(domesticReq).toContain(fragment)
    for (const fragment of ['private Long userId', 'private String materials']) expect(domesticSave).toContain(fragment)
    expect(shopController).toContain('@GetMapping("/user-tenant-shops")')
    for (const fragment of ['@GetMapping("/user-sales-child-organizations")', '@GetMapping("/user-sales-child-customer-organizations")', '@GetMapping("/undertakeTree")', '@PutMapping("/undertakeUpdate")']) expect(organizationController).toContain(fragment)
    for (const fragment of ['private String salesId', 'private String salesOrganizationId', 'private List<String> organizationList']) expect(transferReq).toContain(fragment)
  })

  it('列表、候选、树、详情、店铺、CRM字典和内销物料逐一复刻Portal请求', async () => {
    const material = { materielCode: 'M-1', materielName: '物料一', selectable: true }
    const f = fixture([
      { list: [row], total: 1 },
      { list: [{ value: '1', label: '启用' }] },
      { list: [{ id: 3, name: '销售员' }], total: 1 },
      [{ id: 100, name: '总部', children: [] }],
      [{ id: 100, name: '总部', children: [] }],
      row,
      [{ id: 100, name: '销售上级', salesId: 'S-20', children: [] }],
      [{ shopId: 21, shopName: '店铺一' }],
      [{ id: 201, name: '销售部', salesId: 'S-201', children: [] }],
      [{ value: 'A', label: '商品类型A' }],
      { materiels: 'M-1,M-2' },
      { list: [material], total: 1 },
    ])
    await expect(f.api.list({ orgId: 100, username: 'u001', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    await expect(f.api.statusOptions()).resolves.toEqual([{ value: 1, label: '启用' }])
    await expect(f.api.roleOptions({ keyword: '销售' })).resolves.toEqual([{ value: 3, label: '销售员' }])
    await expect(f.api.companyTree()).resolves.toEqual([{ id: 100, name: '总部', children: [] }])
    await expect(f.api.organizationTree()).resolves.toEqual([{ id: 100, name: '总部', children: [] }])
    await expect(f.api.get({ id: 10 })).resolves.toEqual(row)
    await expect(f.api.salesTree()).resolves.toEqual([{ id: 100, name: '销售上级', salesId: 'S-20', children: [] }])
    await expect(f.api.shops({ userId: 10 })).resolves.toEqual([{ shopId: 21, shopName: '店铺一' }])
    await expect(f.api.childOrganizations({ userId: 10 })).resolves.toEqual([{ id: 201, name: '销售部', salesId: 'S-201', children: [] }])
    await expect(f.api.itemKindOptions()).resolves.toEqual([{ value: 'A', label: '商品类型A' }])
    await expect(f.api.domesticMaterialCodes({ userId: 10 })).resolves.toEqual({ materiels: 'M-1,M-2', codes: ['M-1', 'M-2'] })
    await expect(f.api.domesticMaterialList({ organizationId: 100, userId: 10, materielName: '物料', materielCode: 'M', factoryName: '', materielCategory: 7, supplierName: '', shopName: '', pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [material], total: 1 })
    expect(f.calls).toEqual([
      { url: '/admin-api/sales/user/page', method: 'get', params: { order: '', orderField: '', orgId: 100, username: 'u001', mobile: '', realName: '', roleId: '', salesStatus: 1, useSystem: 6, pageNo: 2, pageSize: 50 }, httpInstance: 'platform' },
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { dictType: 'sales_user_status', pageNo: 1, pageSize: 100 }, httpInstance: 'platform' },
      { url: '/admin-api/system/hr-role/page', method: 'get', params: { name: '销售', pageNo: 1, pageSize: 20, useSystem: 6 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: { salesTypeMax: '1', isSalesTree: false }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: { isSalesTree: false }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/detail/10', method: 'get', httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/tree', method: 'get', params: {}, httpInstance: 'platform' },
      { url: '/admin-api/sales/shop/user-tenant-shops', method: 'get', params: { userId: 10 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/user-sales-child-organizations', method: 'get', params: { userId: 10 }, httpInstance: 'platform' },
      { url: '/vue/sys/dict/listData', method: 'get', params: { type: 'item_kind' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, httpInstance: 'crm' },
      { url: '/admin-api/sales/domestic-business-setting/get-materiels', method: 'get', params: { userId: 10 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/domestic-business-setting/materiel-list', method: 'get', params: { order: '', orderField: '', organizationId: 100, userId: 10, materielName: '物料', materielCode: 'M', factoryName: '', materielCategory: 7, supplierName: '', shopName: '', pageNo: 1, pageSize: 20 }, httpInstance: 'platform' },
    ])
  })

  it('销售角色候选必须有非空关键字、服务端按name筛选且只请求受限单页', async () => {
    const f = fixture([{ list: [{ id: 3, name: '销售员' }], total: 5000 }])
    await expect(f.api.roleOptions({ keyword: ' 销售 ', pageSize: 100 })).resolves.toEqual([{ value: 3, label: '销售员' }])
    expect(f.calls).toEqual([
      { url: '/admin-api/system/hr-role/page', method: 'get', params: { name: '销售', pageNo: 1, pageSize: 100, useSystem: 6 }, httpInstance: 'platform' },
    ])

    for (const keyword of [undefined, null, '', '   ']) {
      const invalid = fixture([])
      await expect(invalid.api.roleOptions({ keyword: keyword as string })).rejects.toThrow(/关键字/)
      expect(invalid.calls).toHaveLength(0)
    }
    const invalidPage = fixture([])
    await expect(invalidPage.api.roleOptions({ keyword: '销售', pageSize: 500 })).rejects.toThrow(/pageSize/)
    expect(invalidPage.calls).toHaveLength(0)
  })

  it('覆盖用户扩展表格可达的隐藏移交路由和提交净载荷', async () => {
    const f = fixture([
      [{ id: 300, name: '承接销售组', salesId: 'S-G-300', salesType: 3, users: [{ salesId: 'S-U-301', realName: '承接人' }], children: [] }],
      [{ organizationId: 'C-1', salesOrgName: '客户一', salesCode: 'C001', customerNum: 2 }],
      true,
    ])
    await expect(f.api.transferTargetTree()).resolves.toEqual([{ id: 300, name: '承接销售组', salesId: 'S-G-300', salesType: 3, users: [{ salesId: 'S-U-301', realName: '承接人' }], children: [] }])
    await expect(f.api.transferCustomerOrganizations({ userId: 10, filterName: '客户' })).resolves.toEqual([{ organizationId: 'C-1', salesOrgName: '客户一', salesCode: 'C001', customerNum: 2 }])
    const draft = f.api.prepareTransfer({ sourceUserId: 10, salesOrganizationId: 'S-G-300', salesId: 'S-U-301', organizationList: ['C-1'] })
    await expect(f.api.transfer(draft)).resolves.toBeUndefined()
    expect(f.calls).toEqual([
      { url: '/admin-api/sales/organization/undertakeTree', method: 'get', params: { isSalesTree: true }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/user-sales-child-customer-organizations', method: 'get', params: { order: '', orderField: '', userId: 10, filterName: '客户' }, httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/undertakeUpdate', method: 'put', data: { salesOrganizationId: 'S-G-300', salesId: 'S-U-301', organizationList: ['C-1'] }, httpInstance: 'platform' },
    ])
  })

  it('所有写入动作都保留Portal载荷和prepare门禁，并正确处理导出文件', async () => {
    const f = fixture([true, true, true, true, true, true, true, true, true, true, true, { data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/vnd.ms-excel', 'content-disposition': 'attachment; filename="用户.xlsx"' } }])
    const update = f.api.prepareUpdate({ form: { ...row, salesOrganizationId: 'S-20', salesStatus: 1, readOnly: 'keep' } })
    await expect(f.api.update({ draft: update.draft })).resolves.toBeUndefined()
    const role = f.api.prepareRoleUpdate({ id: 10, roleIds: [3], currentFilterStatus: '1' })
    await expect(f.api.updateRoles(role)).resolves.toBeUndefined()
    const shop = f.api.prepareShopUpdate({ id: 10, shopIds: [21], currentFilterStatus: 1 })
    await expect(f.api.updateShops(shop)).resolves.toBeUndefined()
    const office = f.api.prepareOfficeUpdate({ id: 10, officeIds: ['S-201'], currentFilterStatus: 1 })
    await expect(f.api.updateOffices(office)).resolves.toBeUndefined()
    const business = f.api.prepareBusinessUpdate({ id: 10, businessAttributeMap: { '21': ['A'] }, currentFilterStatus: 1 })
    await expect(f.api.updateBusiness(business)).resolves.toBeUndefined()
    const domestic = f.api.prepareDomesticSave({ userId: 10, materials: [{ materielCode: 'M-1' }, { materielCode: 'M-2' }], currentFilterStatus: 1 })
    await expect(f.api.saveDomestic(domestic)).resolves.toBeUndefined()
    await expect(f.api.stop(f.api.prepareStop({ id: 10, currentFilterStatus: 1 }))).resolves.toBeUndefined()
    await expect(f.api.open(f.api.prepareOpen({ id: 10, currentFilterStatus: 2 }))).resolves.toBeUndefined()
    await expect(f.api.batchStop(f.api.prepareBatchStop({ ids: [10, 11], currentFilterStatus: 1 }))).resolves.toBeUndefined()
    await expect(f.api.batchOpen(f.api.prepareBatchOpen({ ids: [10, 11], currentFilterStatus: 2 }))).resolves.toBeUndefined()
    await expect(f.api.transfer({ sourceUserId: 10, salesOrganizationId: 'S-G-300', salesId: 'S-U-301', organizationList: ['C-1'] })).resolves.toBeUndefined()
    await expect(f.api.export({ username: 'u001', salesStatus: 2, pageNo: 3, pageSize: 20 })).resolves.toMatchObject({ fileName: '用户.xlsx', contentType: 'application/vnd.ms-excel', base64: 'AQID', byteLength: 3 })
    expect(f.calls).toEqual([
      { url: '/admin-api/sales/user/update', method: 'put', data: update.draft, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, roleIds: [3] }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, shopIds: [21] }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, officeIds: ['S-201'] }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, businessAttributeMap: { '21': ['A'] } }, httpInstance: 'platform' },
      { url: '/admin-api/sales/domestic-business-setting/save', method: 'post', data: { userId: 10, materials: 'M-1,M-2' }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, salesStatus: 2 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/update', method: 'put', data: { id: 10, salesStatus: 1 }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/batch-disable', method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: [10, 11], httpInstance: 'platform' },
      { url: '/admin-api/sales/user/batch-enable', method: 'post', headers: { 'content-type': 'application/json;charset=UTF-8' }, data: [10, 11], httpInstance: 'platform' },
      { url: '/admin-api/sales/organization/undertakeUpdate', method: 'put', data: { salesOrganizationId: 'S-G-300', salesId: 'S-U-301', organizationList: ['C-1'] }, httpInstance: 'platform' },
      { url: '/admin-api/sales/user/export', method: 'get', params: { orgId: '', username: 'u001', mobile: '', realName: '', roleId: '', salesStatus: 2, pageNo: 3, pageSize: 20 }, responseType: 'arraybuffer', httpInstance: 'platform' },
    ])
  })

  it('权限/状态/自身上级/重复ID/坏回执不能被放松', async () => {
    const f = fixture([])
    expect(() => f.api.prepareUpdate({ form: { ...row, salesOrganizationId: 'S-10' } })).toThrow('自己')
    expect(() => f.api.prepareUpdate({ form: { ...row, salesOrganizationId: 10, salesId: '010' } })).toThrow('自己')
    expect(() => f.api.prepareUpdate({ form: { ...row, salesOrganizationId: '' } })).toThrow('salesOrganizationId')
    expect(() => f.api.prepareRoleUpdate({ id: 10, roleIds: [], currentFilterStatus: 2 })).toThrow('启用状态')
    expect(() => f.api.prepareOfficeUpdate({ id: 10, officeIds: [], currentFilterStatus: 2 })).toThrow('启用状态')
    expect(() => f.api.prepareOpen({ id: 10, currentFilterStatus: 1 })).toThrow('非启用')
    expect(() => f.api.prepareBatchStop({ ids: [10, 10], currentFilterStatus: 1 })).toThrow('重复')
    expect(() => f.api.prepareBatchOpen({ ids: [], currentFilterStatus: 2 })).toThrow('至少')
    expect(() => f.api.prepareDomesticSave({ userId: 10, materials: [{ materielCode: 'M-1', selectable: false }], currentFilterStatus: 1 })).toThrow('不可选择')
    expect(() => f.api.prepareTransfer({ sourceUserId: 10, salesOrganizationId: 'S-G-300', salesId: 'S-U-301', organizationList: [] })).toThrow('至少')
    expect(f.calls).toHaveLength(0)
    await expect(fixture([false]).api.stop({ id: 10 })).rejects.toThrow('响应不是true')
    await expect(fixture([{ data: new Uint8Array([]).buffer, headers: {} }]).api.export()).rejects.toThrow('为空文件')
  })

  it('AI说明覆盖全部方法并写清权限、表单映射、取消和回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_SYS_USER_METHODS).sort())
    expect(contracts['sale-sys-user-prepare-update']?.steps.some(step => step.role === 'cancel')).toBe(true)
    expect(contracts['sale-sys-user-prepare-domestic-save']?.steps.some(step => step.capabilityId === 'sale-sys-user-save-domestic')).toBe(true)
    expect(contracts['sale-sys-user-update']?.completion).toContain('回查')
    expect(contracts['sale-sys-user-list']?.boundaries.join(' ')).toContain(SALE_SYS_USER_PERMISSION)
    expect(contracts['sale-sys-user-batch-stop']?.boundaries.join(' ')).toContain(SALE_SYS_USER_STOP_BATCH_PERMISSION)
    expect(contracts['sale-sys-user-batch-open']?.boundaries.join(' ')).toContain(SALE_SYS_USER_OPEN_BATCH_PERMISSION)
    expect(contracts['sale-sys-user-prepare-office-update']?.boundaries.join(' ')).toContain(SALE_SYS_USER_EDIT_OFFICE_PERMISSION)
    expect(contracts['sale-sys-user-prepare-business-update']?.boundaries.join(' ')).toContain(SALE_SYS_USER_EDIT_BUSINESS_PERMISSION)
    expect(contracts['sale-sys-user-stop']?.boundaries.join(' ')).toContain(SALE_SYS_USER_STOP_PERMISSION)
    expect(contracts['sale-sys-user-open']?.boundaries.join(' ')).toContain(SALE_SYS_USER_OPEN_PERMISSION)
    expect(contracts['sale-sys-user-transfer']?.boundaries.join(' ')).toContain(SALE_SYS_USER_TRANSFER_PERMISSION)
    expect(contracts['sale-sys-user-transfer']?.steps.some(step => step.capabilityId === 'sale-sys-user-transfer-customer-organizations')).toBe(true)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
    const catalog = createCatalog({ capabilities: saleSysUserCapabilities })
    expect(catalog.describe('sale-sys-user-list')).toMatchObject({ ok: true })
    expect(catalog.describe('sale-sys-user-list-llm')).toMatchObject({ ok: true })
  })
})
