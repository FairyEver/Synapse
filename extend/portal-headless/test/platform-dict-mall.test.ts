import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import { sdkPathOf } from '../src/capabilities/invoke.js'
import {
  createPlatformDictMallCapability,
  PLATFORM_DICT_MALL_COMMON_PAGE_PATH,
  PLATFORM_DICT_MALL_COMMON_PERMISSION,
  PLATFORM_DICT_MALL_COMMON_SYSTEM,
  PLATFORM_DICT_MALL_COMMON_METHODS,
  PLATFORM_DICT_MALL_FINANCE_PAGE_PATH,
  PLATFORM_DICT_MALL_FINANCE_PERMISSION,
  PLATFORM_DICT_MALL_FINANCE_SYSTEM,
  PLATFORM_DICT_MALL_FINANCE_METHODS,
  PLATFORM_DICT_MALL_HR_PAGE_PATH,
  PLATFORM_DICT_MALL_HR_PERMISSION,
  PLATFORM_DICT_MALL_HR_SYSTEM,
  PLATFORM_DICT_MALL_HR_METHODS,
  PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH,
  PLATFORM_DICT_MALL_MATERIAL_PERMISSION,
  PLATFORM_DICT_MALL_MATERIAL_SYSTEM,
  PLATFORM_DICT_MALL_MATERIAL_METHODS,
  PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH,
  PLATFORM_DICT_MALL_PRODUCT_PERMISSION,
  PLATFORM_DICT_MALL_PRODUCT_SYSTEM,
  PLATFORM_DICT_MALL_PRODUCT_METHODS,
  PLATFORM_DICT_MALL_SALE_PAGE_PATH,
  PLATFORM_DICT_MALL_SALE_PERMISSION,
  PLATFORM_DICT_MALL_SALE_SYSTEM,
  PLATFORM_DICT_MALL_SALE_METHODS,
  PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH,
  PLATFORM_DICT_MALL_SUPPLY_PERMISSION,
  PLATFORM_DICT_MALL_SUPPLY_SYSTEM,
  PLATFORM_DICT_MALL_SUPPLY_METHODS,
  PLATFORM_DICT_MALL_METHODS,
  PLATFORM_DICT_MALL_MODULE_TYPE,
  PLATFORM_DICT_MALL_PAGE_PATH,
  PLATFORM_DICT_MALL_PERMISSION,
  platformDictMallCommonCapabilities,
  platformDictMallFinanceCapabilities,
  platformDictMallHrCapabilities,
  platformDictMallMaterialCapabilities,
  platformDictMallProductCapabilities,
  platformDictMallSaleCapabilities,
  platformDictMallSupplyCapabilities,
  platformDictMallCapabilities,
} from '../src/capabilities/platform-dict-mall.js'
import { PLATFORM_DICT_MALL_AI_CONTRACTS as contracts, PLATFORM_DICT_MALL_COMMON_AI_CONTRACTS as commonContracts, PLATFORM_DICT_MALL_FINANCE_AI_CONTRACTS as financeContracts, PLATFORM_DICT_MALL_HR_AI_CONTRACTS as hrContracts, PLATFORM_DICT_MALL_MATERIAL_AI_CONTRACTS as materialContracts, PLATFORM_DICT_MALL_PRODUCT_AI_CONTRACTS as productContracts, PLATFORM_DICT_MALL_SALE_AI_CONTRACTS as saleContracts, PLATFORM_DICT_MALL_SUPPLY_AI_CONTRACTS as supplyContracts } from '../src/catalog/contracts-platform-dict-mall.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createPlatformDictMallCapability(request), calls }
}

function scopedFixture (responses: unknown[] = [], fixedUseSystem = PLATFORM_DICT_MALL_COMMON_SYSTEM) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createPlatformDictMallCapability(request, { fixedUseSystem }), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9007199254740993', name: '性别', type: 'sys_common_sex', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 0, tenantEditable: 1 }
const dataRow = { id: '9007199254740994', sort: 1, label: '男', value: '1', dictType: 'sys_common_sex', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 0, platform: true }

describe('Portal 平台设置 → 平台字典 → 字典管理页面能力', () => {
  it('逐页锁定菜单、wrapper、共享根页/子页/表单、权限和范围', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/mall.v2.js')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/all/list.vue')
    const commonWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/common/list.vue')
    const financeWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/finance/list.vue')
    const financeTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/finance/[mode]/[id].vue')
    const financeDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/finance/data/[type]/items.vue')
    const financeDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/finance/data/[type]/[mode]/[id].vue')
    const hrWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/hr/list.vue')
    const hrTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/hr/[mode]/[id].vue')
    const hrDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/hr/data/[type]/items.vue')
    const hrDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/hr/data/[type]/[mode]/[id].vue')
    const materialWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/material/list.vue')
    const materialTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/material/[mode]/[id].vue')
    const materialDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/material/data/[type]/items.vue')
    const materialDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/material/data/[type]/[mode]/[id].vue')
    const productWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/product/list.vue')
    const productTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/product/[mode]/[id].vue')
    const productDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/product/data/[type]/items.vue')
    const productDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/product/data/[type]/[mode]/[id].vue')
    const saleWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/sale/list.vue')
    const saleTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/sale/[mode]/[id].vue')
    const saleDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/sale/data/[type]/items.vue')
    const saleDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/sale/data/[type]/[mode]/[id].vue')
    const supplyWrapper = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/supply/list.vue')
    const supplyTypeForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/supply/[mode]/[id].vue')
    const supplyDataList = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/supply/data/[type]/items.vue')
    const supplyDataForm = read(portalRoot, 'app/portal/views/dashboard/platform/setting/dict-mall/supply/data/[type]/[mode]/[id].vue')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/data/[type]/items.vue')
    const typeForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/[mode]/[id].vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/data/[type]/[mode]/[id].vue')

    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_PERMISSION}'`)
    expect(menu).toContain("title: '平台字典'")
    expect(wrapper).toContain("import ListPage from 'app/portal/views/dashboard/common/setting/dict-platform-mall/all/list.vue'")
    expect(commonWrapper).toContain("SYSTEM_COMMON_VALUE")
    expect(commonWrapper).toContain("<ListPage :useSystem=\"SYSTEM_COMMON_VALUE\"/>")
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_FINANCE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_FINANCE_PERMISSION}'`)
    expect(menu).toContain("title: '财务字典'")
    expect(financeWrapper).toContain('SYSTEM_FINANCE_VALUE')
    expect(financeWrapper).toContain('<ListPage :useSystem="SYSTEM_FINANCE_VALUE"/>')
    expect(financeTypeForm).toContain('SYSTEM_FINANCE_VALUE')
    expect(financeTypeForm).toContain('<FormPage :useSystem="SYSTEM_FINANCE_VALUE"/>')
    expect(financeDataList).toContain('ItemsPage')
    expect(financeDataForm).toContain('FormPage')
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_HR_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_HR_PERMISSION}'`)
    expect(menu).toContain("title: '人力字典'")
    expect(hrWrapper).toContain('SYSTEM_HR_VALUE')
    expect(hrWrapper).toContain('<ListPage :useSystem="SYSTEM_HR_VALUE"/>')
    expect(hrTypeForm).toContain('SYSTEM_HR_VALUE')
    expect(hrTypeForm).toContain('<FormPage :useSystem="SYSTEM_HR_VALUE"/>')
    expect(hrDataList).toContain('ItemsPage')
    expect(hrDataForm).toContain('FormPage')
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_MATERIAL_PERMISSION}'`)
    expect(menu).toContain("title: '资产字典'")
    expect(materialWrapper).toContain('SYSTEM_MATERIAL_VALUE')
    expect(materialWrapper).toContain('<ListPage :useSystem="SYSTEM_MATERIAL_VALUE"/>')
    expect(materialTypeForm).toContain('SYSTEM_MATERIAL_VALUE')
    expect(materialTypeForm).toContain('<FormPage :useSystem="SYSTEM_MATERIAL_VALUE"/>')
    expect(materialDataList).toContain('ItemsPage')
    expect(materialDataForm).toContain('FormPage')
    for (const fragment of [
      "getDataListURL: '/adminmanage-api/system/dict-type/page'",
      'getDataListIsPage: true',
      'deleteIsBatch: true',
      "name: ''",
      "type: ''",
      'tenantEditable: undefined',
      "url: '/adminmanage-api/system/dict-type/delete'",
      "http.put('/adminmanage-api/system/dict-type/update', data)",
      "@click=\"() => rrList.actionEdit(record)\"",
      'router.push(`./data/${record.type}/items`)',
      "const isDev = import.meta.env.VITE_API_ENV_NAME === 'dev'",
    ]) expect(rootList).toContain(fragment)
    for (const fragment of [
      "'/adminmanage-api/system/dict-data/page'",
      'dictType: route.params.type',
      "label: ''",
      'status: undefined',
      "url: '/adminmanage-api/system/dict-data/delete'",
      'params: { ids }',
      'rrList.actionCreate($route.params.type)',
    ]) expect(dataList).toContain(fragment)
    for (const fragment of [
      "`/adminmanage-api/system/dict-type/get?id=${id}`",
      "http.put('/adminmanage-api/system/dict-type/update', form)",
      "http.post('/adminmanage-api/system/dict-type/create', form)",
      'SYSTEM_COMMON_VALUE',
      'tenantEditable: 0',
      'status: 0',
      "{ required: true, message: '必填' }",
    ]) expect(typeForm).toContain(fragment)
    for (const fragment of [
      "'/adminmanage-api/system/dict-data/get'",
      'dictTypeId: route.params.type',
      "status: 0",
      "sort: 0",
      "dictType: bridge",
      "url: route.params.mode === 'edit' ? '/adminmanage-api/system/dict-data/update' : '/adminmanage-api/system/dict-data/create'",
      "{ required: true, message: '必填', trigger: 'blur' }",
    ]) expect(dataForm).toContain(fragment)
    expect(menu).not.toContain("path: '/dashboard/product/")
    expect(platformDictMallCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_METHODS))
    expect(platformDictMallCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(platformDictMallCapabilities.find(item => item.id === 'platform-dict-mall-type-list')?.params.map(param => param.name)).toContain('useSystem')
    expect(platformDictMallCommonCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_COMMON_METHODS))
    expect(platformDictMallCommonCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_COMMON_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_COMMON_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(platformDictMallFinanceCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_FINANCE_METHODS))
    expect(platformDictMallFinanceCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_FINANCE_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_FINANCE_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(platformDictMallHrCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_HR_METHODS))
    expect(platformDictMallHrCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_HR_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_HR_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(platformDictMallMaterialCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_MATERIAL_METHODS))
    expect(platformDictMallMaterialCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_MATERIAL_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_MATERIAL_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_PRODUCT_PERMISSION}'`)
    expect(menu).toContain("title: '生产字典'")
    expect(productWrapper).toContain('SYSTEM_PRODUCT_VALUE')
    expect(productWrapper).toContain('<ListPage :useSystem="SYSTEM_PRODUCT_VALUE"/>')
    expect(productTypeForm).toContain('SYSTEM_PRODUCT_VALUE')
    expect(productTypeForm).toContain('<FormPage :useSystem="SYSTEM_PRODUCT_VALUE"/>')
    expect(productDataList).toContain('ItemsPage')
    expect(productDataForm).toContain('FormPage')
    expect(platformDictMallProductCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_PRODUCT_METHODS))
    expect(platformDictMallProductCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_PRODUCT_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_PRODUCT_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_SALE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_SALE_PERMISSION}'`)
    expect(menu).toContain("title: '销售字典'")
    expect(saleWrapper).toContain('SYSTEM_SALE_VALUE')
    expect(saleWrapper).toContain('<ListPage :useSystem="SYSTEM_SALE_VALUE"/>')
    expect(saleTypeForm).toContain('SYSTEM_SALE_VALUE')
    expect(saleTypeForm).toContain('<FormPage :useSystem="SYSTEM_SALE_VALUE"/>')
    expect(saleDataList).toContain('ItemsPage')
    expect(saleDataForm).toContain('FormPage')
    expect(platformDictMallSaleCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_SALE_METHODS))
    expect(platformDictMallSaleCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_SALE_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_SALE_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(menu).toContain(`path: '${PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PLATFORM_DICT_MALL_SUPPLY_PERMISSION}'`)
    expect(menu).toContain("title: '采购字典'")
    expect(supplyWrapper).toContain('SYSTEM_SUPPLY_VALUE')
    expect(supplyWrapper).toContain('<ListPage :useSystem="SYSTEM_SUPPLY_VALUE"/>')
    expect(supplyTypeForm).toContain('SYSTEM_SUPPLY_VALUE')
    expect(supplyTypeForm).toContain('<FormPage :useSystem="SYSTEM_SUPPLY_VALUE"/>')
    expect(supplyDataList).toContain('ItemsPage')
    expect(supplyDataForm).toContain('FormPage')
    expect(platformDictMallSupplyCapabilities.map(item => item.id)).toEqual(Object.keys(PLATFORM_DICT_MALL_SUPPLY_METHODS))
    expect(platformDictMallSupplyCapabilities.every(item => item.pagePath === PLATFORM_DICT_MALL_SUPPLY_PAGE_PATH && item.permission === PLATFORM_DICT_MALL_SUPPLY_PERMISSION && item.moduleType === PLATFORM_DICT_MALL_MODULE_TYPE && item.httpInstance === 'platform' && item.params.every(param => param.name !== 'useSystem'))).toBe(true)
    expect(resolveModuleType(PLATFORM_DICT_MALL_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 平台管理接口的权限、表单校验和平台归属规则', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const typeController = read(root, 'controller/adminmanage/dict/ManageDictTypeController.java')
    const typeSaveReq = read(root, 'controller/admin/dict/vo/type/DictTypeSaveReqVO.java')
    const dataController = read(root, 'controller/adminmanage/dict/ManageDictDataController.java')
    const dataSaveReq = read(root, 'controller/admin/dict/vo/data/DictDataSaveReqVO.java')
    const dataService = read(root, 'service/dict/DictDataServiceImpl.java')
    const dataMapper = read(root, 'dal/mysql/dict/DictDataMapper.java')
    const typeService = read(root, 'service/dict/DictTypeServiceImpl.java')
    expect(typeController).toContain('@RequestMapping("/system/dict-type")')
    for (const fragment of ['dictTypeService.createDictType', 'dictTypeService.updateDictType', 'dictTypeService.deleteDictType', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping(value = "/get")']) expect(typeController).toContain(fragment)
    for (const fragment of ['@NotBlank(message = "字典名称不能为空")', '@NotNull(message = "字典类型不能为空")', '@NotNull(message = "状态不能为空")', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typeSaveReq).toContain(fragment)
    for (const fragment of ['dictDataService.createPlatformDictData', 'dictDataService.updatePlatformDictData', 'dictDataService.deletePlatformDictData', '@RequestMapping("/system/dict-data")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping(value = "/get")']) expect(dataController).toContain(fragment)
    for (const fragment of ['@NotNull(message = "显示顺序不能为空")', '@NotBlank(message = "字典标签不能为空")', '@NotBlank(message = "字典键值不能为空")', '@NotBlank(message = "字典类型不能为空")', '@InEnum(value = CommonStatusEnum.class']) expect(dataSaveReq).toContain(fragment)
    for (const fragment of ['validateDictTypeEnable(createReqVO.getDictType())', 'validateOwnedByPlatform(existing)', 'setTenantId(PLATFORM_TENANT_ID)', 'getPlatformDictDataPage']) expect(dataService).toContain(fragment)
    for (const fragment of ['selectPagePlatform', 'eq(DictDataDO::getTenantId, 0L)', 'eqIfPresent(DictDataDO::getDictType, reqVO.getDictType())']) expect(dataMapper).toContain(fragment)
    for (const fragment of ['createDictType', 'updateDictType', 'deleteDictType', 'validateDictTypeNameUnique', 'validateDictTypeUnique']) expect(typeService).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖类型根页、数据子页、bridge 表单和批量删除', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, typeRow, '9007199254740995', true, true, { list: [dataRow], total: 1 }, dataRow, '9007199254740996', true, true, true])
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeGet({ id: typeRow.id })).resolves.toEqual(typeRow)
    await expect(f.api.typeCreate({ name: '颜色', type: 'sys_color' })).resolves.toBe('9007199254740995')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '性别', type: 'sys_common_sex', useSystem: 0, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    await expect(f.api.typeRemove({ id: typeRow.id })).resolves.toBe(true)
    await expect(f.api.dataList({ dictType: 'sys_common_sex' })).resolves.toEqual({ list: [dataRow], total: 1 })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '2' })).resolves.toBe('9007199254740996')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', dictTypeId: 'sys_common_sex', platform: true })).resolves.toBe(true)
    await expect(f.api.dataRemove({ id: dataRow.id, platform: true })).resolves.toBe(true)
    await expect(f.api.dataRemoveBatch({ ids: [dataRow.id, 22] })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/get', method: 'get', params: { id: typeRow.id } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 0, name: '颜色', type: 'sys_color', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '性别', type: 'sys_common_sex', useSystem: 0, tenantEditable: 1, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/delete', method: 'delete', params: { id: typeRow.id } },
      { url: '/adminmanage-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'sys_common_sex', label: '', status: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-data/get', method: 'get', params: { id: dataRow.id } },
      { url: '/adminmanage-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'sys_common_sex', label: '女', value: '2', status: 0, sort: 0, remark: '', dictType: 'sys_common_sex' } },
      { url: '/adminmanage-api/system/dict-data/update', method: 'put', data: { id: dataRow.id, dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', dictTypeId: 'sys_common_sex', platform: true } },
      { url: '/adminmanage-api/system/dict-data/delete', method: 'delete', params: { id: dataRow.id } },
      { url: '/adminmanage-api/system/dict-data/delete', method: 'delete', params: { ids: [dataRow.id, 22] } },
    ])
  })

  it('按子页面固定系统值复刻公共字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254740997', true])
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '颜色', type: 'sys_color' })).resolves.toBe('9007199254740997')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '性别', type: 'sys_common_sex', useSystem: 0, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 0, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 0, name: '颜色', type: 'sys_color', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '性别', type: 'sys_common_sex', useSystem: 0, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'sys_error', useSystem: 1 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻财务字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254740998', true], PLATFORM_DICT_MALL_FINANCE_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '财务颜色', type: 'finance_color' })).resolves.toBe('9007199254740998')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '财务性别', type: 'finance_sex', useSystem: 2, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 2, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 2, name: '财务颜色', type: 'finance_color', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '财务性别', type: 'finance_sex', useSystem: 2, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'finance_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻人力字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254740999', true], PLATFORM_DICT_MALL_HR_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '人力状态', type: 'hr_status' })).resolves.toBe('9007199254740999')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '人力性别', type: 'hr_sex', useSystem: 1, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 1, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 1, name: '人力状态', type: 'hr_status', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '人力性别', type: 'hr_sex', useSystem: 1, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'hr_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻资产字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254741000', true], PLATFORM_DICT_MALL_MATERIAL_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '资产状态', type: 'material_status' })).resolves.toBe('9007199254741000')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '资产性别', type: 'material_sex', useSystem: 3, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 3, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 3, name: '资产状态', type: 'material_status', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '资产性别', type: 'material_sex', useSystem: 3, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'material_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻生产字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254741001', true], PLATFORM_DICT_MALL_PRODUCT_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '生产状态', type: 'product_status' })).resolves.toBe('9007199254741001')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '生产性别', type: 'product_sex', useSystem: 4, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 4, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 4, name: '生产状态', type: 'product_status', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '生产性别', type: 'product_sex', useSystem: 4, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'product_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻销售字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254741002', true], PLATFORM_DICT_MALL_SALE_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '销售状态', type: 'sale_status' })).resolves.toBe('9007199254741002')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '销售性别', type: 'sale_sex', useSystem: 6, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 6, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 6, name: '销售状态', type: 'sale_status', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '销售性别', type: 'sale_sex', useSystem: 6, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'sale_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按子页面固定系统值复刻采购字典根页筛选和表单提交', async () => {
    const f = scopedFixture([{ list: [typeRow], total: 1 }, '9007199254741003', true], PLATFORM_DICT_MALL_SUPPLY_SYSTEM)
    await expect(f.api.typeList()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.typeCreate({ name: '采购状态', type: 'supply_status' })).resolves.toBe('9007199254741003')
    await expect(f.api.typeUpdate({ id: typeRow.id, name: '采购性别', type: 'supply_sex', useSystem: 5, tenantEditable: 1, remark: '', status: 0 })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/adminmanage-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 5, name: '', type: '', tenantEditable: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/adminmanage-api/system/dict-type/create', method: 'post', data: { useSystem: 5, name: '采购状态', type: 'supply_status', tenantEditable: 0, remark: '', status: 0 } },
      { url: '/adminmanage-api/system/dict-type/update', method: 'put', data: { id: typeRow.id, name: '采购性别', type: 'supply_sex', useSystem: 5, tenantEditable: 1, remark: '', status: 0 } },
    ])
    await expect(f.api.typeCreate({ name: '错误', type: 'supply_error', useSystem: 0 })).rejects.toThrow('不允许修改所属系统')
  })

  it('按页面校验拒绝坏表单，但不在 Portal 可见动作前伪造权限结果', async () => {
    const f = fixture([])
    await expect(f.api.typeCreate({ name: ' ', type: 'x' })).rejects.toThrow('name')
    await expect(f.api.typeCreate({ name: '名称', type: 'x', useSystem: 9 })).rejects.toThrow('useSystem')
    await expect(f.api.typeUpdate({ id: '', name: '名称', type: 'x' } as never)).rejects.toThrow('字典类型ID')
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: ' ', value: '1' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'sys_common_sex', label: '男', value: '1', sort: -1 })).rejects.toThrow('sort')
    await expect(f.api.dataRemoveBatch({ ids: [] })).rejects.toThrow('ids')
    await expect(f.api.typeList({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.typeList()).rejects.toThrow('有效list或total')
  })

  it('AI说明覆盖全部能力、绑定公开方法并用坏字段反证', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_METHODS).sort())
    expect(Object.keys(commonContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_COMMON_METHODS).map(id => id).sort())
    expect(Object.keys(financeContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_FINANCE_METHODS).map(id => id).sort())
    expect(Object.keys(hrContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_HR_METHODS).map(id => id).sort())
    expect(Object.keys(materialContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_MATERIAL_METHODS).map(id => id).sort())
    expect(Object.keys(productContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_PRODUCT_METHODS).map(id => id).sort())
    expect(Object.keys(saleContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_SALE_METHODS).map(id => id).sort())
    expect(Object.keys(supplyContracts).sort()).toEqual(Object.keys(PLATFORM_DICT_MALL_SUPPLY_METHODS).map(id => id).sort())
    expect(JSON.stringify(contracts)).not.toContain('租户接口只返回 tenant_editable=1')
    expect(JSON.stringify(contracts)).not.toContain('当前 dictType 的租户视角数据')
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(platformDictMallCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(contracts, { definitions: platformDictMallCapabilities, bindings })).toEqual([])
    const financeBindings = new Map(platformDictMallFinanceCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(financeContracts, { definitions: platformDictMallFinanceCapabilities, bindings: financeBindings })).toEqual([])
    const hrBindings = new Map(platformDictMallHrCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(hrContracts, { definitions: platformDictMallHrCapabilities, bindings: hrBindings })).toEqual([])
    const materialBindings = new Map(platformDictMallMaterialCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(materialContracts, { definitions: platformDictMallMaterialCapabilities, bindings: materialBindings })).toEqual([])
    const productBindings = new Map(platformDictMallProductCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(productContracts, { definitions: platformDictMallProductCapabilities, bindings: productBindings })).toEqual([])
    const saleBindings = new Map(platformDictMallSaleCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(saleContracts, { definitions: platformDictMallSaleCapabilities, bindings: saleBindings })).toEqual([])
    const supplyBindings = new Map(platformDictMallSupplyCapabilities.map(definition => [definition.id, sdkPathOf(definition.id)!]))
    expect(validateAiContracts(supplyContracts, { definitions: platformDictMallSupplyCapabilities, bindings: supplyBindings })).toEqual([])
    const broken = structuredClone(contracts)
    broken['platform-dict-mall-type-list']!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: platformDictMallCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
