import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingMedicineCapability,
  PRODUCT_SETTING_MEDICINE_METHODS,
  PRODUCT_SETTING_MEDICINE_MODULE_TYPE,
  PRODUCT_SETTING_MEDICINE_PAGE_PATH,
  PRODUCT_SETTING_MEDICINE_PERMISSION,
  PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION,
  PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION,
  productSettingMedicineCapabilities,
  type ProductSettingMedicineSaveDraft,
} from '../src/capabilities/product-setting-medicine.js'
import {
  PRODUCT_SETTING_MEDICINE_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_MEDICINE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-medicine.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingMedicineSaveDraft = {
  id: '',
  type: 1,
  purpose: '饮水',
  medicineGroup: '抗菌药',
  element: '有效成份',
  factory: '厂家A',
  supplier: '供应商A',
  name: '药物A',
}

const row = {
  id: 'medicine-1',
  type: 1,
  purpose: '饮水',
  medicineGroup: '抗菌药',
  element: '有效成份',
  factory: '厂家A',
  supplier: '供应商A',
  name: '药物A',
  measureUnit: null,
  unit: null,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingMedicineCapability(request), calls }
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
    { baseUrls: { product: 'https://fmtest.zhihuidanji.com/flockSimu' } },
  )
  const api = createProductSettingMedicineCapability(
    config => call(PRODUCT_SETTING_MEDICINE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 药品管理页面能力', () => {
  it('逐页锁定菜单、product实例、权限、列表动作、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/medicine/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/medicine/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/MedicineController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Medicine.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/config/MedicineDTO.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/vo/MedicineVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/config/impl/MedicineServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_MEDICINE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_MEDICINE_PERMISSION}'`)
    expect(list).toContain("import { http } from 'app/portal/utils/http/product.js'")
    for (const fragment of [
      `query: '${PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION}'`,
      "http.get('/config/medicine/page', { params })",
      "url: '/config/medicine/delete'",
      "method: 'DELETE'",
      "params: { id: record.id }",
      "http.post('/config/medicine/save', payload)",
      'rrList.afterFormReset',
      'v-if="permissionCheck(permissions.submit)"',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'id: formState.id',
      'type: formState.type',
      'purpose: formState.purpose',
      'medicineGroup: formState.medicineGroup',
      'element: formState.element',
      'factory: formState.factory',
      'supplier: formState.supplier',
      'name: formState.name',
      'type: [{ required: true, message: \'必填\', trigger: \'change\' }]',
      'purpose: [{ required: true, message: \'必填\', trigger: \'blur\' }]',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/medicine")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("delete")',
      'putData("page", page)',
      '@RepeatSubmitLimit',
    ]) expect(controller).toContain(fragment)
    for (const field of ['type', 'name', 'element', 'supplier', 'medicineGroup', 'factory', 'purpose']) expect(entity).toContain(field)
    for (const field of ['measureUnit', 'list', 'childList']) expect(dto).toContain(field)
    for (const field of ['pageNo', 'pageSize']) expect(vo).toContain(field)
    for (const fragment of ['getPageWithPageHelper', 'public void save(MedicineVO medicineVO)', 'public void delete(String id)', 'updateByPrimaryKeySelective']) expect(service).toContain(fragment)

    expect(productSettingMedicineCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_MEDICINE_METHODS))
    expect(productSettingMedicineCapabilities.every(item => item.pagePath === PRODUCT_SETTING_MEDICINE_PAGE_PATH && item.permission === PRODUCT_SETTING_MEDICINE_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_MEDICINE_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal customLoad逐字段发送并兼容page包络', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ type: '2', factory: '厂家', name: '药', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/config/medicine/page',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        type: '2',
        factory: '厂家',
        name: '药',
        pageNo: 2,
        pageSize: 50,
      },
    }])
  })

  it('prepare→save完整复刻八字段表单，删除复刻Portal DELETE请求', async () => {
    const f = fixture([{}, {}])
    const prepared = f.api.prepareSave(form)
    expect(prepared).toEqual({ draft: form })
    await expect(f.api.save(prepared)).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/config/medicine/save', method: 'post', data: form },
      { url: '/config/medicine/delete', method: 'delete', params: { id: 'medicine-1' } },
    ])
    const emptyOptional = fixture([{}])
    await expect(emptyOptional.api.save({ draft: { ...form, medicineGroup: '', element: '', supplier: '' } })).resolves.toBe(true)
    expect(emptyOptional.calls[0]?.data).toEqual({ ...form, medicineGroup: '', element: '', supplier: '' })
  })

  it('表单、分页、类型、ID和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ type: '3' as '1', pageSize: 30 })).rejects.toThrow('类型')
    expect(() => f.api.prepareSave({ ...form, purpose: ' ' })).toThrow('使用途径')
    expect(() => f.api.prepareSave({ ...form, factory: '' })).toThrow('生产厂家')
    expect(() => f.api.prepareSave({ ...form, name: '' })).toThrow('药物名称')
    expect(() => f.api.prepareSave({ ...form, type: 3 as 1 })).toThrow('1（兽药）或2')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])

    const badPage = fixture([{ page: { list: [], total: -1 } }])
    await expect(badPage.api.list()).rejects.toThrow('有效list或total')
    const badRow = fixture([{ page: { list: [{ ...row, type: '兽药' }], total: 1 } }])
    await expect(badRow.api.list()).rejects.toThrow('type')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/config/medicine/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖所有方法、写入回查和页面内权限', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_MEDICINE_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_MEDICINE_METHODS).map(method => `productSettingMedicine.${method}`).sort())
    expect(contracts['product-setting-medicine-save']?.effect).toBe('write')
    expect(contracts['product-setting-medicine-save']?.steps[0]?.capabilityId).toBe('product-setting-medicine-prepare-save')
    expect(contracts['product-setting-medicine-prepare-save']?.steps[0]?.capabilityId).toBe('product-setting-medicine-save')
    expect(contracts['product-setting-medicine-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_MEDICINE_QUERY_PERMISSION)
    expect(contracts['product-setting-medicine-save']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_MEDICINE_SUBMIT_PERMISSION)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingMedicineCapabilities, contracts })).toEqual([])
  })
})
