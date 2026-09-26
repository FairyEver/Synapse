import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingDictPlatformFinanceCapability,
  SETTING_DICT_PLATFORM_FINANCE_METHODS,
  SETTING_DICT_PLATFORM_FINANCE_MODULE_TYPE,
  SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH,
  SETTING_DICT_PLATFORM_FINANCE_PERMISSION,
  SETTING_DICT_PLATFORM_FINANCE_SYSTEM,
  settingDictPlatformFinanceCapabilities,
} from '../src/capabilities/setting-dict-platform-finance.js'
import { SETTING_DICT_PLATFORM_FINANCE_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-dict-platform-finance.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingDictPlatformFinanceCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const typeRow = { id: '9007199254740993', name: '财务单据类型', type: 'finance_document_type', status: 0, remark: null, createTime: '2026-09-25 10:00:00', useSystem: 2, tenantEditable: 1 }
const dataRow = { id: '9007199254740994', sort: 1, label: '收入', value: 'income', dictType: 'finance_document_type', status: 0, colorType: 'default', cssClass: '', remark: null, createTime: '2026-09-25 10:00:00', tenantId: 42, platform: false }

describe('Portal 系统设置 → 财务字典', () => {
  it('逐页锁定菜单、财务 wrapper、共享页面的真实动作边界和上下文', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const financeList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/finance/list.vue')
    const financeTypeForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/finance/[mode]/[id].vue')
    const financeDataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/finance/data/[type]/items.vue')
    const financeDataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/finance/data/[type]/[mode]/[id].vue')
    const rootList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/list.vue')
    const dataList = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue')
    const typeForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/[mode]/[id].vue')
    const dataForm = read(portalRoot, 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue')
    const activeRoot = rootList.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\/.*$/gm, '')

    expect(menu).toContain(`path: '${SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_DICT_PLATFORM_FINANCE_PERMISSION}'`)
    expect(financeList).toContain('SYSTEM_FINANCE_VALUE')
    expect(financeList).toContain('<ListPage :useSystem="SYSTEM_FINANCE_VALUE"/>')
    expect(financeTypeForm).toContain('<FormPage :useSystem="SYSTEM_FINANCE_VALUE"/>')
    expect(financeDataList).toContain("import ListPage from 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/items.vue'")
    expect(financeDataForm).toContain("import FormPage from 'app/portal/views/dashboard/common/setting/dict-platform/all/data/[type]/[mode]/[id].vue'")
    for (const fragment of [
      "getDataListURL: '/admin-api/system/dict-type/page'",
      "name: ''",
      "type: ''",
      'router.push(`./data/${record.type}/items`)',
      "import { http } from 'app/portal/utils/http/platform.js'",
    ]) expect(rootList).toContain(fragment)
    for (const fragment of [
      "'/admin-api/system/dict-data/page'",
      'dictType: route.params.type',
      "label: ''",
      'status: undefined',
      'rrList.actionCreate($route.params.type)',
      'rrList.actionEdit(record, $route.params.type)',
      'rrList.actionDelete(record)',
    ]) expect(dataList).toContain(fragment)
    expect(typeForm).toContain("http.put('/admin-api/system/dict-type/update', form)")
    expect(typeForm).toContain("http.post('/admin-api/system/dict-type/create', form)")
    expect(dataForm).toContain("'/admin-api/system/dict-data/get'")
    expect(dataForm).toContain("route.params.mode === 'edit' ? '/admin-api/system/dict-data/update' : '/admin-api/system/dict-data/create'")
    expect(dataForm).toContain('dictType: bridge')

    // These strings exist only inside commented-out root-page controls; the active UI has no such actions.
    expect(activeRoot).not.toContain('deleteIsBatch: true')
    expect(activeRoot).not.toContain('common-action-create')
    expect(activeRoot).not.toContain('common-action-delete')
    expect(rootList).not.toContain('导入')
    expect(rootList).not.toContain('导出')
    expect(dataList).not.toContain('deleteIsBatch')
    expect(dataList).not.toContain('导入')
    expect(dataList).not.toContain('导出')

    expect(settingDictPlatformFinanceCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_DICT_PLATFORM_FINANCE_METHODS))
    expect(settingDictPlatformFinanceCapabilities.every(item => item.pagePath === SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH && item.permission === SETTING_DICT_PLATFORM_FINANCE_PERMISSION && item.moduleType === SETTING_DICT_PLATFORM_FINANCE_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(settingDictPlatformFinanceCapabilities.find(item => item.id === 'setting-dict-platform-finance-type-list')?.params.map(param => param.name)).not.toContain('useSystem')
    expect(resolveModuleType(SETTING_DICT_PLATFORM_FINANCE_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定租户 Java Controller、Service 和 tenant 数据范围', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const typeController = read(root, 'controller/admin/dict/DictTypeController.java')
    const dataController = read(root, 'controller/admin/dict/DictDataController.java')
    const typeService = read(root, 'service/dict/DictTypeServiceImpl.java')
    const dataService = read(root, 'service/dict/DictDataServiceImpl.java')
    const dataMapper = read(root, 'dal/mysql/dict/DictDataMapper.java')
    for (const fragment of ['@RequestMapping("/system/dict-type")', 'pageReqVO.setTenantEditable(1)', 'throw exception(DICT_TYPE_NO_PERMISSION)', '@GetMapping("/page")', '@GetMapping(value = "/get")', '@GetMapping("/export")']) expect(typeController).toContain(fragment)
    for (const fragment of ['@RequestMapping("/system/dict-data")', 'createTenantDictData', 'updateTenantDictData', 'deleteTenantDictData', '@GetMapping("/page")', '@GetMapping(value = "/get")', '@GetMapping("/export")']) expect(dataController).toContain(fragment)
    for (const fragment of ['validateDictTypeNameUnique', 'validateDictTypeUnique', 'deleteDictType']) expect(typeService).toContain(fragment)
    for (const fragment of ['requireCurrentTenantId()', 'validateTenantEditable(createReqVO.getDictType())', 'validateOwnedByTenant(existing, currentTenantId)', 'getTenantDictDataPage']) expect(dataService).toContain(fragment)
    for (const fragment of ['selectPageByTenant', 'Arrays.asList(0L, currentTenantId)', 'selectPagePlatform']) expect(dataMapper).toContain(fragment)
  })

  it('固定财务系统筛选并复刻列表、详情、创建、更新、单条删除请求', async () => {
    const f = fixture([{ list: [typeRow], total: 1 }, { list: [dataRow], total: 1 }, dataRow, '9007199254740995', true, true])
    await expect(f.api.list({ name: '财务', type: 'finance', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [typeRow], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin-api/system/dict-type/page', method: 'get', params: { order: '', orderField: '', useSystem: SETTING_DICT_PLATFORM_FINANCE_SYSTEM, name: '财务', type: 'finance', pageNo: 2, pageSize: 50 } })
    await expect(f.api.dataList({ dictType: 'finance_document_type', label: '收入', status: 0, pageNo: 1, pageSize: 20 })).resolves.toEqual({ list: [dataRow], total: 1 })
    expect(f.calls[1]).toEqual({ url: '/admin-api/system/dict-data/page', method: 'get', params: { order: '', orderField: '', dictType: 'finance_document_type', label: '收入', status: 0, pageNo: 1, pageSize: 20 } })
    await expect(f.api.dataGet({ id: dataRow.id })).resolves.toEqual(dataRow)
    expect(f.calls[2]).toEqual({ url: '/admin-api/system/dict-data/get', method: 'get', params: { id: dataRow.id } })
    await expect(f.api.dataCreate({ dictType: 'finance_document_type', label: '支出', value: 'expense' })).resolves.toBe('9007199254740995')
    expect(f.calls[3]).toEqual({ url: '/admin-api/system/dict-data/create', method: 'post', data: { id: '', dictTypeId: 'finance_document_type', label: '支出', value: 'expense', status: 0, sort: 0, remark: '', dictType: 'finance_document_type' } })
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'finance_document_type', label: '收入2', value: 'income2', sort: 2, status: 1, remark: '' })).resolves.toBe(true)
    expect(f.calls[4]).toEqual({ url: '/admin-api/system/dict-data/update', method: 'put', data: { id: dataRow.id, dictType: 'finance_document_type', label: '收入2', value: 'income2', sort: 2, status: 1, remark: '' } })
    await expect(f.api.dataRemove({ id: dataRow.id, platform: false })).resolves.toBe(true)
    expect(f.calls[5]).toEqual({ url: '/admin-api/system/dict-data/delete', method: 'delete', params: { id: dataRow.id } })
  })

  it('坏参数、平台行和坏响应在请求前或回执处失败；后端错误原样抛出', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.dataList({ dictType: ' ' })).rejects.toThrow('dictType')
    await expect(f.api.dataCreate({ dictType: 'finance_document_type', label: ' ', value: 'x' })).rejects.toThrow('label')
    await expect(f.api.dataCreate({ dictType: 'finance_document_type', label: '收入', value: '', sort: -1 })).rejects.toThrow('value')
    await expect(f.api.dataUpdate({ id: dataRow.id, dictType: 'finance_document_type', label: '收入', value: 'income', platform: true })).rejects.toThrow('只读')
    await expect(f.api.dataRemove({ id: dataRow.id, platform: true })).rejects.toThrow('只读')
    expect(f.calls).toHaveLength(0)

    const malformed = fixture([{ list: [], total: -1 }])
    await expect(malformed.api.list()).rejects.toThrow('有效list或total')
    const badReceipt = fixture([false])
    await expect(badReceipt.api.dataRemove({ id: dataRow.id })).rejects.toThrow('响应不是true')
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖全部能力、绑定方法并在关键映射损坏时变红', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_DICT_PLATFORM_FINANCE_METHODS).sort())
    expect(contracts['setting-dict-platform-finance-type-list']?.boundaries).toEqual(expect.arrayContaining(['根列表使用 platform HTTP 实例和 /admin-api/system/dict-type/page，自动固定 useSystem=2；页面 module-type 按规则表未命中，因此不发送该头。']))
    expect(contracts['setting-dict-platform-finance-data-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-dict-platform-finance-data-list', mapping: { dictType: 'user.dictType' } })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>, options?: Record<string, unknown>) => unknown[] }
    const bindings = new Map(settingDictPlatformFinanceCapabilities.map(definition => [definition.id, `settingDictPlatformFinance.${SETTING_DICT_PLATFORM_FINANCE_METHODS[definition.id as keyof typeof SETTING_DICT_PLATFORM_FINANCE_METHODS]}`]))
    expect(validateAiContracts(contracts, { definitions: settingDictPlatformFinanceCapabilities, bindings })).toEqual([])
    const broken = structuredClone(contracts)
    broken['setting-dict-platform-finance-type-list']!.steps[0]!.mapping!.dictType = 'result.list[].missingType'
    expect(validateAiContracts(broken, { definitions: settingDictPlatformFinanceCapabilities, bindings })).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'unknown-source-field' })]))
  })
})
