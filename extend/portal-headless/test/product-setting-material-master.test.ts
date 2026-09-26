import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingMaterialMasterCapability,
  PRODUCT_SETTING_MATERIAL_MASTER_METHODS,
  PRODUCT_SETTING_MATERIAL_MASTER_MODULE_TYPE,
  PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION,
  PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION,
  productSettingMaterialMasterCapabilities,
} from '../src/capabilities/product-setting-material-master.js'
import { PRODUCT_SETTING_MATERIAL_MASTER_AI_CONTRACTS as contracts, PRODUCT_SETTING_MATERIAL_MASTER_METHOD_CONTRACTS as methodContracts } from '../src/catalog/contracts-product-setting-material-master.js'

type RequestConfig = Parameters<PortalRequest>[0]

const row = {
  id: 'material-1',
  materialDescription: '复合饲料',
  materialCode: '123456789',
  materialGroup: '饲料',
  specification: '50kg',
  measureUnit: 'kg',
  type: null,
  isSystem: 1,
  supplier: null,
  image: null,
  remark: 'yukou',
  createDate: '2026-09-01 10:00:00',
  updateDate: '2026-09-02 10:00:00',
  delFlag: 0,
}

const form = {
  materialDescription: '复合饲料',
  materialCode: '123456789',
  materialGroup: '饲料',
  specification: '50kg',
  measureUnit: 'kg',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingMaterialMasterCapability(request), calls }
}

function read (root: string, path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function captureProduct () {
  const calls: InternalAxiosRequestConfig[] = []
  const http: AxiosInstance = createPortalHttp({
    baseUrl: 'https://biz-api-test.wodecorp.cn',
    credential: { token: 'fixture-token', tenantId: 7 },
  })
  http.defaults.adapter = async config => {
    calls.push(config)
    return {
      data: { ret: 'SUCCESS', code: 0, msg: '', data: { page: { list: [row], total: 1 } } },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  const call = createPageCall(
    <T>(config: PortalRequestConfig) => http.request(config as never) as unknown as Promise<T>,
    undefined,
    { baseUrls: { product: 'https://biz-api-test.wodecorp.cn/flockSimu' } },
  )
  const api = createProductSettingMaterialMasterCapability(
    config => call(PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 系统设置 → 生产设置 → 物料主数据页面能力', () => {
  it('逐页锁定菜单、页面权限、submit权限、表单规则、请求和Java映射', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const route = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/material.vue')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/material/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/business-manage/material/modal-form-content.vue')
    const renrenList = read(portalRoot, 'common/libs/renren/list.js')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/MaterialController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Material.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/config/MaterialMapper.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/MaterialServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION}'`)
    expect(route).toContain('title: 物料主数据')
    expect(route).toContain(PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      'materialDescription: \'\'',
      'materialCode: \'\'',
      'materialGroup: \'\'',
      "url: '/base/material/page'",
      "method: 'GET'",
      'return res',
      "keyId: 'id'",
      'getDataListIsPage: true',
      "permissionCheck('base:material:submit')",
      "url: '/base/material/save'",
      "method: 'POST'",
      'data: form',
      "url: '/base/material/delete'",
      "method: 'DELETE'",
      'params: { id: record.id }',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'materialDescription: props.record.materialDescription || \'\'',
      'materialCode: props.record.materialCode || \'\'',
      'materialGroup: props.record.materialGroup || \'\'',
      'specification: props.record.specification || \'\'',
      'measureUnit: props.record.measureUnit || \'\'',
      'id: props.record.id',
      "{ required: true, message: '必填', trigger: 'blur' }",
      "{ pattern: /^\\d+$/, message: '必须是数字', trigger: 'blur' }",
      "{ pattern: /^\\S+$/, message: '不能包含空格', trigger: 'blur' }",
      "{ max: 100, message: '长度最多为100', trigger: 'blur' }",
      "{ max: 9, message: '长度最多为9', trigger: 'blur' }",
      "{ max: 50, message: '长度最多为50', trigger: 'blur' }",
      "{ max: 10, message: '长度最多为10', trigger: 'blur' }",
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      'const params = {',
      'order: orderType.value',
      'orderField: orderField.value',
      'if (getDataListIsPage)',
    ]) expect(renrenList).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = {"flockSimu/base/material"})',
      '@PostMapping(value = "/save")',
      '@GetMapping("delete")',
      '@GetMapping(value = "/page")',
      'material.setRemark("yukou")',
      'materialService.save(material)',
      'materialService.deleteById(id)',
      'PageParam.responsePage(list)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['materialDescription', 'materialCode', 'materialGroup', 'specification', 'measureUnit']) expect(entity).toContain(field)
    for (const fragment of ['Base_Column_List', 'material_description', 'material_code', 'material_group', 'specification', 'measure_unit', 'update_date', 'del_flag']) expect(mapper).toContain(fragment)
    for (const fragment of ['public void save(Material material)', 'StringUtils.isNotBlank(material.getId())', 'materialMapperExt.updateByPrimaryKeySelective(material)', 'materialMapperExt.insert(material)']) expect(service).toContain(fragment)

    expect(productSettingMaterialMasterCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_MATERIAL_MASTER_METHODS))
    expect(productSettingMaterialMasterCapabilities.every(item => item.pagePath === PRODUCT_SETTING_MATERIAL_MASTER_PAGE_PATH && item.permission === PRODUCT_SETTING_MATERIAL_MASTER_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_MATERIAL_MASTER_MODULE_TYPE)).toBe(true)
    expect(PRODUCT_SETTING_MATERIAL_MASTER_SUBMIT_PERMISSION).toBe('base:material:submit')
  })

  it('列表、保存和删除按Portal逐字段发送', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }, {}, {}])
    await expect(f.api.list({ materialDescription: '复合', materialCode: '123', materialGroup: '饲料', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    const prepared = f.api.prepareSave(form)
    expect(prepared.draft).toEqual({ ...form, id: undefined })
    await expect(f.api.save(prepared)).resolves.toBe(true)
    expect(f.api.prepareRemove({ id: row.id })).toEqual({ id: row.id })
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/material/page', method: 'get', params: { order: '', orderField: '', materialDescription: '复合', materialCode: '123', materialGroup: '饲料', pageNo: 2, pageSize: 50 } },
      { url: '/base/material/save', method: 'post', data: { ...form, id: undefined } },
      { url: '/base/material/delete', method: 'delete', params: { id: row.id } },
    ])
  })

  it('表单、分页、ID和坏响应在发请求前或响应处失败，并锁住反证', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(() => f.api.prepareSave({ ...form, materialDescription: '' })).toThrow('物料描述')
    expect(() => f.api.prepareSave({ ...form, materialCode: '12A' })).toThrow('数字')
    expect(() => f.api.prepareSave({ ...form, materialCode: '1 2' })).toThrow('数字')
    expect(() => f.api.prepareSave({ ...form, materialCode: '1234567890' })).toThrow('9个字符')
    expect(() => f.api.prepareSave({ ...form, materialGroup: '饲 料' })).toThrow('空格')
    expect(() => f.api.prepareSave({ ...form, specification: '12345678901' })).toThrow('10个字符')
    await expect(f.api.save({ draft: { ...form, materialGroup: '' } })).rejects.toThrow('物料组')
    expect(() => f.api.prepareRemove({ id: '' })).toThrow('ID')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])

    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([{ page: { list: [{ ...row, materialCode: 123 }], total: 1 } }]).api.list()).rejects.toThrow('materialCode')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例补devicetype且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/base/material/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖五个公开方法、权限、表单规则和DELETE差异', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_MATERIAL_MASTER_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_MATERIAL_MASTER_METHODS).map(method => `productSettingMaterialMaster.${method}`).sort())
    expect(contracts['product-setting-material-master-prepare-save']?.output.fields.map(item => item.path)).toEqual(expect.arrayContaining(['draft.materialCode', 'draft.materialGroup', 'draft.specification']))
    expect(contracts['product-setting-material-master-remove']?.boundaries.join('\n')).toContain('当前Java MaterialController只声明了@GetMapping')
    expect(contracts['product-setting-material-master-save']?.steps.some(step => step.capabilityId === 'product-setting-material-master-list')).toBe(true)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingMaterialMasterCapabilities, contracts })).toEqual([])
  })
})
