import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformProductCapability,
  SETTING_DICT_PLATFORM_PRODUCT_METHODS,
  SETTING_DICT_PLATFORM_PRODUCT_MODULE_TYPE,
  SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH,
  SETTING_DICT_PLATFORM_PRODUCT_PERMISSION,
  SETTING_DICT_PLATFORM_PRODUCT_SYSTEM,
  settingDictPlatformProductCapabilities,
} from '../src/capabilities/setting-dict-platform-product.js'
import { SETTING_DICT_PLATFORM_PRODUCT_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform-product.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformProductCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9007199254740993', name: '生产单据类型', type: 'product_document_type', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 4, tenantEditable: 1 }
const dataRow = { id: '9007199254740994', sort: 1, label: '生产中', value: 'producing', dictType: 'product_document_type', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 42, platform: false }

describe('Portal 系统设置 → 生产字典', () => {
  it('逐页锁定生产 wrapper、权限、固定系统值、共享动作边界和上下文', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const productList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/product/list.vue')
    const productTypeForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/product/[mode]/[id].vue')
    const productDataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/product/data/[type]/items.vue')
    const productDataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/product/data/[type]/[mode]/[id].vue')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')
    const activeRoot = rootList.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '')

    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_PRODUCT_PERMISSION}'`)
    for (const source of [productList, productTypeForm, productDataList, productDataForm]) {
      expect(source).toContain('SYSTEM_PRODUCT_VALUE')
    }
    expect(productList).toContain('<ListPage :useSystem="SYSTEM_PRODUCT_VALUE"/>')
    expect(productDataList).toContain("ListPage from 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue'")
    expect(productDataForm).toContain("FormPage from 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue'")
    for (const fragment of [
      "getDataListURL: '/admin-api/system/dict-type/page'",
      'useSystem: props.useSystem',
      'router.push(`./data/${record.type}/items`)',
      "import { http } from 'app/portal/utils/http/platform.js'",
    ]) expect(rootList).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/dict-data/page'",
      'dictType: route.params.type',
      'status: undefined',
      'rrList.actionCreate($route.params.type)',
      'rrList.actionEdit(record, $route.params.type)',
      'rrList.actionDelete(record)',
    ]) expect(dataList).toContain(fragment)
    expect(dataForm).toContain("'/admin-api/system/dict-data/get'")
    expect(dataForm).toContain("route.params.mode === 'edit' ? '/admin-api/system/dict-data/update' : '/admin-api/system/dict-data/create'")
    expect(dataForm).toContain('dictType: bridge')

    expect(activeRoot).not.toContain('deleteIsBatch: true')
    expect(activeRoot).not.toContain('common-action-create')
    expect(activeRoot).not.toContain('common-action-delete')
    expect(rootList).not.toContain('导入')
    expect(rootList).not.toContain('导出')
    expect(dataList).not.toContain('deleteIsBatch')
    expect(dataList).not.toContain('导入')
    expect(dataList).not.toContain('导出')

    expect(settingDictPlatformProductCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_PRODUCT_METHODS))
    expect(settingDictPlatformProductCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_PRODUCT_PERMISSION && item.moduleType === SETTING_DICT_PLATFORM_PRODUCT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(settingDictPlatformProductCapabilities.find(item => item.id === 'setting-dict-platform-product-type-list')?.params.map(param => param.name)).not.toContain('useSystem')
    expect(resolveModuleType(SETTING_DICT_PLATFORM_PRODUCT_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 租户 Controller、DTO、Service 和数据范围', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const typeController = read(root, 'controller/admin/dict/DictTypeController.java')
    const dataController = read(root, 'controller/admin/dict/DictDataController.java')
    const typePageReq = read(root, 'controller/admin/dict/vo/type/DictTypePageReqVO.java')
    const typeResp = read(root, 'controller/admin/dict/vo/type/DictTypeRespVO.java')
    const dataPageReq = read(root, 'controller/admin/dict/vo/data/DictDataPageReqVO.java')
    const dataResp = read(root, 'controller/admin/dict/vo/data/DictDataRespVO.java')
    const dataSaveReq = read(root, 'controller/admin/dict/vo/data/DictDataSaveReqVO.java')
    const typeService = read(root, 'service/dict/DictTypeServiceImpl.java')
    const dataService = read(root, 'service/dict/DictDataServiceImpl.java')
    const dataMapper = read(root, 'dal/mysql/dict/DictDataMapper.java')

    for (const fragment of ['@RequestMapping("/system/dict-type")', 'pageReqVO.setTenantEditable(1)', 'throw exception(DICT_TYPE_NO_PERMISSION)', '@GetMapping("/page")', '@GetMapping(value = "/get")', '@GetMapping("/export")']) expect(typeController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/system/dict-data")', 'createTenantDictData', 'updateTenantDictData', 'deleteTenantDictData', '@GetMapping("/page")', '@GetMapping(value = "/get")', '@GetMapping("/export")']) expect(dataController).toContain(fragment)
    for (const fragment of ['private String name', 'private String type', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typePageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private String type', 'private Integer status', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typeResp).toContain(fragment)
    for (const fragment of ['private String label', 'private String dictType', 'private Integer status']) expect(dataPageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private Integer sort', 'private String label', 'private String value', 'private String dictType', 'private Integer status', 'private Long tenantId', 'getPlatform()']) expect(dataResp).toContain(fragment)
    for (const fragment of ['@NotNull(message = "显示顺序不能为空")', '@NotBlank(message = "字典标签不能为空")', '@NotBlank(message = "字典键值不能为空")', '@NotBlank(message = "字典类型不能为空")', '@InEnum(value = CommonStatusEnum.class']) expect(dataSaveReq).toContain(fragment)
    for (const fragment of ['validateTenantEditable(createReqVO.getDictType())', 'validateOwnedByTenant(existing, currentTenantId)', 'setTenantId(currentTenantId)', 'getTenantDictDataPage']) expect(dataService).toContain(fragment)
    for (const fragment of ['in(DictDataDO::getTenantId, Arrays.asList(0L, currentTenantId))', 'selectPageByTenant']) expect(dataMapper).toContain(fragment)
    expect(typeService).toContain('validateTenantEditable')
  })

  it('固定 useSystem=4 并复刻筛选、分页、详情、新增、更新、单条删除请求', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '9007199254740995', true, true])
    await expect(f.api.list({ name: '生产', type: 'product', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [typeRow], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 4, name: '生产', type: 'product', pageNo: 2, pageSize: 50 } })
    await expect(f.api.dataList({ dictType: 'product_document_type', label: '生产中', status: 0, pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [dataRow], total: 1 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'product_document_type', label: '生产中', status: 0, pageNo: 1, pageSize: 20 } })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    expect(f.calls[2]).toEqual({ url: '/admin-api/system/dict-data/get', method: 'get', params: { id: dataRow.id } })
    await expect(f.api.dataCreate({ dictType: 'product_document_type', label: '已完成', value: 'done' })).resolves.toBe('9007199254740995')
    expect(f.calls[3]).toEqual({ url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'product_document_type', label: '已完成', value: 'done', status: 0, sort: 0, remark: '', dictType: 'product_document_type' } })
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'product_document_type', label: '生产中2', value: 'producing2', sort: 2, status: 1, remark: '' })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/admin-api/system/dict-data/update', method: 'put', data: { id: dataRow.id, dictType: 'product_document_type', label: '生产中2', value: 'producing2', sort: 2, status: 1, remark: '' } })
    await expect(f.api.dataRemove({ id: dataRow.id, platform: false })).resolves.toBe(true)
    expect(f.calls[5]).toEqual({ url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: dataRow.id } })
  })

  it('反证：坏参数、平台行、坏回执和后端错误不能误报成功', async () => {
    const f = fixture([])
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'product_document_type', label: ' ', value: 'x' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'product_document_type', label: '生产中', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'product_document_type', label: '生产中', value: 'producing', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: dataRow.id, platform: true })).rejects.toThrow('只读')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)

    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const badReceipt = fixture([false])
    await expect(badReceipt.api.dataRemove({ id: dataRow.id })).rejects.toThrow('响应不是true')
    const denied = fixture([new Error('生产字典权限不足')])
    await expect(denied.api.list()).rejects.toThrow('生产字典权限不足')
  })

  it('AI 说明覆盖六项能力、生产系统边界、完整字段和关键映射反证', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_PRODUCT_METHODS).sort())
    expect(contracts['setting-dict-platform-product-type-list']?.boundaries).toEqual(expect.arrayContaining(['根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=4（生产）；useSystem 不是调用参数。页面路径按规则表未命中，因此不发送 module-type。']))
    expect(contracts['setting-dict-platform-product-type-list']?.inputs).not.toHaveProperty('useSystem')
    expect(contracts['setting-dict-platform-product-type-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].type', 'list[].useSystem', 'list[].tenantEditable', 'total']))
    expect(contracts['setting-dict-platform-product-data-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].dictType', 'list[].platform', 'total']))
    expect(contracts['setting-dict-platform-product-data-create']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-product-data-list', mapping: { dictType: 'args.dictType' } })
    expect(contracts['setting-dict-platform-product-data-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-product-data-list', mapping: { dictType: 'user.dictType' } })

    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(settingDictPlatformProductCapabilities.map(definition => [definition.id, `settingDictPlatformProduct.${SETTING_DICT_PLATFORM_PRODUCT_METHODS[definition.id as keyof typeof SETTING_DICT_PLATFORM_PRODUCT_METHODS]}`]))
    expect(validateAiContracts(contracts, { definitions: settingDictPlatformProductCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    broken['setting-dict-platform-product-data-create']!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: settingDictPlatformProductCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
