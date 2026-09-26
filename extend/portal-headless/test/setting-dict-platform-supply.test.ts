import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformSupplyCapability,
  SETTING_DICT_PLATFORM_SUPPLY_METHODS,
  SETTING_DICT_PLATFORM_SUPPLY_MODULE_TYPE,
  SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH,
  SETTING_DICT_PLATFORM_SUPPLY_PERMISSION,
  SETTING_DICT_PLATFORM_SUPPLY_SYSTEM,
  settingDictPlatformSupplyCapabilities,
} from '../src/capabilities/setting-dict-platform-supply.js'
import { SETTING_DICT_PLATFORM_SUPPLY_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform-supply.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformSupplyCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9007199254740993', name: '采购单据类型', type: 'supply_document_type', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 5, tenantEditable: 1 }
const dataRow = { id: '9007199254740994', sort: 1, label: '现货', value: 'spot', dictType: 'supply_document_type', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 42, platform: false }

describe('Portal 系统设置 → 采购字典', () => {
  it('逐页锁定采购路径、权限、useSystem、实例和实际动作边界', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const define = read(portalRoot, 'app/portal/utils/define.js')
    const supplyList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/supply/list.vue')
    const supplyDataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/supply/data/[type]/items.vue')
    const supplyDataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/supply/data/[type]/[mode]/[id].vue')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')
    const activeRoot = rootList.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '')

    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_SUPPLY_PERMISSION}'`)
    expect(supplyList).toContain('SYSTEM_SUPPLY_VALUE')
    expect(supplyList).toContain('<ListPage :useSystem="SYSTEM_SUPPLY_VALUE"/>')
    expect(supplyDataList).toContain('<ListPage :useSystem="SYSTEM_SUPPLY_VALUE"/>')
    expect(supplyDataForm).toContain('<FormPage :useSystem="SYSTEM_SUPPLY_VALUE"/>')
    expect(define).toContain('export const SYSTEM_SUPPLY_VALUE = 5')
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getDataListURL: '/admin-api/system/dict-type/page'",
      'getDataListIsPage: true',
      'name: \'\'',
      'type: \'\'',
      'router.push(`./data/${record.type}/items`)',
    ]) expect(rootList).toContain(fragment)
    const activeDataList = dataList.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '')
    for (const fragment of [
      "'/admin-api/system/dict-data/page'",
      'dictType: route.params.type',
      "label: ''",
      'status: undefined',
      'rrList.actionCreate($route.params.type)',
      'rrList.actionEdit(record, $route.params.type)',
      "url: '/admin-api/system/dict-data/delete'",
      ':disabled="record.platform"',
    ]) expect(dataList).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/dict-data/get'",
      'dictTypeId: route.params.type',
      "status: 0",
      "sort: 0",
      'dictType: bridge',
      "route.params.mode === 'edit' ? '/admin-api/system/dict-data/update' : '/admin-api/system/dict-data/create'",
      "{ required: true, message: '必填', trigger: 'blur' }",
    ]) expect(dataForm).toContain(fragment)

    expect(activeRoot).not.toContain('common-action-create')
    expect(activeRoot).not.toContain('common-action-delete')
    expect(activeDataList).not.toContain('deleteIsBatch: true')
    expect(dataList).not.toContain('exportURL')
    expect(dataList).not.toContain('导入')
    expect(dataList).not.toContain('导出')

    expect(settingDictPlatformSupplyCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_SUPPLY_METHODS))
    expect(settingDictPlatformSupplyCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_SUPPLY_PERMISSION && item.moduleType === SETTING_DICT_PLATFORM_SUPPLY_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(settingDictPlatformSupplyCapabilities.find(item => item.id === 'setting-dict-platform-supply-type-list')?.params.map(param => param.name)).not.toContain('useSystem')
    expect(resolveModuleType(SETTING_DICT_PLATFORM_SUPPLY_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 租户权限、字段、分页筛选与失败边界', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const typeController = read(root, 'controller/admin/dict/DictTypeController.java')
    const typePageReq = read(root, 'controller/admin/dict/vo/type/DictTypePageReqVO.java')
    const typeResp = read(root, 'controller/admin/dict/vo/type/DictTypeRespVO.java')
    const dataController = read(root, 'controller/admin/dict/DictDataController.java')
    const dataPageReq = read(root, 'controller/admin/dict/vo/data/DictDataPageReqVO.java')
    const dataResp = read(root, 'controller/admin/dict/vo/data/DictDataRespVO.java')
    const dataSaveReq = read(root, 'controller/admin/dict/vo/data/DictDataSaveReqVO.java')
    const dataService = read(root, 'service/dict/DictDataServiceImpl.java')
    const dataMapper = read(root, 'dal/mysql/dict/DictDataMapper.java')
    for (const fragment of ['@GetMapping("/page")', 'pageReqVO.setTenantEditable(1)', 'throw exception(DICT_TYPE_NO_PERMISSION)', 'export(HttpServletResponse response']) expect(typeController).toContain(fragment)
    for (const fragment of ['private String name', 'private String type', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typePageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private String name', 'private String type', 'private Integer status', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typeResp).toContain(fragment)
    for (const fragment of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping(value = "/get")', '@GetMapping("/export")']) expect(dataController).toContain(fragment)
    for (const fragment of ['private String label', 'private String dictType', 'private Integer status']) expect(dataPageReq).toContain(fragment)
    for (const fragment of ['private Long id', 'private Integer sort', 'private String label', 'private String value', 'private String dictType', 'private Integer status', 'private Long tenantId', 'getPlatform()']) expect(dataResp).toContain(fragment)
    for (const fragment of ['@NotNull(message = "显示顺序不能为空")', '@NotBlank(message = "字典标签不能为空")', '@NotBlank(message = "字典键值不能为空")', '@NotBlank(message = "字典类型不能为空")', '@InEnum(value = CommonStatusEnum.class']) expect(dataSaveReq).toContain(fragment)
    for (const fragment of ['requireCurrentTenantId()', 'validateTenantEditable(createReqVO.getDictType())', 'validateOwnedByTenant(existing, currentTenantId)', 'setTenantId(currentTenantId)']) expect(dataService).toContain(fragment)
    for (const fragment of ['in(DictDataDO::getTenantId, Arrays.asList(0L, currentTenantId))', 'selectPageByTenant', 'eqIfPresent(DictDataDO::getDictType, reqVO.getDictType())']) expect(dataMapper).toContain(fragment)
  })

  it('固定 useSystem=5 并复刻 Portal 的列表、详情、新增、编辑、单删请求', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '9007199254740995', true, true])
    await expect(f.api.list({ name: '采购', type: 'supply', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [typeRow], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: SETTING_DICT_PLATFORM_SUPPLY_SYSTEM, name: '采购', type: 'supply', pageNo: 2, pageSize: 50 } })
    await expect(f.api.dataList({ dictType: 'supply_document_type', label: '现货', status: 0, pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [dataRow], total: 1 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'supply_document_type', label: '现货', status: 0, pageNo: 1, pageSize: 20 } })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    expect(f.calls[2]).toEqual({ url: '/admin-api/system/dict-data/get', method: 'get', params: { id: dataRow.id } })
    await expect(f.api.dataCreate({ dictType: 'supply_document_type', label: '框架', value: 'framework' })).resolves.toBe('9007199254740995')
    expect(f.calls[3]).toEqual({ url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'supply_document_type', label: '框架', value: 'framework', status: 0, sort: 0, remark: '', dictType: 'supply_document_type' } })
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'supply_document_type', label: '现货2', value: 'spot2', sort: 2, status: 1, remark: '' })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/admin-api/system/dict-data/update', method: 'put', data: { id: dataRow.id, dictType: 'supply_document_type', label: '现货2', value: 'spot2', sort: 2, status: 1, remark: '' } })
    await expect(f.api.dataRemove({ id: dataRow.id, platform: false })).resolves.toBe(true)
    expect(f.calls[5]).toEqual({ url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: dataRow.id } })
  })

  it('反证：错误参数、平台行、坏响应和后端错误不会误报成功', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'supply_document_type', label: ' ', value: 'x' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'supply_document_type', label: '现货', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'supply_document_type', label: '现货', value: 'spot', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: dataRow.id, platform: true })).rejects.toThrow('只读')
    expect(f.calls).toHaveLength(0)

    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const badReceipt = fixture([false])
    await expect(badReceipt.api.dataRemove({ id: dataRow.id })).rejects.toThrow('响应不是true')
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI contract 覆盖六项能力、完整字段语义、写后回查和错误映射反证', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_SUPPLY_METHODS).sort())
    expect(contracts['setting-dict-platform-supply-type-list']?.boundaries).toEqual(expect.arrayContaining(['根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=5；页面 module-type 按当前规则表未命中，因此不发送该头。']))
    expect(contracts['setting-dict-platform-supply-type-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].useSystem', 'list[].tenantEditable', 'total']))
    expect(contracts['setting-dict-platform-supply-data-create']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-supply-data-list', mapping: { dictType: 'args.dictType' } })
    expect(contracts['setting-dict-platform-supply-data-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-supply-data-list', mapping: { dictType: 'user.dictType' } })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(settingDictPlatformSupplyCapabilities.map(definition => [definition.id, `settingDictPlatformSupply.${SETTING_DICT_PLATFORM_SUPPLY_METHODS[definition.id as keyof typeof SETTING_DICT_PLATFORM_SUPPLY_METHODS]}`]))
    expect(validateAiContracts(contracts, { definitions: settingDictPlatformSupplyCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    broken['setting-dict-platform-supply-data-create']!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: settingDictPlatformSupplyCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
