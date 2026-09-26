import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSaleSettingDictCapability,
  SALE_SETTING_DICT_METHODS,
  SALE_SETTING_DICT_MODULE_TYPE,
  SALE_SETTING_DICT_PAGE_PATH,
  SALE_SETTING_DICT_PERMISSION,
  saleSettingDictCapabilities,
} from '../src/capabilities/sale-setting-dict.js'
import { SALE_SETTING_DICT_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-setting-dict.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleSettingDictCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const row = { id: 7, dictName: '客户类型', dictType: 'customer_type', sort: 2, remark: '示例', createDate: '2026-09-23', updateDate: null }

describe('Portal 销售系统 → 配置数据', () => {
  it('逐页锁定菜单、列表、详情表单、子页导航、权限、实例和module-type', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/sale/setting/dict/list.vue')
    const form = read(portalRoot, 'app/portal/views/dashboard/sale/setting/dict/[mode]/[id].vue')

    expect(menu).toContain(`path: '${SALE_SETTING_DICT_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${SALE_SETTING_DICT_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/sale.js'",
      "getDataListURL: '/admin/dict/type/page'",
      "deleteURL: '/admin/dict/type'",
      'deleteIsBatch: true',
      "dictName: ''",
      "dictType: ''",
      "@click=\"() => nextLevel(record)\"",
      'router.push(`./data/${record.id}/items`)',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/sale.js'",
      "objectURL: '/admin/dict/type'",
      "dictName: ''",
      "dictType: ''",
      'sort: 0',
      "remark: ''",
      "{ required: true, message: '必填', trigger: 'blur' }",
      'v-model:value="rrForm.formState.sort"',
      ':min="0"',
    ]) expect(form).toContain(fragment)
    expect(saleSettingDictCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_SETTING_DICT_METHODS))
    expect(saleSettingDictCapabilities.every(item => item.pagePath === SALE_SETTING_DICT_PAGE_PATH && item.permission === SALE_SETTING_DICT_PERMISSION && item.moduleType === SALE_SETTING_DICT_MODULE_TYPE && item.httpInstance === 'sale')).toBe(true)
    expect(resolveModuleType(SALE_SETTING_DICT_PAGE_PATH).moduleType).toBe(SALE_SETTING_DICT_MODULE_TYPE)
  })

  it('逐页锁定CRM字典类型Controller、Service、DTO、Entity和逻辑删除', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const root = join(javaRoot, 'erp-module-crm/erp-module-crm-biz/src/main/java/com/wdbc/erp/module/crm/manage')
    const controller = read(root, 'modules/sys/controller/ManageSysDictTypeController.java')
    const service = read(root, 'service/impl/ManageSysDictTypeServiceImpl.java')
    const dto = read(root, 'modules/sys/dto/SysDictTypeDTO.java')
    const entity = read(root, 'modules/sys/entity/ManageSysDictTypeEntity.java')
    const mapper = read(root, 'mapper/sys/ManageSysDictTypeDao.java')
    for (const fragment of ['@RequestMapping("${sysPath}/dict/type")', '@GetMapping("page")', '@GetMapping("{id}")', '@PostMapping', '@PutMapping', '@DeleteMapping', 'Long[] ids']) expect(controller).toContain(fragment)
    for (const fragment of ['wrapper.like(StringUtils.isNotBlank(dictType), "type", dictType)', 'wrapper.like(StringUtils.isNotBlank(dictName), "name", dictName)', 'entity.setDeleted(false)', 'deleteBatchIds']) expect(service).toContain(fragment)
    for (const fragment of ['private Long id', 'private String dictType', 'private String dictName', 'private String remark', 'private Integer sort', '@NotBlank', '@Min(value = 0']) expect(dto).toContain(fragment)
    expect(entity).toContain('@TableName("system_dict_type")')
    expect(entity).toContain('deleted')
    expect(mapper).toContain('ManageSysDictTypeDao')
  })

  it('按Portal请求形状覆盖列表、详情、创建、更新和批量删除', async () => {
    const f = fixture([{ list: [row], total: 1 }, row, undefined, undefined, undefined])
    await expect(f.api.list({ dictName: '客户', dictType: 'customer', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/admin/dict/type/page', method: 'get', params: { order: '', orderField: '', dictName: '客户', dictType: 'customer', pageNo: 2, pageSize: 50 } })
    await expect(f.api.get({ id: '7' })).resolves.toEqual(row)
    expect(f.calls[1]).toEqual({ url: '/admin/dict/type/7', method: 'get' })
    await expect(f.api.create({ dictName: '订单类型', dictType: 'order_type' })).resolves.toBeUndefined()
    expect(f.calls[2]).toEqual({ url: '/admin/dict/type', method: 'post', data: { dictName: '订单类型', dictType: 'order_type', sort: 0, remark: '' } })
    await expect(f.api.update({ id: 7, dictName: '客户类型2', dictType: 'customer_type', sort: 3, remark: '' })).resolves.toBeUndefined()
    expect(f.calls[3]).toEqual({ url: '/admin/dict/type', method: 'put', data: { id: '7', dictName: '客户类型2', dictType: 'customer_type', sort: 3, remark: '' } })
    await expect(f.api.remove({ ids: [7, '7', 8] })).resolves.toBeUndefined()
    expect(f.calls[4]).toEqual({ url: '/admin/dict/type', method: 'delete', data: ['7', '8'] })
    const data = fixture([undefined])
    const prepared = data.api.prepareRemoveData({ ids: [9, '9', 10] })
    expect(prepared).toEqual({ draft: { ids: ['9', '10'] } })
    await expect(data.api.removeData(prepared)).resolves.toBeUndefined()
    expect(data.calls).toEqual([{ url: '/admin/dict/data', method: 'delete', data: ['9', '10'] }])
    expect(data.api.cancelRemoveData()).toEqual({ cancelled: true })
  })

  it('坏参数在请求前失败，后端权限或业务错误原样抛出', async () => {
    const f = fixture([])
    await expect(f.api.create({ dictName: ' ', dictType: 'valid' })).rejects.toThrow('dictName')
    await expect(f.api.create({ dictName: '有效', dictType: '' })).rejects.toThrow('dictType')
    await expect(f.api.create({ dictName: '有效', dictType: 'valid', sort: -1 })).rejects.toThrow('sort')
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    await expect(f.api.remove({ ids: [] })).rejects.toThrow('ids')
    expect(f.calls).toHaveLength(0)
    const denied = fixture([new Error('权限不足')])
    await expect(denied.api.list()).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖全部能力、字段语义和写后核实，结构契约通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_SETTING_DICT_METHODS).sort())
    expect(contracts['sale-setting-dict-list']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['list[].id', 'list[].dictType', 'list[].dictName', 'total']))
    expect(contracts['sale-setting-dict-remove']?.steps[0]).toMatchObject({ capabilityId: 'sale-setting-dict-list', mapping: { dictType: 'user.recordTypes' } })
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
