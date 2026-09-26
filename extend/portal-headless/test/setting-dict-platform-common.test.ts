import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformCommonCapability,
  SETTING_DICT_PLATFORM_COMMON_METHODS,
  SETTING_DICT_PLATFORM_COMMON_MODULE_TYPE,
  SETTING_DICT_PLATFORM_COMMON_PAGE_PATH,
  SETTING_DICT_PLATFORM_COMMON_PERMISSION,
  settingDictPlatformCommonCapabilities,
} from '../src/capabilities/setting-dict-platform-common.js'
import { SETTING_DICT_PLATFORM_COMMON_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform-common.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformCommonCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function withoutHtmlComments (value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, '')
}

const typeRow = { id: '1001', name: '性别', type: 'sys_common_sex', status: 0, remark: null, createTime: '2026-09-23 10:00:00', useSystem: 0, tenantEditable: 1 }
const dataRow = { id: '2001', sort: 1, label: '男', value: '1', dictType: 'sys_common_sex', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-23 10:00:00', tenantId: '8', platform: false }

describe('Portal 系统设置 → 公共字典页面能力', () => {
  it('逐页锁定公共路径、固定系统值、筛选、实例、权限和实际按钮', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const wrapper = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/common/list.vue')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/list.vue')
    const dataWrapper = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/common/data/[type]/items.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')

    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_COMMON_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_COMMON_PERMISSION}'`)
    expect(wrapper).toContain('<ListPage :useSystem="SYSTEM_COMMON_VALUE"/>')
    expect(dataWrapper).toContain('<ListPage :useSystem="SYSTEM_COMMON_VALUE"/>')
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getDataListURL: '/admin-api/system/dict-type/page'",
      'getDataListIsPage: true',
      "name: ''",
      "type: ''",
      '@click="() => nextLevel(record)"',
      'router.push(`./data/${record.type}/items`)',
    ]) expect(rootList).toContain(fragment)
    const activeRoot = withoutHtmlComments(rootList)
    expect(activeRoot).not.toContain('rrList.actionCreate(')
    expect(activeRoot).not.toContain('rrList.actionEdit(')
    expect(activeRoot).not.toContain('rrList.actionDelete(')
    for (const fragment of [
      "customLoad: async form =>",
      "'/admin-api/system/dict-data/page'",
      'dictType: route.params.type',
      "label: ''",
      'status: undefined',
      "url: '/admin-api/system/dict-data/delete'",
      ':disabled="record.platform"',
      'rrList.actionCreate($route.params.type)',
      'rrList.actionEdit(record, $route.params.type)',
    ]) expect(dataList).toContain(fragment)
    expect(dataList).not.toContain('deleteIsBatch: true')
    expect(dataList).not.toContain('exportURL')
    for (const fragment of [
      "'/admin-api/system/dict-data/get'",
      'dictTypeId: route.params.type',
      "status: 0",
      "sort: 0",
      "dictType: bridge",
      "url: route.params.mode === 'edit' ? '/admin-api/system/dict-data/update' : '/admin-api/system/dict-data/create'",
      "{ required: true, message: '必填', trigger: 'blur' }",
    ]) expect(dataForm).toContain(fragment)
    expect(settingDictPlatformCommonCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_COMMON_METHODS))
    expect(settingDictPlatformCommonCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_COMMON_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_COMMON_PERMISSION && item.moduleType === SETTING_DICT_PLATFORM_COMMON_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_DICT_PLATFORM_COMMON_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定 Java 租户权限、字段、筛选与提交规则', () => {
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

  it('按 Portal 实际请求形状覆盖筛选、分页、详情、新增、编辑和单条删除', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '2002', true, true])
    await expect(f.api.list()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.dataList({ dictType: 'sys_common_sex' })).resolves.toEqual({ list: [dataRow], total: 1 })
    await expect(f.api.dataGet({ id: '2001' })).resolves.toEqual(dataRow)
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '2' })).resolves.toBe('2002')
    await expect(f.api.dataUpdate({ id: '2001', dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', platform: false })).resolves.toBe(true)
    await expect(f.api.dataRemove({ id: '2001', platform: false })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: 0, name: '', type: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'sys_common_sex', label: '', status: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/dict-data/get', method: 'get', params: { id: '2001' } },
      { url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'sys_common_sex', label: '女', value: '2', status: 0, sort: 0, remark: '', dictType: 'sys_common_sex' } },
      { url: '/admin-api/system/dict-data/update', method: 'put', data: { id: '2001', dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', platform: false } },
      { url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: '2001' } },
    ])
  })

  it('反证：坏参数、平台共享写入、坏响应和后端错误均不能伪装成功', async () => {
    const f = fixture([])
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: ' ', value: '1' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: '2001', dictType: 'sys_common_sex', label: '女', value: '2', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: '2001', platform: true })).rejects.toThrow('只读')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const denied = fixture([new Error('DICT_TYPE_NO_PERMISSION')])
    await expect(denied.api.list()).rejects.toThrow('DICT_TYPE_NO_PERMISSION')
  })

  it('AI 说明覆盖实际六项能力、字段语义、映射和写后回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_COMMON_METHODS).sort())
    expect(contracts['setting-dict-platform-common-type-list']?.inputs).not.toHaveProperty('useSystem')
    expect(contracts['setting-dict-platform-common-type-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].type', 'list[].useSystem', 'total']))
    expect(contracts['setting-dict-platform-common-data-create']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-common-data-list', mapping: { dictType: 'args.dictType' } })
    expect(contracts['setting-dict-platform-common-data-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-common-data-list', mapping: { dictType: 'user.dictType' } })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(settingDictPlatformCommonCapabilities.map(definition => [definition.id, `settingDictPlatformCommon.${SETTING_DICT_PLATFORM_COMMON_METHODS[definition.id as keyof typeof SETTING_DICT_PLATFORM_COMMON_METHODS]}`]))
    expect(validateAiContracts(contracts, { definitions: settingDictPlatformCommonCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    broken['setting-dict-platform-common-data-create']!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: settingDictPlatformCommonCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
