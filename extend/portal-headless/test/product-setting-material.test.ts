import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingMaterialCapability,
  PRODUCT_SETTING_MATERIAL_BACK_PERMISSION,
  PRODUCT_SETTING_MATERIAL_METHODS,
  PRODUCT_SETTING_MATERIAL_MODULE_TYPE,
  PRODUCT_SETTING_MATERIAL_PAGE_PATH,
  PRODUCT_SETTING_MATERIAL_PERMISSION,
  PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION,
  PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION,
  productSettingMaterialCapabilities,
  type ProductSettingMaterialSaveDraft,
} from '../src/capabilities/product-setting-material.js'
import {
  PRODUCT_SETTING_MATERIAL_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_MATERIAL_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-material.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingMaterialSaveDraft = {
  id: '',
  materialDescription: '复合维生素',
  supplier: '供应商A',
  type: '2',
  image: '',
  measureUnit: '50ml/瓶',
}

const row = {
  id: 'material-1',
  materialDescription: '复合维生素',
  type: 2,
  typeStr: '药品',
  supplier: '供应商A',
  image: null,
  measureUnit: '50ml/瓶',
  status: 1,
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingMaterialCapability(request), calls }
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
  const api = createProductSettingMaterialCapability(
    config => call(PRODUCT_SETTING_MATERIAL_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 物料管理页面能力', () => {
  it('逐页锁定菜单、product实例、页面权限、列表动作、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/material/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/material/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/MaterialController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Material.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/base/vo/MaterialVO.java')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/base/impl/MaterialServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_MATERIAL_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_MATERIAL_PERMISSION}'`)
    expect(list).toContain("import { http } from 'app/portal/utils/http/product.js'")
    for (const fragment of [
      `query: '${PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION}'`,
      `back: '${PRODUCT_SETTING_MATERIAL_BACK_PERMISSION}'`,
      "http.get('/base/material/page/external', { params })",
      "http.post('/base/material/userMaterialSave', payload)",
      "http.get('/base/material/userMaterialDelete'",
      "materialIdList: ids.join(',')",
      "'/base/material/deactivate'",
      "'/base/material/enable'",
      'materialId',
      'v-if="permissionCheck(permissions.submit)"',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      'id: formState.id',
      'materialDescription: formState.materialDescription',
      'supplier: formState.supplier',
      'type: formState.type',
      'image: formState.image',
      'measureUnit: formState.measureUnit',
      "{ required: true, message: '必填', trigger: 'blur' }",
      '{ max: 10, message: \'最多10个字符\', trigger: \'blur\' }',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = {"flockSimu/base/material"})',
      '@PostMapping(value = "/userMaterialSave")',
      '@GetMapping("userMaterialDelete")',
      '@GetMapping("enable")',
      '@GetMapping(value = "deactivate")',
      '@GetMapping(value = "/page/external")',
      'putData("page", page)',
    ]) expect(controller).toContain(fragment)
    for (const field of ['materialDescription', 'type', 'supplier', 'image', 'measureUnit', 'status']) expect(entity).toContain(field)
    for (const field of ['materialDescription', 'type', 'supplier', 'image', 'measureUnit', 'status']) expect(vo).toContain(field)
    for (const fragment of ['userMaterialSave(Material material)', 'userMaterialDelete(List<String> materialIdList)', 'checkMaterialIsUse']) expect(service).toContain(fragment)
    expect(controller).toContain('materialService.updateStatus(1, materialId')

    expect(productSettingMaterialCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_MATERIAL_METHODS))
    expect(productSettingMaterialCapabilities.every(item => item.pagePath === PRODUCT_SETTING_MATERIAL_PAGE_PATH && item.permission === PRODUCT_SETTING_MATERIAL_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_MATERIAL_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal customLoad逐字段发送并兼容page包络', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }])
    await expect(f.api.list({ materialDescription: '维生', type: '2', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.calls).toEqual([{
      url: '/base/material/page/external',
      method: 'get',
      params: {
        order: '',
        orderField: '',
        materialDescription: '维生',
        type: '2',
        pageNo: 2,
        pageSize: 50,
      },
    }])
  })

  it('prepare→save完整复刻六字段表单，删除和状态动作复刻实际请求', async () => {
    const f = fixture([{}, {}, {}])
    const prepared = f.api.prepareSave(form)
    expect(prepared).toEqual({ draft: form })
    await expect(f.api.save(prepared)).resolves.toBe(true)
    await expect(f.api.removeBatch({ ids: ['material-1', 2] })).resolves.toBe(true)
    await expect(f.api.enable({ materialId: row.id })).resolves.toBe(true)
    await expect(f.api.deactivate({ materialId: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      { url: '/base/material/userMaterialSave', method: 'post', data: form },
      { url: '/base/material/userMaterialDelete', method: 'get', params: { materialIdList: 'material-1,2' } },
      { url: '/base/material/enable', method: 'get', params: { materialId: 'material-1' } },
      { url: '/base/material/deactivate', method: 'get', params: { materialId: 'material-1' } },
    ])
  })

  it('表单、分页、ID和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(() => f.api.prepareSave({ ...form, materialDescription: ' ' })).toThrow('物料名称')
    expect(() => f.api.prepareSave({ ...form, measureUnit: '12345678901' })).toThrow('10个字符')
    expect(() => f.api.prepareSave({ ...form, type: '' })).toThrow('物料类型')
    await expect(f.api.save({ draft: { ...form, supplier: '' } })).rejects.toThrow('供应商名称')
    await expect(f.api.removeBatch({ ids: [] })).rejects.toThrow('非空')
    await expect(f.api.enable({ materialId: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])

    const badPage = fixture([{ page: { list: [], total: -1 } }])
    await expect(badPage.api.list()).rejects.toThrow('有效list或total')
    const badRow = fixture([{ page: { list: [{ ...row, status: '启用' }], total: 1 } }])
    await expect(badRow.api.list()).rejects.toThrow('status')
    const denied = fixture([new Error('无权限')])
    await expect(denied.api.list()).rejects.toThrow('无权限')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/base/material/page/external')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖所有方法、写入回查和页面内权限', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_MATERIAL_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_MATERIAL_METHODS).map(method => `productSettingMaterial.${method}`).sort())
    expect(contracts['product-setting-material-save']?.effect).toBe('write')
    expect(contracts['product-setting-material-save']?.steps[0]?.capabilityId).toBe('product-setting-material-prepare-save')
    expect(contracts['product-setting-material-prepare-save']?.steps[0]?.capabilityId).toBe('product-setting-material-save')
    expect(contracts['product-setting-material-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_MATERIAL_QUERY_PERMISSION)
    expect(contracts['product-setting-material-save']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_MATERIAL_SUBMIT_PERMISSION)
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingMaterialCapabilities, contracts })).toEqual([])
  })
})
