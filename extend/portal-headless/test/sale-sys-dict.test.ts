import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSaleSysDictCapability,
  SALE_SYS_DICT_ACTION_PERMISSION,
  SALE_SYS_DICT_METHODS,
  SALE_SYS_DICT_MODULE_TYPE,
  SALE_SYS_DICT_PAGE_PATH,
  SALE_SYS_DICT_PERMISSION,
  saleSysDictCapabilities,
} from '../src/capabilities/sale-sys-dict.js'
import { SALE_SYS_DICT_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-sys-dict.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleSysDictCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = {
  id: 'dict-1',
  value: '1',
  label: '蛋鸡户',
  type: 'customer_type',
  description: '客户性质',
  sort: 10,
  parentId: null,
  brandId: 0,
  itemId: 0,
  remarks: '备注',
  createDate: '2026-09-24 10:00:00',
  updateDate: '2026-09-24 10:00:01',
}
const form = {
  value: '1',
  label: '蛋鸡户',
  type: 'customer_type',
  description: '客户性质',
  sort: 10,
  remarks: '备注',
}

describe('Portal 系统设置 → 销售设置 → 字典配置', () => {
  it('逐页锁定菜单、CRM旧接口、筛选字段、弹窗规则、权限和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/sys/dict/list.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/sale/sys/dict/ModalFormContent.vue')

    expect(menu).toContain(`path: '${SALE_SYS_DICT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_SYS_DICT_PERMISSION}'`)
    for (const fragment of [
      "import { http as httpCrm } from 'app/portal/utils/http/crm.js'",
      "httpCrm.get('/vue/sys/dict/list'",
      "httpCrm.get('/vue/sys/dict/getDictTypeList'",
      "httpCrm.get('/vue/sys/dict/getMaxSort'",
      "httpCrm.post('/vue/sys/dict/save'",
      "httpCrm.delete(`/vue/sys/dict/${row.id}`",
      "permissionCheck('sys:dict:edit')",
      'getDataListIsPage: true',
      "label: ''",
      "type: ''",
      "description: ''",
      "dataIndex: 'value'",
      "dataIndex: 'sort'",
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "remarks: ''",
      'sort: 10',
      "description: ''",
      "type: ''",
      "label: ''",
      "value: ''",
      'required: false',
      "omit(row, ['updateDate', 'createDate'])",
    ]) expect(modal + list).toContain(fragment)
    expect(saleSysDictCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_SYS_DICT_METHODS))
    expect(saleSysDictCapabilities.every(item => item.pagePath === SALE_SYS_DICT_PAGE_PATH && item.permission === SALE_SYS_DICT_PERMISSION && item.moduleType === SALE_SYS_DICT_MODULE_TYPE && item.httpInstance === 'crm')).toBe(true)
    expect(resolveModuleType(SALE_SYS_DICT_PAGE_PATH).moduleType).toBe(SALE_SYS_DICT_MODULE_TYPE)
    expect(SALE_SYS_DICT_ACTION_PERMISSION).toBe('sys:dict:edit')
    expect(saleSysDictCapabilities.find(item => item.id === 'sale-sys-dict-list')?.params.map(item => item.name)).toEqual(['order', 'orderField', 'label', 'type', 'description', 'pageNo', 'pageSize'])
  })

  it('逐页锁定固定Java分支的/vue/sys/dict路由和字段证据', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const controller = read(javaRoot, 'erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/crm/modules/sys/controller/DictVueController.java')
    const entity = read(javaRoot, 'erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/crm/modules/sys/entity/Dict.java')
    for (const fragment of ['@RequestMapping(value = "${vuePath}/sys/dict")', '@GetMapping("list")', '@GetMapping("getDictTypeList")', '@GetMapping("getMaxSort")', '@PostMapping(value = "save")', '@DeleteMapping("{id}")']) expect(controller).toContain(fragment)
    for (const fragment of ['private String value', 'private String label', 'private String type', 'private String description', 'private Integer sort', 'private int brandId', 'private int itemId']) expect(entity).toContain(fragment)
  })

  it('按Portal请求形状覆盖列表、类型、最大排序、同一POST保存和单条删除', async () => {
    const f = fixture([{ list: [row], count: 1 }, ['customer_type'], 20, undefined, undefined, undefined])
    await expect(f.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({
      url: '/vue/sys/dict/list',
      method: 'get',
      params: { order: '', orderField: '', label: '', type: '', description: '', pageNo: 1, pageSize: 20 },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    await expect(f.api.typeList()).resolves.toEqual(['customer_type'])
    expect(f.calls[1]).toEqual({ url: '/vue/sys/dict/getDictTypeList', method: 'get', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    await expect(f.api.maxSort({ type: 'customer_type' })).resolves.toBe(20)
    expect(f.calls[2]).toEqual({ url: '/vue/sys/dict/getMaxSort', method: 'get', params: { type: 'customer_type' }, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const prepared = f.api.prepareCreate({ form })
    expect(prepared).toEqual({ draft: form })
    expect(f.calls).toHaveLength(3)
    await expect(f.api.create({ draft: prepared.draft })).resolves.toBeUndefined()
    expect(f.calls[3]).toEqual({ url: '/vue/sys/dict/save', method: 'post', data: form, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    const updated = f.api.prepareUpdate({ form: { ...row, updateDate: undefined, createDate: undefined, label: '修改后的标签' } })
    expect(updated.draft).toMatchObject({ id: 'dict-1', label: '修改后的标签' })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBeUndefined()
    expect(f.calls[4]).toMatchObject({ url: '/vue/sys/dict/save', method: 'post', data: expect.objectContaining({ id: 'dict-1', label: '修改后的标签' }), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })

    expect(f.api.prepareRemove({ id: 'dict-1' })).toEqual({ id: 'dict-1' })
    await expect(f.api.remove({ id: 'dict-1' })).resolves.toBeUndefined()
    expect(f.calls[5]).toEqual({ url: '/vue/sys/dict/dict-1', method: 'delete', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
  })

  it('表单、ID、分页和响应坏值在请求前失败，并保留后端错误', async () => {
    const f = fixture([])
    await expect(f.api.create({ draft: { ...form, sort: -1 } })).rejects.toThrow('sort')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    const invalidMaxSort = fixture(['not-a-number'])
    await expect(invalidMaxSort.api.maxSort({ type: 'x' })).rejects.toThrow()
    expect(() => f.api.prepareUpdate({ form })).toThrow('ID')
    expect(() => f.api.prepareRemove({ id: ' ' })).toThrow('字典配置ID')
    expect(f.calls).toHaveLength(0)

    const bad = fixture([new Error('权限不足')])
    await expect(bad.api.list()).rejects.toThrow('权限不足')
    const badResponse = fixture([{ list: [], count: '1' }])
    await expect(badResponse.api.list()).rejects.toThrow('有效count')
  })

  it('AI说明覆盖全部能力、表单提交链和删除回查，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_SYS_DICT_METHODS).sort())
    expect(contracts['sale-sys-dict-list']?.inputs.pageSize?.meaning).toContain('每页')
    expect(contracts['sale-sys-dict-create']?.boundaries.join(' ')).toContain('/vue/sys/dict/save')
    expect(contracts['sale-sys-dict-prepare-create']?.steps[0]).toMatchObject({ capabilityId: 'sale-sys-dict-create', mapping: { draft: 'result.draft' } })
    expect(contracts['sale-sys-dict-remove']?.steps[0]).toMatchObject({ capabilityId: 'sale-sys-dict-list' })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
