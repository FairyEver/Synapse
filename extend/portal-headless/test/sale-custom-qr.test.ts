import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PortalRequest } from '../src/session/types.js'
import { resolveModuleType } from '../src/context/module-type.js'
import {
  createSaleCustomQrCapability,
  SALE_CUSTOM_QR_METHODS,
  SALE_CUSTOM_QR_MODULE_TYPE,
  SALE_CUSTOM_QR_PAGE_PATH,
  SALE_CUSTOM_QR_PERMISSION,
  saleCustomQrCapabilities,
} from '../src/capabilities/sale-custom-qr.js'
import { SALE_CUSTOM_QR_AI_CONTRACTS as contracts } from '../src/catalog/contracts-sale-custom-qr.js'

type RequestConfig = Parameters<PortalRequest>[0]

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createSaleCustomQrCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

const supplier = {
  tenantId: 'tenant-1',
  tenantName: '供应商甲',
  shopId: 2,
  shopName: '甲店',
  itemKindNum: 3,
  updateTime: '2026-09-25 10:00:00',
}

const itemKind = {
  itemKind: '3001',
  itemKindName: '蛋鸡',
  num: 2,
  updateTime: '2026-09-25 10:01:00',
}

const field = {
  id: 'field-1',
  shopId: 2,
  itemKind: '3001',
  field: 'order_no',
  fieldName: '订单号',
  fieldType: 'order',
  fieldTypeName: '订单信息',
  sort: 1,
}

describe('Portal 销售设置 → 二维码管理', () => {
  it('逐页锁定菜单、CRM实例、三层下钻和页面元数据', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const menu = read(portalRoot, 'app/portal/menus/sale.js')
    const page = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/list.vue')
    const supplierView = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/ViewSupplierList.vue')
    const itemKindView = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/ViewQrList.vue')
    const fieldView = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/ViewKeyList.vue')
    const modal = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/ModalFormContent.vue')
    const api = read(portalRoot, 'app/portal/views/dashboard/sale/custom/qr/api/qr.js')

    expect(menu).toContain(`{ title: '二维码管理', path: '${SALE_CUSTOM_QR_PAGE_PATH}', permission: '${SALE_CUSTOM_QR_PERMISSION}' }`)
    expect(page).toContain("import ViewSupplierList from './ViewSupplierList.vue'")
    expect(page).toContain("import ViewQrList from './ViewQrList.vue'")
    expect(page).toContain("import ViewKeyList from './ViewKeyList.vue'")
    for (const fragment of [
      "import { http as httpCrm } from 'app/portal/utils/http/crm.js'",
      "httpCrm({\n    url: '/vue/config/codeOrder/shopSumPage'",
      "httpCrm({\n    url: '/vue/config/codeOrder/itemKindSumList'",
      "httpCrm({\n    url: '/vue/config/codeOrder/list'",
      "httpCrm({\n    url: '/vue/config/codeOrder/save'",
      "httpCrm({\n    url: `/vue/config/codeOrder/${id}`",
      "httpCrm({\n    url: '/vue/sys/dict/listData'",
    ]) expect(api).toContain(fragment)
    for (const fragment of [
      'styleV2: true',
      'getDataListIsPage: true',
      "fieldNamePageNo: 'pageNo'",
      "fieldNamePageSize: 'pageSize'",
      "form: {\n    tenantName: ''",
      'configCodeOrderShopSumPage(params)',
      "emit('detail', row)",
    ]) expect(supplierView).toContain(fragment)
    for (const fragment of [
      'getDataListIsPage: false',
      'configCodeOrderItemKindSumList({',
      'shopId: props.shopId',
      "emit('edit', row)",
    ]) expect(itemKindView).toContain(fragment)
    for (const fragment of [
      'configCodeOrderList({',
      'shopId: props.shopId',
      'itemKind: props.itemKind',
      'configCodeOrderDelete({',
      'const usedSort = rrList.propsForTable.dataSource.map(item => item.sort)',
      '.filter(item => item !== row.sort)',
      "mode: 'create'",
      "mode: 'edit'",
    ]) expect(fieldView).toContain(fragment)
    for (const fragment of [
      "import { configCodeOrderSave, dictListData } from './api/qr.js'",
      ':disabled="mode === \'edit\'"',
      'props.usedSort.includes(value)',
      "Math.max(...props.usedSort) + 1 : 1",
      'id: null',
      "dictListData('order_field')",
      "case 'order':",
      "case 'item':",
    ]) expect(modal).toContain(fragment)

    expect(saleCustomQrCapabilities.map(item => item.id)).toEqual(Object.keys(SALE_CUSTOM_QR_METHODS))
    expect(saleCustomQrCapabilities.every(item => item.pagePath === SALE_CUSTOM_QR_PAGE_PATH && item.permission === SALE_CUSTOM_QR_PERMISSION && item.moduleType === SALE_CUSTOM_QR_MODULE_TYPE && item.httpInstance === 'crm')).toBe(true)
    expect(resolveModuleType(SALE_CUSTOM_QR_PAGE_PATH).moduleType).toBe(SALE_CUSTOM_QR_MODULE_TYPE)
    expect(api).not.toContain('permissionCheck(')
    expect(saleCustomQrCapabilities.every(item => !('actionPermission' in item))).toBe(true)
  })

  it('逐页锁定Java路由、租户回退、字段类型和持久化证据', () => {
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const configRoot = 'erp-module-crm/erp-module-crm-biz/src/main'
    const controller = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/config/controller/ConfigCodeOrderController.java`)
    const service = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/config/service/ConfigCodeOrderService.java`)
    const entity = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/config/entity/ConfigCodeOrder.java`)
    const dto = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/config/dto/ConfigCodeOrderDTO.java`)
    const mapper = read(javaRoot, `${configRoot}/resources/mapper/crm/config/ConfigCodeOrderDao.xml`)
    const dictController = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/sys/controller/DictVueController.java`)
    const dictService = read(javaRoot, `${configRoot}/java/com/wdbc/erp/module/crm/crm/modules/sys/service/DictService.java`)
    const dictMapper = read(javaRoot, `${configRoot}/resources/mapper/crm/sys/DictDao.xml`)

    for (const fragment of [
      '@RequestMapping("${vuePath}/config/codeOrder")',
      '@GetMapping("shopSumPage")',
      '@GetMapping("itemKindSumList")',
      '@GetMapping("list")',
      '@PostMapping("save")',
      '@DeleteMapping("{id}")',
      'DuplicateKeyException',
      '字段已存在',
      'shopRelOfficeList.get(0).getShopId()',
      '无权限查看',
    ]) expect(controller).toContain(fragment)
    for (const fragment of [
      'DictUtils.getDictList("order_field")',
      'orderFieldDict.getLabel()',
      'orderFieldDict.getRemarks()',
      'case "order":',
      'result = "订单信息"',
      'case "item":',
      'result = "商品信息"',
      'DictUtils.getDictList("item_kind")',
      'dto.setNum(0)',
      'shopSumDTO.setTenantId(crmTenantId)',
    ]) expect(service).toContain(fragment)
    for (const fragment of ['private Integer shopId', 'private String itemKind', 'private String field', 'private Integer sort']) expect(entity).toContain(fragment)
    for (const fragment of ['private String id', 'private Integer shopId', 'private String itemKind', 'private String field', 'private String fieldName', 'private String fieldType', 'private String fieldTypeName', 'private Integer sort']) expect(dto).toContain(fragment)
    for (const fragment of ['order by a.sort', 'and a.shop_id = #{shopId}', 'and a.item_kind = #{itemKind}', 'insert into config_code_order', 'delete from config_code_order where id = #{id}']) expect(mapper).toContain(fragment)
    const updateSql = mapper.slice(mapper.indexOf('<update id="update">'), mapper.indexOf('</update>'))
    expect(updateSql).toContain('sort = #{sort}')
    expect(updateSql).not.toContain('field =')
    for (const fragment of ['@GetMapping("listData")', 'dictService.getSystemDictList(dict)', 'map.put("value", e.getValue())', 'map.put("label", StringUtils.replace(e.getLabel(), " ", ""))', 'map.put("remarks", e.getRemarks())']) expect(dictController).toContain(fragment)
    expect(dictService).toContain('public List<Dict> getSystemDictList(Dict dict)')
    expect(dictMapper).toContain('<select id="getSystemDictList"')
    expect(dictMapper).toContain('remark as "remarks"')
  })

  it('按Portal三层请求逐个核对URL、方法、参数和返回结构', async () => {
    const f = fixture([{ list: [supplier], count: 1 }, { list: [supplier], count: 1 }, [itemKind], [field], [{ value: 'order_no', label: '订单号', remarks: 'order' }, { value: 'item_name', label: '商品名称', remarks: 'item' }, { value: 'other', label: '其它', remarks: 'other' }]])

    await expect(f.api.supplierList()).resolves.toEqual({ list: [supplier], total: 1 })
    expect(f.calls[0]).toEqual({ url: '/vue/config/codeOrder/shopSumPage', method: 'get', params: { pageNo: 1, pageSize: 20, tenantName: '' } })
    await expect(f.api.supplierList({ tenantName: '甲', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [supplier], total: 1 })
    expect(f.calls[1]).toEqual({ url: '/vue/config/codeOrder/shopSumPage', method: 'get', params: { pageNo: 2, pageSize: 50, tenantName: '甲' } })
    expect(f.calls[1]!.params).not.toHaveProperty('order')
    expect(f.calls[1]!.params).not.toHaveProperty('orderField')

    await expect(f.api.itemKindList({ shopId: 2 })).resolves.toEqual([itemKind])
    expect(f.calls[2]).toEqual({ url: '/vue/config/codeOrder/itemKindSumList', method: 'get', params: { shopId: 2 } })
    await expect(f.api.fieldList({ shopId: 2, itemKind: '3001' })).resolves.toEqual([field])
    expect(f.calls[3]).toEqual({ url: '/vue/config/codeOrder/list', method: 'get', params: { shopId: 2, itemKind: '3001' } })
    await expect(f.api.orderFieldList()).resolves.toEqual([
      { value: 'order_no', label: '订单号', remarks: 'order', fieldTypeName: '订单信息' },
      { value: 'item_name', label: '商品名称', remarks: 'item', fieldTypeName: '商品信息' },
      { value: 'other', label: '其它', remarks: 'other', fieldTypeName: '' },
    ])
    expect(f.calls[4]).toEqual({ url: '/vue/sys/dict/listData', method: 'get', params: { type: 'order_field' } })
  })

  it('保留Portal的null店铺回退和五字段form-urlencoded保存规则', async () => {
    const f = fixture([[]])
    await expect(f.api.itemKindList()).resolves.toEqual([])
    expect(f.calls[0]).toEqual({ url: '/vue/config/codeOrder/itemKindSumList', method: 'get', params: { shopId: null } })

    const prepared = f.api.prepareCreate({ form: { shopId: 2, itemKind: '3001', field: 'order_no' }, usedSort: [1, 4] })
    expect(prepared).toEqual({ draft: { shopId: 2, itemKind: '3001', field: 'order_no', sort: 5, id: null } })
    expect(f.calls).toHaveLength(1)
    await expect(f.api.create({ draft: prepared.draft })).resolves.toBeUndefined()
    expect(f.calls[1]).toEqual({
      url: '/vue/config/codeOrder/save',
      method: 'post',
      data: { shopId: 2, itemKind: '3001', field: 'order_no', sort: 5, id: null },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })

    const updated = f.api.prepareUpdate({ form: { ...field, sort: 2 }, currentField: 'order_no', usedSort: [1, 3] })
    expect(updated).toEqual({ draft: { shopId: 2, itemKind: '3001', field: 'order_no', sort: 2, id: 'field-1', currentField: 'order_no' } })
    await expect(f.api.update({ draft: updated.draft })).resolves.toBeUndefined()
    expect(f.calls[2]).toEqual({
      url: '/vue/config/codeOrder/save',
      method: 'post',
      data: { shopId: 2, itemKind: '3001', field: 'order_no', sort: 2, id: 'field-1' },
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    })
    expect(f.calls[2]!.data).not.toHaveProperty('currentField')

    expect(f.api.prepareRemove({ id: 'field-1' })).toEqual({ id: 'field-1' })
    await expect(f.api.remove({ id: 'field-1' })).resolves.toBeUndefined()
    expect(f.calls[3]).toEqual({ url: '/vue/config/codeOrder/field-1', method: 'delete' })
  })

  it('校验表单、ID、排序、分页和响应反例，坏值不能静默变成空结果', async () => {
    const f = fixture([])
    expect(() => f.api.prepareCreate({ form: { shopId: 2, itemKind: '3001', field: 'order_no' }, usedSort: [1] })).not.toThrow()
    expect(() => f.api.prepareCreate({ form: { shopId: 2, itemKind: '3001', field: 'order_no', sort: 1 }, usedSort: [1] })).toThrow('该排序已被使用')
    expect(() => f.api.prepareCreate({ form: { shopId: 2, itemKind: '3001', field: '', sort: 2 } })).toThrow('field')
    expect(() => f.api.prepareCreate({ form: { shopId: 0, itemKind: '3001', field: 'order_no', sort: 2 } })).toThrow('shopId')
    expect(() => f.api.prepareUpdate({ form: { ...field, sort: 2 }, currentField: 'different', usedSort: [] })).toThrow('不可修改')
    expect(() => f.api.prepareUpdate({ form: { ...field, sort: 1 }, currentField: 'order_no', usedSort: [1] })).toThrow('该排序已被使用')
    expect(() => f.api.prepareRemove({ id: ' ' })).toThrow('二维码字段ID')
    await expect(f.api.fieldList({ shopId: 2, itemKind: '' })).rejects.toThrow('itemKind')
    await expect(f.api.supplierList({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(f.calls).toHaveLength(0)

    await expect(f.api.supplierList()).rejects.toThrow('二维码供应商分页响应')
    const badCount = fixture([{ list: [], count: '1' }])
    await expect(badCount.api.supplierList()).rejects.toThrow('count')
    const badBackend = fixture([new Error('权限不足')])
    await expect(badBackend.api.itemKindList({ shopId: 2 })).rejects.toThrow('权限不足')
  })

  it('AI说明覆盖全部能力、写后回查和无cancel边界，且结构反证通过', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(SALE_CUSTOM_QR_METHODS).sort())
    expect(contracts['sale-custom-qr-supplier-list']?.inputs.pageSize?.meaning).toContain('每页')
    expect(contracts['sale-custom-qr-field-list']?.steps[1]).toMatchObject({ capabilityId: 'sale-custom-qr-prepare-update', mapping: { form: 'user.selectedFieldRow', currentField: 'user.selectedFieldRow.field' } })
    expect(contracts['sale-custom-qr-order-field-list']?.output.fields.find(item => item.path === '[].remarks')?.meaning).toContain('不能用label推断')
    expect(contracts['sale-custom-qr-update']?.boundaries.join(' ')).toContain('currentField')
    expect(contracts['sale-custom-qr-prepare-create']?.steps.some(step => step.role === 'cancel' && step.capabilityId === undefined)).toBe(true)
    expect(contracts['sale-custom-qr-prepare-update']?.steps.some(step => step.role === 'cancel' && step.capabilityId === undefined)).toBe(true)
    expect(Object.keys(contracts).some(id => id.toLowerCase().includes('cancel'))).toBe(false)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl) as { validateAiContracts: (contracts: Record<string, unknown>) => unknown[] }
    expect(validateAiContracts(contracts)).toEqual([])
  })
})
