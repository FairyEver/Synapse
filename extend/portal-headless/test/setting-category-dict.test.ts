import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSettingCategoryDictCapability,
  SETTING_CATEGORY_DICT_METHODS,
  SETTING_CATEGORY_DICT_MODULE_TYPE,
  SETTING_CATEGORY_DICT_PAGE_PATH,
  SETTING_CATEGORY_DICT_PERMISSION,
  settingCategoryDictCapabilities,
} from '../src/capabilities/setting-category-dict.js'
import { SETTING_CATEGORY_DICT_AI_CONTRACTS as contracts } from '../src/catalog/contracts-setting-category-dict.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSettingCategoryDictCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const tree = [{
  id: '100', pid: 0, name: '业务分类', code: 'business', tenantId: 0, platform: true, tenantEditable: 1,
  createTime: '2026-09-23 09:00:00', children: [{
    id: '101', pid: '100', name: '采购分类', code: null, tenantId: '7', platform: false, tenantEditable: 0,
    createTime: null, children: [],
  }],
}]

describe('Portal 门户系统设置 → 分类字典', () => {
  it('逐页锁定菜单、树查询、弹窗/行内表单、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/common.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/hr/setting/category-dict/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/hr/setting/category-dict/components/ModalForm.vue')

    expect(menu).toContain(`path: '${SETTING_CATEGORY_DICT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SETTING_CATEGORY_DICT_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/platform.js'",
      "getDataListURL: '/admin-api/system/category-dict/tree'",
      "deleteURL: '/admin-api/system/category-dict/delete'",
      'onlyTenantEditable: true',
      'rrList.convertList',
      'rrList.actionDelete(record)',
      "http.post('/admin-api/system/category-dict/create'",
      "http.put('/admin-api/system/category-dict/update'",
      'record.pid !== 0 && !record.platform',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'name: [{ required: true, message: \'请输入名称\' }]',
      'v-model:value="formState.pid"',
      'v-model:value="formState.name"',
      'v-model:value="formState.code"',
      "modalEmit('submit', formState.value)",
    ]) expect(modal).toContain(fragment)
    expect(settingCategoryDictCapabilities.map(item => item.id)).toEqual(Object.keys(SETTING_CATEGORY_DICT_METHODS))
    expect(settingCategoryDictCapabilities.every(item => item.pagePath === SETTING_CATEGORY_DICT_PAGE_PATH && item.permission === SETTING_CATEGORY_DICT_PERMISSION && item.moduleType === SETTING_CATEGORY_DICT_MODULE_TYPE && item.httpInstance === 'platform')).toBe(true)
    expect(resolveModuleType(SETTING_CATEGORY_DICT_PAGE_PATH).moduleType).toBeNull()
  })

  it('逐页锁定Java Controller、VO、Service、Mapper的租户权限和表单约束', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-system/erp-module-system-biz/src/main/java/com/wdbc/erp/module/system')
    const controller = read(root, 'controller/admin/categorydict/CategoryDictController.java')
    const listVo = read(root, 'controller/admin/categorydict/vo/CategoryDictListReqVO.java')
    const saveVo = read(root, 'controller/admin/categorydict/vo/CategoryDictSaveReqVO.java')
    const responseVo = read(root, 'controller/admin/categorydict/vo/CategoryDictRespVO.java')
    const service = read(root, 'service/categorydict/CategoryDictServiceImpl.java')
    const mapper = read(root, 'dal/mysql/categorydict/CategoryDictMapper.java')
    for (const fragment of ['@PostMapping("/create")', '@PutMapping("/update")', '@DeleteMapping("/delete/{id}")', '@GetMapping("/tree")', 'getTenantCategoryDictList']) expect(controller).toContain(fragment)
    for (const fragment of ['private Boolean onlyTenantEditable', 'private Long pid', 'private String name', 'private String code']) expect(listVo).toContain(fragment)
    for (const fragment of ['@NotNull(message = "父级id不能为空")', '@NotEmpty(message = "字典名称不能为空")', 'private Long pid', 'private String name', 'private String code']) expect(saveVo).toContain(fragment)
    for (const fragment of ['private Long id', 'private Long pid', 'private String name', 'private String code', 'private Long tenantId', 'private Boolean platform', 'private Integer tenantEditable', 'private LocalDateTime createTime']) expect(responseVo).toContain(fragment)
    for (const fragment of ['createTenantCategoryDict', 'updateTenantCategoryDict', 'deleteTenantCategoryDict', 'requireCurrentTenantId()', 'validateRootTenantEditable', 'setTenantEditable(0)', 'CATEGORY_DICT_ROOT_FORBIDDEN_FOR_TENANT', 'CATEGORY_DICT_ROOT_NOT_TENANT_EDITABLE', 'selectCountByPidAndTenant']) expect(service).toContain(fragment)
    for (const fragment of ['selectExportPage', 'selectListByTenant', 'getTenantId', 'getTenantEditable']) expect(mapper).toContain(fragment)
  })

  it('按Portal请求形状覆盖非分页树、创建、修改和单项删除', async () => {
    const f = fixture([tree, '102', true, true])
    await expect(f.api.list()).resolves.toEqual(tree)
    expect(f.calls[0]).toEqual({
      url: '/admin-api/system/category-dict/tree', method: 'get',
      params: { order: '', orderField: '', name: '', code: '', onlyTenantEditable: true },
    })
    await expect(f.api.create({ pid: '100', name: '采购分类', code: null })).resolves.toBe('102')
    expect(f.calls[1]).toEqual({ url: '/admin-api/system/category-dict/create', method: 'post', data: { pid: '100', name: '采购分类', code: null } })
    await expect(f.api.update({ id: '101', pid: '100', name: '采购子类', code: 'purchase' })).resolves.toBe(true)
    expect(f.calls[2]).toEqual({ url: '/admin-api/system/category-dict/update', method: 'put', data: { id: '101', pid: '100', name: '采购子类', code: 'purchase' } })
    await expect(f.api.remove('101')).resolves.toBe(true)
    expect(f.calls[3]).toEqual({ url: '/admin-api/system/category-dict/delete/101', method: 'delete' })
  })

  it('坏参数、坏树和后端权限错误在请求前/原样失败', async () => {
    const f = fixture([])
    await expect(f.api.create({ pid: 0, name: '根' })).rejects.toThrow('pid')
    await expect(f.api.create({ pid: 100, name: '' })).rejects.toThrow('name')
    await expect(f.api.update({ id: 0, pid: 100, name: '子' })).rejects.toThrow('id')
    await expect(f.api.list({ onlyTenantEditable: 'true' as unknown as boolean })).rejects.toThrow('onlyTenantEditable')
    await expect(f.api.remove(0)).rejects.toThrow('id')
    expect(f.calls).toHaveLength(0)
    const malformed = fixture([[{ id: 1, pid: 0, name: '根', children: [{ id: 2, pid: 1, name: '子', children: 'bad' }] }]])
    await expect(malformed.api.list()).rejects.toThrow('children')
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖全部动作、字段语义和写后核实，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SETTING_CATEGORY_DICT_METHODS).sort())
    expect(contracts['setting-category-dict-list']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['[].id', '[].children', '[].tenantEditable']))
    expect(contracts['setting-category-dict-remove']?.steps[0]).toMatchObject({ capabilityId: 'setting-category-dict-list' })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
