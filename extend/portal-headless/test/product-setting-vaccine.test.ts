import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AxiosInstance, InternalAxiosRequestConfig } from 'axios'
import type { PortalRequest } from '../src/session/types.js'
import { createPageCall } from '../src/call.js'
import { createPortalHttp, type PortalRequestConfig } from '../src/http/client.js'
import {
  createProductSettingVaccineCapability,
  PRODUCT_SETTING_VACCINE_METHODS,
  PRODUCT_SETTING_VACCINE_MODULE_TYPE,
  PRODUCT_SETTING_VACCINE_PAGE_PATH,
  PRODUCT_SETTING_VACCINE_PERMISSION,
  PRODUCT_SETTING_VACCINE_QUERY_PERMISSION,
  PRODUCT_SETTING_VACCINE_SUBMIT_PERMISSION,
  productSettingVaccineCapabilities,
  type ProductSettingVaccineSaveDraft,
} from '../src/capabilities/product-setting-vaccine.js'
import {
  PRODUCT_SETTING_VACCINE_AI_CONTRACTS as contracts,
  PRODUCT_SETTING_VACCINE_METHOD_CONTRACTS as methodContracts,
} from '../src/catalog/contracts-product-setting-vaccine.js'

type RequestConfig = Parameters<PortalRequest>[0]

const form: ProductSettingVaccineSaveDraft = {
  id: '',
  diseaseName: '禽流感',
  vaccineName: '疫苗A',
  imported: 0,
  strain: 'H5',
  manufacturer: '厂家A',
  antibody: '抗体A',
}

const row = {
  id: 'vaccine-1',
  diseaseName: '禽流感',
  vaccineName: '疫苗A',
  imported: 0 as 0 | 1,
  strain: 'H5',
  manufacturer: '厂家A',
  antibody: '抗体A',
  updateDate: '2026-09-24',
  createDate: '2026-09-23',
  sapDescription: null,
  sapCode: null,
  unit: '瓶',
}

function fixture (responses: unknown[] = []) {
  const calls: RequestConfig[] = []
  const request: PortalRequest = async <T>(config: RequestConfig) => {
    calls.push(config)
    const next = responses.shift()
    if (next instanceof Error) throw next
    return next as T
  }
  return { api: createProductSettingVaccineCapability(request), calls }
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
  const api = createProductSettingVaccineCapability(
    config => call(PRODUCT_SETTING_VACCINE_PAGE_PATH, { ...config, httpInstance: 'product' }),
  )
  return { api, calls }
}

describe('Portal 产品设置 → 疫苗管理页面能力', () => {
  it('逐页锁定菜单、product实例、权限、列表动作、表单和Java规则', () => {
    const portalRoot = process.env.PORTAL_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Projects_Js'
    const javaRoot = process.env.JAVA_REPO ?? '/Users/liyang/Documents/code/wdbc/CodeReview_Mall_Platform_Java'
    const menu = read(portalRoot, 'app/portal/menus/product/operation.js')
    const list = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/vaccine/list.vue')
    const formSource = read(portalRoot, 'app/portal/views/dashboard/product/setting/base-setting/vaccine/modal-form-content.vue')
    const controller = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/VaccineController.java')
    const entity = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/entity/config/Vaccine.java')
    const dto = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/dal/dto/config/VaccineDTO.java')
    const vo = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/controller/admin/config/vo/VaccineVO.java')
    const mapper = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/resources/mapper/config/VaccineMapperExt.xml')
    const service = read(javaRoot, 'erp-module-fm/erp-module-fm-biz/src/main/java/com/wdbc/erp/module/fm/service/config/impl/VaccineServiceImpl.java')

    expect(menu).toContain(`path: '${PRODUCT_SETTING_VACCINE_PAGE_PATH}'`)
    expect(menu).toContain(`permission: '${PRODUCT_SETTING_VACCINE_PERMISSION}'`)
    for (const fragment of [
      "import { http } from 'app/portal/utils/http/product.js'",
      `query: '${PRODUCT_SETTING_VACCINE_QUERY_PERMISSION}'`,
      `submit: '${PRODUCT_SETTING_VACCINE_SUBMIT_PERMISSION}'`,
      "http.get('/config/vaccine/page', { params })",
      "url: '/config/vaccine/delete'",
      "method: 'DELETE'",
      "params: { id: record.id }",
      "http.post('/config/vaccine/save', payload)",
      'v-if="permissionCheck(permissions.submit)"',
    ]) expect(list).toContain(fragment)
    for (const fragment of [
      "{ label: '国产', value: 0 }",
      "{ label: '进口', value: 1 }",
      'diseaseName: [{ required: true, message: \'必填\', trigger: \'blur\' }]',
      'vaccineName: [{ required: true, message: \'必填\', trigger: \'blur\' }]',
      'imported: [{ required: true, message: \'必填\', trigger: \'change\' }]',
      'strain: [{ required: true, message: \'必填\', trigger: \'blur\' }]',
      'manufacturer: [{ required: true, message: \'必填\', trigger: \'blur\' }]',
      'id: formState.id',
      'diseaseName: formState.diseaseName',
      'vaccineName: formState.vaccineName',
      'imported: formState.imported',
      'strain: formState.strain',
      'manufacturer: formState.manufacturer',
      'antibody: formState.antibody',
    ]) expect(formSource).toContain(fragment)
    for (const fragment of [
      '@RequestMapping(value = "flockSimu/config/vaccine")',
      '@GetMapping("page")',
      '@PostMapping("save")',
      '@DeleteMapping("delete")',
      'PageParam.responsePage(vaccineList)',
      '@RepeatSubmitLimit',
    ]) expect(controller).toContain(fragment)
    for (const field of ['diseaseName', 'vaccineName', 'imported', 'strain', 'antibody', 'manufacturer', 'unit']) expect(entity).toContain(field)
    for (const field of ['List<Vaccine> list', 'List<VaccineDTO> childList']) expect(dto).toContain(field)
    for (const field of ['pageNo', 'pageSize']) expect(vo).toContain(field)
    for (const fragment of [
      'a.id, a.disease_name, a.vaccine_name, a.unit, a.sap_description, a.sap_code, a.imported, a.strain, a.antibody',
      'a.manufacturer, a.create_date, a.update_date, a.remarks',
      'a.disease_name = #{diseaseName}',
      'ORDER BY a.update_date',
    ]) expect(mapper).toContain(fragment)
    for (const fragment of [
      'hrDictService.getLabelById(dto.getDiseaseName(), false)',
      'updateByPrimaryKeySelective(vaccine)',
      'vaccine.setDelFlag(1)',
    ]) expect(service).toContain(fragment)

    expect(productSettingVaccineCapabilities.map(item => item.id)).toEqual(Object.keys(PRODUCT_SETTING_VACCINE_METHODS))
    expect(productSettingVaccineCapabilities.every(item => item.pagePath === PRODUCT_SETTING_VACCINE_PAGE_PATH && item.permission === PRODUCT_SETTING_VACCINE_PERMISSION && item.httpInstance === 'product' && item.moduleType === PRODUCT_SETTING_VACCINE_MODULE_TYPE)).toBe(true)
  })

  it('列表按Portal customLoad发送完整查询，prepare→save和删除逐字段复刻', async () => {
    const f = fixture([{ page: { list: [row], total: 1 } }, {}, {}])
    await expect(f.api.list({ diseaseName: '禽流感', vaccineName: '疫苗', antibody: '抗体', pageNo: 2, pageSize: 50 })).resolves.toEqual({ list: [row], total: 1 })
    expect(f.api.prepareSave(form)).toEqual({ draft: form })
    await expect(f.api.save({ draft: form })).resolves.toBe(true)
    await expect(f.api.remove({ id: row.id })).resolves.toBe(true)
    expect(f.calls).toEqual([
      {
        url: '/config/vaccine/page',
        method: 'get',
        params: { order: '', orderField: '', diseaseName: '禽流感', vaccineName: '疫苗', antibody: '抗体', pageNo: 2, pageSize: 50 },
      },
      { url: '/config/vaccine/save', method: 'post', data: form },
      { url: '/config/vaccine/delete', method: 'delete', params: { id: 'vaccine-1' } },
    ])

    const emptyAntibody = fixture([{}])
    expect(emptyAntibody.api.prepareSave({ ...form, antibody: null as never })).toEqual({ draft: { ...form, antibody: '' } })
    await expect(emptyAntibody.api.save({ draft: { ...form, antibody: null as never } })).resolves.toBe(true)
    expect(emptyAntibody.calls[0]?.data).toEqual({ ...form, antibody: '' })
  })

  it('表单、分页、0值、ID和坏响应在发请求前或响应处失败', async () => {
    const f = fixture([])
    await expect(f.api.list({ pageSize: 30 })).rejects.toThrow('pageSize')
    expect(() => f.api.prepareSave({ ...form, diseaseName: ' ' })).toThrow('疾病名称')
    expect(() => f.api.prepareSave({ ...form, vaccineName: '' })).toThrow('疫苗名称')
    expect(() => f.api.prepareSave({ ...form, imported: undefined as never })).toThrow('进口国产')
    expect(() => f.api.prepareSave({ ...form, imported: 2 as never })).toThrow('0（国产）或1（进口）')
    expect(() => f.api.prepareSave({ ...form, strain: '' })).toThrow('毒株')
    expect(() => f.api.prepareSave({ ...form, manufacturer: '' })).toThrow('生产厂家')
    await expect(f.api.remove({ id: '' })).rejects.toThrow('ID')
    expect(f.calls).toEqual([])

    await expect(fixture([{ page: { list: [{ ...row, imported: '进口' }], total: 1 } }]).api.list()).rejects.toThrow('imported')
    await expect(fixture([{ page: { list: [], total: -1 } }]).api.list()).rejects.toThrow('有效list或total')
    await expect(fixture([new Error('无权限')]).api.list()).rejects.toThrow('无权限')
  })

  it('product实例补请求头且页面路径不发送module-type', async () => {
    const captured = captureProduct()
    await expect(captured.api.list()).resolves.toEqual({ list: [row], total: 1 })
    expect(captured.calls[0]?.url).toBe('/config/vaccine/page')
    expect(captured.calls[0]?.headers?.get('devicetype')).toBe('PC')
    expect(captured.calls[0]?.headers?.has('module-type')).toBe(false)
  })

  it('AI契约覆盖所有方法、表单规则、权限和写入回查', async () => {
    expect(Object.keys(contracts).sort()).toEqual(Object.keys(PRODUCT_SETTING_VACCINE_METHODS).sort())
    expect(Object.keys(methodContracts).sort()).toEqual(Object.values(PRODUCT_SETTING_VACCINE_METHODS).map(method => `productSettingVaccine.${method}`).sort())
    expect(contracts['product-setting-vaccine-save']?.effect).toBe('write')
    expect(contracts['product-setting-vaccine-save']?.steps[0]?.capabilityId).toBe('product-setting-vaccine-prepare-save')
    expect(contracts['product-setting-vaccine-prepare-save']?.steps[0]?.capabilityId).toBe('product-setting-vaccine-save')
    expect(contracts['product-setting-vaccine-list']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_VACCINE_QUERY_PERMISSION)
    expect(contracts['product-setting-vaccine-save']?.boundaries.join('\n')).toContain(PRODUCT_SETTING_VACCINE_SUBMIT_PERMISSION)
    expect(contracts['product-setting-vaccine-prepare-save']?.output.fields.map(field => field.path)).toEqual(expect.arrayContaining(['draft.id', 'draft.diseaseName', 'draft.vaccineName', 'draft.imported', 'draft.strain', 'draft.manufacturer', 'draft.antibody']))
    const validatorUrl = new URL('../tools/ai-contract/validate.mjs', import.meta.url).href
    const { validateAiContracts } = await import(validatorUrl)
    expect(validateAiContracts(contracts, { definitions: productSettingVaccineCapabilities, contracts })).toEqual([])
  })
})
