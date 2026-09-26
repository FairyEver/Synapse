import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformCapability,
  SETTING_DICT_PLATFORM_METHODS,
  SETTING_DICT_PLATFORM_MODULE_TYPE,
  SETTING_DICT_PLATFORM_PAGE_PATH,
  SETTING_DICT_PLATFORM_PERMISSION,
  settingDictPlatformCapabilities,
} from '../src/capabilities/setting-dict-platform.js'
import { SETTING_DICT_PLATFORM_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: 11, name: '性别', type: 'sys_common_sex', status: 0, remark: null, createTime: '2026-09-23 10:00:00', useSystem: 0, tenantEditable: 1 }
const dataRow = { id: 21, sort: 1, label: '男', value: '1', dictType: 'sys_common_sex', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-23 10:00:00', tenantId: 8, platform: false }

describe('Portal 系统设置 → 字典管理页面能力', () => {
  it('逐页锁定根页、子页、表单、权限、platform实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')

    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getDataListURL: '/admin-api/system/dict-type/page'",
      'getDataListIsPage: true',
      "name: ''",
      "type: ''",
      '@click="() => nextLevel(record)"',
      'router.push(`./data/${record.type}/items`)',
      'async function actionSave',
      'const isDev = import.meta.env.VITE_API_ENV_NAME === \'dev\'',
    ]) expect(rootList).toContain(fragment)
    for (const fragment of [
      "customLoad: async form =>",
      "'/admin-api/system/dict-data/page'",
      'dictType: route.params.type',
      "label: ''",
      'status: undefined',
      "url: '/admin-api/system/dict-data/delete'",
      ':disabled="record.platform"',
      'rrList.actionCreate($route.params.type)',
    ]) expect(dataList).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/dict-data/get'",
      'dictTypeId: route.params.type',
      "status: 0",
      "sort: 0",
      "dictType: bridge",
      "url: route.params.mode === 'edit' ? '/admin-api/system/dict-data/update' : '/admin-api/system/dict-data/create'",
      "{ required: true, message: '必填', trigger: 'blur' }",
    ]) expect(dataForm).toContain(fragment)
    expect(settingDictPlatformCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_METHODS))
    expect(settingDictPlatformCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_PERMISSION && item.moduleType === SETTING_DICT_PLATFORM_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_DICT_PLATFORM_PAGE_PATH).moduleType).toBe(SETTING_DICT_PLATFORM_MODULE_TYPE)
  })

  it('逐页锁定字典类型/字典数据 Java 权限、表单校验和租户范围', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const typeController = read(root, 'controller/admin/dict/DictTypeController.java')
    const typePageReq = read(root, 'controller/admin/dict/vo/type/DictTypePageReqVO.java')
    const dataController = read(root, 'controller/admin/dict/DictDataController.java')
    const dataSaveReq = read(root, 'controller/admin/dict/vo/data/DictDataSaveReqVO.java')
    const dataService = read(root, 'service/dict/DictDataServiceImpl.java')
    const dataMapper = read(root, 'dal/mysql/dict/DictDataMapper.java')
    expect(typeController).toContain('@RequestMapping("/system/dict-type")')
    expect(typeController).toContain('pageReqVO.setTenantEditable(1)')
    expect(typeController).toContain('throw exception(DICT_TYPE_NO_PERMISSION)')
    for (const fragment of ['private String name', 'private String type', 'private Integer useSystem', 'private Integer tenantEditable']) expect(typePageReq).toContain(fragment)
    for (const fragment of ['@RequestMapping("/system/dict-data")', '@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete")', '@GetMapping("/page")', '@GetMapping(value = "/get")']) expect(dataController).toContain(fragment)
    for (const fragment of ['@NotNull(message = "显示顺序不能为空")', '@NotBlank(message = "字典标签不能为空")', '@NotBlank(message = "字典键值不能为空")', '@NotBlank(message = "字典类型不能为空")', '@InEnum(value = CommonStatusEnum.class']) expect(dataSaveReq).toContain(fragment)
    for (const fragment of ['requireCurrentTenantId()', 'validateTenantEditable(createReqVO.getDictType())', 'validateOwnedByTenant(existing, currentTenantId)', 'setTenantId(currentTenantId)']) expect(dataService).toContain(fragment)
    for (const fragment of ['in(DictDataDO::getTenantId, Arrays.asList(0L, currentTenantId))', 'selectPageByTenant', 'eqIfPresent(DictDataDO::getDictType, reqVO.getDictType())']) expect(dataMapper).toContain(fragment)
  })

  it('按 Portal 实际请求形状覆盖根列表、子页分页、详情、创建、更新和删除', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, 22, true, true])
    await expect(f.api.list()).resolves.toEqual({ list: [typeRow], total: 1 })
    await expect(f.api.dataList({ dictType: 'sys_common_sex' })).resolves.toEqual({ list: [dataRow], total: 1 })
    await expect(f.api.dataGet({ id: '21' })).resolves.toEqual(dataRow)
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '2' })).resolves.toBe(22)
    await expect(f.api.dataUpdate({ id: 21, dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', platform: false })).resolves.toBe(true)
    await expect(f.api.dataRemove({ id: 21, platform: false })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', name: '', type: '', pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'sys_common_sex', label: '', status: undefined, pageNo: 1, pageSize: 20 } },
      { url: '/admin-api/system/dict-data/get', method: 'get', params: { id: '21' } },
      { url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'sys_common_sex', label: '女', value: '2', status: 0, sort: 0, remark: '', dictType: 'sys_common_sex' } },
      { url: '/admin-api/system/dict-data/update', method: 'put', data: { id: 21, dictType: 'sys_common_sex', label: '男', value: '1', sort: 2, status: 0, remark: '', platform: false } },
      { url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: 21 } },
    ])
  })

  it('按 Portal 表单和权限规则在请求前拒绝坏参数及平台数据写入', async () => {
    const f = fixture([])
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: ' ', value: '1' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'sys_common_sex', label: '女', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: 21, dictType: 'sys_common_sex', label: '女', value: '2', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: 21, platform: true })).rejects.toThrow('只读')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
  })

  it('AI说明覆盖全部能力、字段语义、父子映射和写后核实，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_METHODS).sort())
    expect(contracts['setting-dict-type-list']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].type', 'total']))
    expect(contracts['setting-dict-data-create']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-data-list', mapping: { dictType: 'args.dictType' } })
    expect(contracts['setting-dict-data-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-data-list' })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
